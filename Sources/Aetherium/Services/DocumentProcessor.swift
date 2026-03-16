import Foundation
import PDFKit
import UniformTypeIdentifiers

// MARK: - Document Processing Pipeline

@MainActor
class DocumentProcessor: ObservableObject {
    @Published var isProcessing = false
    @Published var processingProgress: Double = 0.0
    @Published var processingStatus: String = ""

    private let textExtractor = TextExtractor()
    private let semanticChunker = SemanticChunker()
    private let embeddingGenerator: EmbeddingGenerator
    private let ollamaService: OllamaService

    init(ollamaService: OllamaService) {
        self.ollamaService = ollamaService
        self.embeddingGenerator = EmbeddingGenerator(ollamaService: ollamaService)
    }

    func processDocument(_ url: URL) async throws -> UploadedDocument {
        isProcessing = true
        processingProgress = 0.0
        processingStatus = "Extracting text..."

        defer {
            isProcessing = false
            processingProgress = 1.0
            processingStatus = ""
        }

        // Phase 1: Text extraction (25%)
        let extractedText = try await textExtractor.extractText(from: url)
        processingProgress = 0.25
        processingStatus = "Chunking document..."

        // Phase 2: Semantic chunking (50%)
        let chunks = try await semanticChunker.chunkDocument(extractedText, maxTokens: 512)
        processingProgress = 0.50
        processingStatus = "Generating embeddings (\(chunks.count) chunks)..."

        // Phase 3: Embedding generation (75%)
        _ = try await embeddingGenerator.embedChunks(chunks)
        processingProgress = 0.75
        processingStatus = "Building document model..."

        // Phase 4: Create document model (100%)
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let fileSize = fileAttributes[.size] as? Int64 ?? 0

        let metadata = DocumentMetadata(
            wordCount: extractedText.split(separator: " ").count,
            extractedSections: [],
            extractedEntities: []
        )

        let document = UploadedDocument(
            filename: url.lastPathComponent,
            fileType: DocumentType.fromURL(url),
            filePath: url.path,
            extractedText: extractedText,
            fileSize: fileSize,
            metadata: metadata
        )

        processingProgress = 0.90

        // Auto-summarization
        if let summary = try? await generateSummary(for: extractedText) {
            document.metadata = serializeMetadata(metadata, withSummary: summary)
        }

        processingProgress = 1.0
        return document
    }

    private func serializeMetadata(_ metadata: DocumentMetadata, withSummary summary: String) -> String {
        var mutableMetadata = metadata
        mutableMetadata.extractedEntities.append("summary: \(summary)")
        if let encoded = try? JSONEncoder().encode(mutableMetadata),
           let jsonString = String(data: encoded, encoding: .utf8) {
            return jsonString
        }
        return "{}"
    }

    func generateSummary(for text: String) async throws -> String {
        let prompt = "Please provide a concise TL;DR summary of the following document:\n\n" + String(text.prefix(20000))
        return try await ollamaService.sendMessage(prompt)
    }

    func processMultipleDocuments(_ urls: [URL]) async throws -> [UploadedDocument] {
        var results: [UploadedDocument] = []

        // Process with concurrency limit (2 at a time to avoid memory issues)
        for (batchIndex, chunk) in urls.chunked(into: 2).enumerated() {
            for url in chunk {
                let fileIndex = batchIndex * 2 + results.count % 2 + 1
                processingStatus = "Processing file \(fileIndex) of \(urls.count): \(url.lastPathComponent)"
                let doc = try await self.processDocument(url)
                results.append(doc)
            }
        }

        return results
    }
}

// MARK: - Text Extraction

class TextExtractor {
    func extractText(from url: URL) async throws -> String {
        let fileType = DocumentType.fromURL(url)
        // Push blocking I/O off the main actor onto the cooperative thread pool
        return try await Task.detached(priority: .userInitiated) {
            switch fileType {
            case .pdf:
                return try Self.extractFromPDF(url)
            case .txt, .markdown:
                return try String(contentsOf: url, encoding: .utf8)
            case .html:
                return try Self.extractFromHTML(url)
            case .rtf:
                return try Self.extractFromRTF(url)
            case .docx:
                throw DocumentProcessingError.unsupportedFormat("DOCX support requires additional libraries")
            case .unknown:
                return try String(contentsOf: url, encoding: .utf8)
            }
        }.value
    }

