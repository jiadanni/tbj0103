import Foundation
import SwiftData

enum ProjectSourceType: String, Codable {
    case document
    case webpage
    case audioTranscription
    case note
}

@Model
final class ProjectSource {
    @Attribute(.unique) var id: UUID
    var sourceType: String // ProjectSourceType.rawValue
    var title: String
    var createdAt: Date
    var processedAt: Date?
    var isProcessing: Bool

    // Relationships
    var project: Workspace?
    var document: UploadedDocument?
    var webpage: WebCapture?
    var audioFile: AudioTranscription?
    var note: ProjectNote?

    init(
        id: UUID = UUID(),
        sourceType: ProjectSourceType,
        title: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.sourceType = sourceType.rawValue
        self.title = title
        self.createdAt = createdAt
        self.processedAt = nil
        self.isProcessing = false
    }

    var type: ProjectSourceType {
        ProjectSourceType(rawValue: sourceType) ?? .note
    }
}

@Model
final class UploadedDocument {
    @Attribute(.unique) var id: UUID
    var filename: String
    var fileType: String // DocumentType
    var filePath: String // Local storage path
    var extractedText: String
    var pageCount: Int?
    var fileSize: Int64
    var processedAt: Date
    var metadata: String // JSON-encoded DocumentMetadata

    @Relationship(deleteRule: .cascade) var chunks: [DocumentChunk]
    var source: ProjectSource?

    init(
        id: UUID = UUID(),
        filename: String,
        fileType: DocumentType,
        filePath: String,
        extractedText: String,
        pageCount: Int? = nil,
        fileSize: Int64,
        metadata: DocumentMetadata
    ) {
        self.id = id
        self.filename = filename
        self.fileType = fileType.rawValue
        self.filePath = filePath
        self.extractedText = extractedText
        self.pageCount = pageCount
        self.fileSize = fileSize
        self.processedAt = Date()
        self.chunks = []

        // Encode metadata as JSON
        if let encoded = try? JSONEncoder().encode(metadata),
           let jsonString = String(data: encoded, encoding: .utf8) {
            self.metadata = jsonString
        } else {
            self.metadata = "{}"
        }
    }

    var decodedMetadata: DocumentMetadata? {
        guard let data = metadata.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(DocumentMetadata.self, from: data)
    }
}

@Model
final class DocumentChunk {
    @Attribute(.unique) var id: UUID
    var content: String
    // Store raw embedding bytes in an external file; SwiftData won't load it
    // unless the property is accessed, giving true lazy loading.
    @Attribute(.externalStorage) var embeddingsData: Data?
    var pageNumber: Int?
    var sectionTitle: String?
    var chunkIndex: Int
    var tokenCount: Int?

    // In-memory cache so decoding [Float] from Data only happens once per object lifetime.
    @Transient var cachedEmbedding: [Float]?

    var document: UploadedDocument?

    init(
        id: UUID = UUID(),
        content: String,
        embeddings: [Float]? = nil,
        pageNumber: Int? = nil,
        sectionTitle: String? = nil,
        chunkIndex: Int,
        tokenCount: Int? = nil
    ) {
        self.id = id
        self.content = content
        self.pageNumber = pageNumber
        self.sectionTitle = sectionTitle
        self.chunkIndex = chunkIndex
        self.tokenCount = tokenCount

        // Encode the float elements as their raw bytes
        if let embeddings = embeddings {
            self.embeddingsData = embeddings.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }

    var embeddings: [Float]? {
        // Return cached copy if already decoded
        if let cached = cachedEmbedding { return cached }
        guard let data = embeddingsData else { return nil }
        let decoded = data.withUnsafeBytes { buffer in
            Array(buffer.bindMemory(to: Float.self))
        }
        cachedEmbedding = decoded
        return decoded
    }
}

@Model
final class WebCapture {
    @Attribute(.unique) var id: UUID
    var url: String
    var pageTitle: String
    var extractedContent: String
    var capturedAt: Date
    var faviconData: Data?

    var source: ProjectSource?

    init(
        id: UUID = UUID(),
        url: String,
        pageTitle: String,
        extractedContent: String,
        capturedAt: Date = Date()
    ) {
        self.id = id
        self.url = url
        self.pageTitle = pageTitle
        self.extractedContent = extractedContent
        self.capturedAt = capturedAt
    }
}

@Model
final class AudioTranscription {
    @Attribute(.unique) var id: UUID
    var filename: String
    var filePath: String
    var transcription: String
    var duration: TimeInterval
    var transcribedAt: Date
    var modelUsed: String

    var source: ProjectSource?

    init(
        id: UUID = UUID(),
        filename: String,
        filePath: String,
        transcription: String,
        duration: TimeInterval,
        modelUsed: String = "whisper"
    ) {
        self.id = id
        self.filename = filename
        self.filePath = filePath
        self.transcription = transcription
        self.duration = duration
        self.transcribedAt = Date()
        self.modelUsed = modelUsed
    }
}

@Model
final class ProjectNote {
    @Attribute(.unique) var id: UUID
    var title: String
    var content: String
    var noteType: String // NoteType.rawValue
    var createdAt: Date
    var updatedAt: Date
    var tags: [String]

    var source: ProjectSource?

    init(
        id: UUID = UUID(),
        title: String,
        content: String,
        noteType: NoteType = .manual,
        tags: [String] = []
    ) {
        self.id = id
        self.title = title
        self.content = content
        self.noteType = noteType.rawValue
        self.createdAt = Date()
        self.updatedAt = Date()
        self.tags = tags
    }
}

// MARK: - Supporting Types

enum DocumentType: String, Codable {
    case pdf
    case txt
    case markdown
    case docx
    case html
    case rtf
    case unknown

    static func fromURL(_ url: URL) -> DocumentType {
        switch url.pathExtension.lowercased() {
        case "pdf": return .pdf
        case "txt": return .txt
        case "md", "markdown": return .markdown
        case "docx", "doc": return .docx
        case "html", "htm": return .html
        case "rtf": return .rtf
        default: return .unknown
        }
    }
}

struct DocumentMetadata: Codable {
    var author: String?
    var creationDate: Date?
    var modificationDate: Date?
    var pageCount: Int?
    var wordCount: Int?
    var extractedSections: [String]
    var extractedEntities: [String]

    init(
        author: String? = nil,
        creationDate: Date? = nil,
        modificationDate: Date? = nil,
        pageCount: Int? = nil,
        wordCount: Int? = nil,
        extractedSections: [String] = [],
        extractedEntities: [String] = []
    ) {
        self.author = author
        self.creationDate = creationDate
        self.modificationDate = modificationDate
        self.pageCount = pageCount
        self.wordCount = wordCount
        self.extractedSections = extractedSections
        self.extractedEntities = extractedEntities
    }
}

enum NoteType: String, Codable {
    case manual // User-created
    case aiGenerated // Study guide, summary, etc.
    case extracted // Key points from documents
    case quiz // Generated quiz/assessment
}
