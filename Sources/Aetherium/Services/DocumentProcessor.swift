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

        return try await processDocumentCore(url) { [weak self] progress, status in
            self?.processingProgress = progress
            self?.processingStatus = status
        }
    }

    func processMultipleDocuments(_ urls: [URL]) async throws -> [UploadedDocument] {
        guard !urls.isEmpty else { return [] }
        isProcessing = true
        processingProgress = 0.0
        defer { isProcessing = false; processingProgress = 1.0; processingStatus = "" }

        let total = Double(urls.count)
        var completed = 0.0
        var results: [UploadedDocument] = []

        // Process up to 2 documents concurrently to avoid memory spikes
        // async let runs both tasks on the main actor, interleaving at every
        // suspension point — including the parallel embedding calls inside each.
        let batches = urls.chunked(into: 2)
        for batch in batches {
            if batch.count == 2 {
                async let first  = processDocumentCore(batch[0], progressCallback: nil)
                async let second = processDocumentCore(batch[1], progressCallback: nil)
                let (d1, d2) = try await (first, second)
                results.append(contentsOf: [d1, d2])
            } else {
                results.append(try await processDocumentCore(batch[0], progressCallback: nil))
            }
            completed += Double(batch.count)
            processingProgress = completed / total
            processingStatus = "Processed \(Int(completed)) of \(urls.count) files..."
        }

        return results
    }

    // Shared core: performs all 4 phases without touching @Published properties directly.
    // progressCallback receives (fractionComplete, statusMessage) at phase boundaries.
    private func processDocumentCore(
        _ url: URL,
        progressCallback: ((Double, String) -> Void)? = nil
    ) async throws -> UploadedDocument {
        // Phase 1: Text extraction — pushed off the main actor by TextExtractor
        let extractedText = try await textExtractor.extractText(from: url)
        progressCallback?(0.25, "Chunking document...")

        // Phase 2: Semantic chunking
        let chunks = try await semanticChunker.chunkDocument(extractedText, maxTokens: 512)
        progressCallback?(0.50, "Generating embeddings (\(chunks.count) chunks)...")

        // Phase 3: Parallel embedding generation (up to 4 concurrent requests)
        let embeddedChunks = try await embeddingGenerator.embedChunks(chunks)
        progressCallback?(0.75, "Building document model...")

        // Phase 4: Build model and attach chunks
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

        for chunk in embeddedChunks {
            chunk.document = document
            document.chunks.append(chunk)
        }

        return document
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

        // Each task returns the original index + embedding vector (both Sendable).
        // DocumentChunk is a @Model and cannot cross task boundaries, so we
        // build the model objects only after the group finishes on the calling context.
        typealias IndexedEmbedding = (index: Int, embedding: [Float]?)
        let concurrencyLimit = 4

        let collected: [IndexedEmbedding] = try await withThrowingTaskGroup(
            of: IndexedEmbedding.self
        ) { group in
            var results: [IndexedEmbedding] = []
            results.reserveCapacity(chunks.count)
            var nextToSchedule = 0

            // Seed up to concurrencyLimit tasks
            let seedCount = min(concurrencyLimit, chunks.count)
            for _ in 0..<seedCount {
                let idx = nextToSchedule
                let content = chunks[idx].content
                nextToSchedule += 1
                group.addTask {
                    let embedding = try? await self.generateEmbeddingWithRetry(content, maxRetries: 2)
                    return (idx, embedding)
                }
            }

            // As each task finishes, schedule the next pending chunk
            for try await result in group {
                results.append(result)
                if nextToSchedule < chunks.count {
                    let idx = nextToSchedule
                    let content = chunks[idx].content
                    nextToSchedule += 1
                    group.addTask {
                        let embedding = try? await self.generateEmbeddingWithRetry(content, maxRetries: 2)
                        return (idx, embedding)
                    }
                }
            }

            return results
        }

        // Build DocumentChunk models in original order on the calling (main actor) context
        return collected
            .sorted { $0.index < $1.index }
            .map { item in
                DocumentChunk(
                    content: chunks[item.index].content,
                    embeddings: item.embedding,
                    chunkIndex: chunks[item.index].chunkIndex,
                    tokenCount: chunks[item.index].tokenCount
                )
            }
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