    private static func extractFromPDF(_ url: URL) throws -> String {
        guard let pdfDocument = PDFDocument(url: url) else {
            throw DocumentProcessingError.failedToLoad("Could not load PDF")
        }

        var extractedText = ""

        for pageIndex in 0..<pdfDocument.pageCount {
            if let page = pdfDocument.page(at: pageIndex),
               let pageText = page.string {
                extractedText += pageText + "\n\n"
            }
        }

        return extractedText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractFromHTML(_ url: URL) throws -> String {
        let html = try String(contentsOf: url, encoding: .utf8)

        // Basic HTML stripping (for production, use proper HTML parser)
        var text = html

        // Remove script and style tags
        text = text.replacingOccurrences(
            of: "<script[^>]*>.*?</script>",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        text = text.replacingOccurrences(
            of: "<style[^>]*>.*?</style>",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )

        // Remove HTML tags
        text = text.replacingOccurrences(
            of: "<[^>]+>",
            with: " ",
            options: .regularExpression
        )

        // Decode HTML entities
        text = text.replacingOccurrences(of: "&nbsp;", with: " ")
        text = text.replacingOccurrences(of: "&amp;", with: "&")
        text = text.replacingOccurrences(of: "&lt;", with: "<")
        text = text.replacingOccurrences(of: "&gt;", with: ">")

        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractFromRTF(_ url: URL) throws -> String {
        guard let attributedString = try? NSAttributedString(
            url: url,
            options: [.documentType: NSAttributedString.DocumentType.rtf],
            documentAttributes: nil
        ) else {
            throw DocumentProcessingError.failedToLoad("Could not load RTF")
        }

        return attributedString.string
    }
}

// MARK: - Semantic Chunking

class SemanticChunker {
    func chunkDocument(_ text: String, maxTokens: Int = 512) async throws -> [ChunkData] {
        // For now, use simple paragraph-based chunking
        // In production, integrate with MLX for semantic boundary detection
        let paragraphs = text.components(separatedBy: "\n\n").filter { !$0.isEmpty }

        var chunks: [ChunkData] = []
        var currentChunk = ""
        var currentTokenCount = 0
        var chunkIndex = 0

        for paragraph in paragraphs {
            let paragraphTokens = estimateTokenCount(paragraph)

            if currentTokenCount + paragraphTokens > maxTokens && !currentChunk.isEmpty {
                // Save current chunk
                chunks.append(ChunkData(
                    content: currentChunk.trimmingCharacters(in: .whitespacesAndNewlines),
                    chunkIndex: chunkIndex,
                    tokenCount: currentTokenCount
                ))

                chunkIndex += 1
                currentChunk = ""
                currentTokenCount = 0
            }

            currentChunk += paragraph + "\n\n"
            currentTokenCount += paragraphTokens
        }

        // Add final chunk
        if !currentChunk.isEmpty {
            chunks.append(ChunkData(
                content: currentChunk.trimmingCharacters(in: .whitespacesAndNewlines),
                chunkIndex: chunkIndex,
                tokenCount: currentTokenCount
            ))
        }

        return chunks
    }

    private func estimateTokenCount(_ text: String) -> Int {
        // Simple estimation: ~4 characters per token
        return text.count / 4
    }
}

// MARK: - Embedding Generation

class EmbeddingGenerator {
    private let ollamaService: OllamaService

    init(ollamaService: OllamaService) {
        self.ollamaService = ollamaService
    }

    /// Embeds all chunks in parallel (up to 4 concurrent Ollama requests).
    func embedChunks(_ chunks: [ChunkData]) async throws -> [DocumentChunk] {
        guard !chunks.isEmpty else { return [] }

        typealias IndexedChunk = (index: Int, chunk: DocumentChunk)
        let concurrencyLimit = 4

        let collected: [IndexedChunk] = try await withThrowingTaskGroup(of: IndexedChunk.self) { group in
            var results: [IndexedChunk] = []
            results.reserveCapacity(chunks.count)
            var nextToSchedule = 0

            // Seed up to concurrencyLimit tasks
            let seedCount = min(concurrencyLimit, chunks.count)
            for _ in 0..<seedCount {
                let idx = nextToSchedule
                let chunkData = chunks[idx]
                nextToSchedule += 1
                group.addTask {
                    let embedding = try? await self.generateEmbeddingWithRetry(chunkData.content, maxRetries: 2)
                    return (idx, DocumentChunk(
                        content: chunkData.content,
                        embeddings: embedding,
                        chunkIndex: chunkData.chunkIndex,
                        tokenCount: chunkData.tokenCount
                    ))
                }
            }

            // As each task finishes, schedule the next pending chunk
            for try await result in group {
                results.append(result)
                if nextToSchedule < chunks.count {
                    let idx = nextToSchedule
                    let chunkData = chunks[idx]
                    nextToSchedule += 1
                    group.addTask {
                        let embedding = try? await self.generateEmbeddingWithRetry(chunkData.content, maxRetries: 2)
                        return (idx, DocumentChunk(
                            content: chunkData.content,
                            embeddings: embedding,
                            chunkIndex: chunkData.chunkIndex,
                            tokenCount: chunkData.tokenCount
                        ))
                    }
                }
            }

            return results
        }

        // Restore original chunk order
        return collected.sorted { $0.index < $1.index }.map { $0.chunk }
    }

    private func generateEmbeddingWithRetry(_ text: String, maxRetries: Int) async throws -> [Float] {
        var lastError: Error?
        for attempt in 0...maxRetries {
            do {
                // OllamaService.generateEmbedding already has its own TTL cache;
                // calling it here goes through that cache automatically.
                return try await ollamaService.generateEmbedding(text)
            } catch {
                lastError = error
                if attempt < maxRetries {
                    let delay = UInt64(0.5 * pow(2.0, Double(attempt)) * 1_000_000_000)
                    try? await Task.sleep(nanoseconds: delay)
                }
            }
        }
        throw lastError ?? OllamaError.serviceUnavailable
    }
}

// MARK: - Supporting Types

struct ChunkData {
    let content: String
    let chunkIndex: Int
    let tokenCount: Int
}

enum DocumentProcessingError: LocalizedError {
    case failedToLoad(String)
    case unsupportedFormat(String)
    case extractionFailed(String)

    var errorDescription: String? {
        switch self {
        case .failedToLoad(let message):
            return "Failed to load document: \(message)"
        case .unsupportedFormat(let message):
            return "Unsupported format: \(message)"
        case .extractionFailed(let message):
            return "Text extraction failed: \(message)"
        }
    }
}

// MARK: - Array Extension for Chunking

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
