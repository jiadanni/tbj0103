import Foundation
import SwiftData

@MainActor
final class ArtifactService {
    private let modelContext: ModelContext
    private let semanticSearchEngine: SemanticSearchEngine

    init(modelContext: ModelContext, semanticSearchEngine: SemanticSearchEngine) {
        self.modelContext = modelContext
        self.semanticSearchEngine = semanticSearchEngine
    }

    /// Stores an artifact embedding by encoding it via the external data property
    func storeArtifactEmbedding(artifactId: UUID, embedding: [Float]) throws {
        let descriptor = FetchDescriptor<Artifact>(predicate: #Predicate { $0.id == artifactId })
        guard let artifact = try modelContext.fetch(descriptor).first else {
            throw AppError.notFound("Artifact not found")
        }
        
        artifact.embeddingsData = embedding.withUnsafeBufferPointer { Data(buffer: $0) }
        artifact.cachedEmbedding = embedding
        try modelContext.save()
    }

    /// Creates a new Artifact
    func createArtifact(
        workspaceId: UUID,
        sessionId: UUID?,
        messageId: String?,
        title: String,
        artifactType: ArtifactType,
        language: String,
        content: String,
        description: String,
        tags: [String],
        parentArtifactId: String?
    ) throws -> Artifact {
        // Fetch workspace
        let wsDescriptor = FetchDescriptor<Workspace>(predicate: #Predicate { $0.id == workspaceId })
        guard let workspace = try modelContext.fetch(wsDescriptor).first else {
            throw AppError.notFound("Workspace not found")
        }

        let tokenCount = estimateTokens(text: content)
        
        let artifact = Artifact(
            title: title,
            artifactType: artifactType,
            language: language,
            content: content,
            description: description,
            tags: tags,
            messageId: messageId,
            parentArtifactId: parentArtifactId
        )
        artifact.tokenCount = tokenCount
        artifact.workspace = workspace

        if let sId = sessionId {
            let sessionDescriptor = FetchDescriptor<ChatSession>(predicate: #Predicate { $0.id == sId })
            artifact.chatSession = try modelContext.fetch(sessionDescriptor).first
        }
        
        modelContext.insert(artifact)
        try modelContext.save()
        
        return artifact
    }

    /// Retrieves a single artifact by ID
    func getArtifact(id: UUID) throws -> Artifact {
        let descriptor = FetchDescriptor<Artifact>(predicate: #Predicate { $0.id == id })
        guard let artifact = try modelContext.fetch(descriptor).first else {
            throw AppError.notFound("Artifact not found")
        }
        return artifact
    }

    /// Lists all artifacts for a workspace, sorted by pinned first, then updated date
    func listArtifacts(workspaceId: UUID) throws -> [Artifact] {
        let descriptor = FetchDescriptor<Artifact>(predicate: #Predicate { $0.workspace?.id == workspaceId }, sortBy: [SortDescriptor(\.isPinned, order: .reverse), SortDescriptor(\.updatedAt, order: .reverse)])
        return try modelContext.fetch(descriptor)
    }

    /// Deletes an artifact
    func deleteArtifact(id: UUID) throws {
        let artifact = try getArtifact(id: id)
        modelContext.delete(artifact)
        try modelContext.save()
    }

    /// Pins or unpins an artifact
    func updateArtifactPin(id: UUID, isPinned: Bool) throws {
        let artifact = try getArtifact(id: id)
        artifact.isPinned = isPinned
        artifact.updatedAt = Date()
        try modelContext.save()
    }

    /// Semantically searches artifacts using the provided query embedding
    func searchArtifactsSemantic(workspaceId: UUID, queryEmbedding: [Float], limit: Int = 5) throws -> [(Artifact, Float)] {
        let descriptor = FetchDescriptor<Artifact>(predicate: #Predicate { $0.workspace?.id == workspaceId })
        let artifacts = try modelContext.fetch(descriptor)
        
        var results: [(Artifact, Float)] = []
        for artifact in artifacts {
            if let embedding = artifact.embeddings {
                let score = GraphAlgorithms.cosineSimilarity(queryEmbedding, embedding)
                results.append((artifact, score))
            }
        }
        
        results.sort { $0.1 > $1.1 }
        return Array(results.prefix(limit))
    }

    private func estimateTokens(text: String) -> Int {
        // 1 token ≈ 4 chars estimate
        return text.count / 4
    }
}
