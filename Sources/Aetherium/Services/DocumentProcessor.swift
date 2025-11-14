import Foundation
import PDFKit
import UniformTypeIdentifiers

// MARK: - Document Processing Pipeline

@MainActor
class DocumentProcessor: ObservableObject {
    @Published var isProcessing = false
    @Published var processingProgress: Double = 0.0

    private let textExtractor = TextExtractor()
    private let semanticChunker = SemanticChunker()
    private let embeddingGenerator = EmbeddingGenerator()

    func processDocument(_ url: URL) async throws -> UploadedDocument {
        isProcessing = true
        processingProgress = 0.0

        defer {
            isProcessing = false
            processingProgress = 1.0
        }

        // Phase 1: Text extraction (25%)
        let extractedText = try await textExtractor.extractText(from: url)
        processingProgress = 0.25

        // Phase 2: Semantic chunking (50%)
        let chunks = try await semanticChunker.chunkDocument(extractedText, maxTokens: 512)
        processingProgress = 0.50

        // Phase 3: Embedding generation (75%)
        let embeddedChunks = try await embeddingGenerator.embedChunks(chunks)
        processingProgress = 0.75

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

        processingProgress = 1.0
        return document
    }

    func processMultipleDocuments(_ urls: [URL]) async throws -> [UploadedDocument] {
        var results: [UploadedDocument] = []

        // Process with concurrency limit (2 at a time to avoid memory issues)
        for chunk in urls.chunked(into: 2) {
            let chunkResults = try await withThrowingTaskGroup(of: UploadedDocument.self) { group in
                for url in chunk {
                    group.addTask {
                        try await self.processDocument(url)
                    }
                }

                var docs: [UploadedDocument] = []
                for try await doc in group {
                    docs.append(doc)
                }
                return docs
            }
            results.append(contentsOf: chunkResults)
        }

        return results
    }
}

// MARK: - Text Extraction

class TextExtractor {
    func extractText(from url: URL) async throws -> String {
        let fileType = DocumentType.fromURL(url)

        switch fileType {
        case .pdf:
            return try extractFromPDF(url)
        case .txt, .markdown:
            return try String(contentsOf: url, encoding: .utf8)
        case .html:
            return try extractFromHTML(url)
        case .rtf:
            return try extractFromRTF(url)
        case .docx:
            throw DocumentProcessingError.unsupportedFormat("DOCX support requires additional libraries")
        case .unknown:
            // Try as plain text
            return try String(contentsOf: url, encoding: .utf8)
        }
    }

    private func extractFromPDF(_ url: URL) throws -> String {
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

    private func extractFromHTML(_ url: URL) throws -> String {
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

    private func extractFromRTF(_ url: URL) throws -> String {
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
    private let cache = NSCache<NSString, CachedEmbedding>()

    func embedChunks(_ chunks: [ChunkData]) async throws -> [DocumentChunk] {
        // For now, generate placeholder embeddings
        // In production, integrate with MLX embedding model or Ollama
        return chunks.map { chunkData in
            DocumentChunk(
                content: chunkData.content,
                embeddings: nil, // Will be generated with MLX/Ollama later
                chunkIndex: chunkData.chunkIndex,
                tokenCount: chunkData.tokenCount
            )
        }
    }

    func generateEmbedding(_ text: String) async throws -> [Float] {
        // Check cache first
        let cacheKey = NSString(string: text)
        if let cached = cache.object(forKey: cacheKey) {
            return cached.embedding
        }

        // For now, return placeholder
        // In production: Use Ollama embeddings endpoint or MLX model
        let embedding = [Float](repeating: 0.0, count: 384) // Typical embedding size

        // Cache the result
        cache.setObject(CachedEmbedding(embedding: embedding), forKey: cacheKey)

        return embedding
    }
}

// MARK: - Supporting Types

struct ChunkData {
    let content: String
    let chunkIndex: Int
    let tokenCount: Int
}

class CachedEmbedding {
    let embedding: [Float]
    let timestamp: Date

    init(embedding: [Float]) {
        self.embedding = embedding
        self.timestamp = Date()
    }
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
