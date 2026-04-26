import Foundation

// MARK: - Backup Manifest

struct BackupManifest: Codable {
    var entries: [BackupEntry]

    init(entries: [BackupEntry] = []) {
        self.entries = entries
    }
}

struct BackupEntry: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let directoryName: String
    let projectCount: Int
    let totalItems: Int
    let changeSummary: String
    let sizeBytes: Int64
}

// MARK: - Backup Snapshot

struct BackupSnapshot: Codable {
    let backupID: UUID
    let createdAt: Date
    let appVersion: String
    let projects: [ProjectBackupData]
}

struct ProjectBackupData: Codable {
    let id: UUID
    let title: String
    let projectDescription: String
    let createdAt: Date
    let updatedAt: Date

    let learningGoals: [LearningGoalBackupData]
    let chatSessions: [ChatSessionBackupData]
    let sources: [ProjectSourceBackupData]
    let concepts: [ConceptNodeBackupData]
    let noteTemplates: [NoteTemplateBackupData]
    let dailyNotes: [DailyNoteBackupData]
    let learningCards: [LearningCardBackupData]
    let learningPaths: [LearningPathBackupData]
    let alarms: [CalendarAlarmBackupData]
}

struct LearningGoalBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let goalDescription: String
    let progress: Double
    let createdAt: Date
    let updatedAt: Date
    let prerequisiteIDs: [String]
    let relatedChatIDs: [String]
    let projectID: UUID?
}

struct ChatSessionBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let createdAt: Date
    let updatedAt: Date
    let modelName: String
    let isLocal: Bool
    let extractedTopics: [String]
    let relatedGoalIDs: [String]
    let parentMessageID: UUID?
    let branchLabel: String?
    let messages: [MessageBackupData]
    let projectID: UUID?
}

struct MessageBackupData: Codable, Identifiable {
    let id: UUID
    let content: String
    let role: String
    let timestamp: Date
    let tokenCount: Int?
    let citations: [CitationBackupData]
    let chatSessionID: UUID?
}

struct CitationBackupData: Codable, Identifiable {
    let id: UUID
    let sourceID: String
    let sourceTitle: String
    let sourceType: String
    let excerpt: String
    let relevanceScore: Double
    let pageNumber: Int?
    let messageID: UUID?
}

struct ConceptNodeBackupData: Codable, Identifiable {
    let id: UUID
    let name: String
    let conceptDescription: String?
    let createdAt: Date
    let lastReferencedAt: Date
    let referenceCount: Int
    let nodeType: String
    let aliases: [String]
    let tags: [String]
    let relatedGoalIDs: [String]
    let outgoingLinks: [ConceptLinkBackupData]
    let mentions: [ConceptMentionBackupData]
    let projectID: UUID?
}

struct ConceptLinkBackupData: Codable, Identifiable {
    let id: UUID
    let linkType: String
    let strength: Double
    let createdAt: Date
    let context: String?
    let sourceID: UUID?
    let targetID: UUID?
}

struct ConceptMentionBackupData: Codable, Identifiable {
    let id: UUID
    let mentionContext: String
    let position: Int
    let createdAt: Date
    let sourceType: String
    let sourceID: String
    let conceptID: UUID?
}

struct ProjectSourceBackupData: Codable, Identifiable {
    let id: UUID
    let sourceType: String
    let title: String
    let createdAt: Date
    let processedAt: Date?
    let isProcessing: Bool
    let projectID: UUID?
    let document: UploadedDocumentBackupData?
    let webpage: WebCaptureBackupData?
    let audioFile: AudioTranscriptionBackupData?
    let note: ProjectNoteBackupData?
}

struct UploadedDocumentBackupData: Codable, Identifiable {
    let id: UUID
    let filename: String
    let fileType: String
    let filePath: String
    let extractedText: String
    let pageCount: Int?
    let fileSize: Int64
    let processedAt: Date
    let metadata: String
    // Chunks stored without embeddings (large binary, regeneratable)
    let chunks: [DocumentChunkBackupData]
}

struct DocumentChunkBackupData: Codable, Identifiable {
    let id: UUID
    let content: String
    let pageNumber: Int?
    let sectionTitle: String?
    let chunkIndex: Int
    let tokenCount: Int?
    // embeddingsData intentionally excluded — regeneratable
}

struct WebCaptureBackupData: Codable, Identifiable {
    let id: UUID
    let url: String
    let pageTitle: String
    let extractedContent: String
    let capturedAt: Date
    let faviconData: Data?
}

struct AudioTranscriptionBackupData: Codable, Identifiable {
    let id: UUID
    let filename: String
    let filePath: String
    let transcription: String
    let duration: TimeInterval
    let transcribedAt: Date
    let modelUsed: String
}

struct ProjectNoteBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let content: String
    let noteType: String
    let createdAt: Date
    let updatedAt: Date
    let tags: [String]
}

struct NoteTemplateBackupData: Codable, Identifiable {
    let id: UUID
    let name: String
    let templateDescription: String?
    let content: String
    let category: String
    let isBuiltIn: Bool
    let createdAt: Date
    let tags: [String]
    let variables: [String]
    let projectID: UUID?
}

struct DailyNoteBackupData: Codable, Identifiable {
    let id: UUID
    let date: Date
    let content: String
    let mood: String?
    let productivity: Int?
    let completedTasks: [String]
    let learningHighlights: [String]
    let gratitude: [String]
    let createdAt: Date
    let updatedAt: Date
    let projectID: UUID?
    let noteID: UUID?
}

struct LearningCardBackupData: Codable, Identifiable {
    let id: UUID
    let front: String
    let back: String
    let cardType: String
    let difficulty: Int
    let tags: [String]
    let easeFactor: Double
    let interval: Int
    let repetitions: Int
    let nextReviewDate: Date
    let lastReviewDate: Date?
    let totalReviews: Int
    let correctReviews: Int
    let createdAt: Date
    let conceptID: UUID?
    let projectID: UUID?
}

struct LearningPathBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let pathDescription: String?
    let targetCompletionDate: Date?
    let isCompleted: Bool
    let createdAt: Date
    let completedAt: Date?
    let milestones: [PathMilestoneBackupData]
    let projectID: UUID?
}

struct PathMilestoneBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let milestoneDescription: String?
    let orderIndex: Int
    let isCompleted: Bool
    let completedAt: Date?
    let dueDate: Date?
    let learningPathID: UUID?
    let relatedConceptIDs: [UUID]
}

struct CalendarAlarmBackupData: Codable, Identifiable {
    let id: UUID
    let title: String
    let note: String?
    let durationSeconds: Int
    let fireDate: Date
    let isActive: Bool
    let isCompleted: Bool
    let inputPrompt: String?
    let createdAt: Date
    let projectID: UUID?
    let dailyNoteID: UUID?
}

// MARK: - Backup Changes

struct BackupChanges: Codable {
    let backupID: UUID
    let previousBackupID: UUID?
    let timestamp: Date
    let sections: [ChangeSection]
}

struct ChangeSection: Codable, Identifiable {
    var id: String { category }
    let category: String
    let added: [ChangeItem]
    let modified: [ChangeItem]
    let removed: [ChangeItem]

    var isEmpty: Bool { added.isEmpty && modified.isEmpty && removed.isEmpty }
}

struct ChangeItem: Codable, Identifiable {
    let id: UUID
    let title: String
    let detail: String?
}
