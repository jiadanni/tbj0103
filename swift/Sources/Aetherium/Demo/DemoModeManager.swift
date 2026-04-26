import Foundation
import SwiftData

/// Manages the demo mode lifecycle.
/// When active, the app swaps its real persistent SwiftData container for an in-memory
/// container seeded with rich sample data. The real user store is never touched.
@MainActor
final class DemoModeManager: ObservableObject {

    @Published var isActive: Bool = false

    /// Non-nil only while demo mode is active. AetheriumApp resolves the container to
    /// use via: `demoModeManager.demoContainer ?? realContainer`.
    @Published var demoContainer: ModelContainer?

    /// Changes on every activate() / reset() so AetheriumApp's .id() triggers a full
    /// view-hierarchy rebuild whenever the container is swapped.
    @Published var containerID: UUID = UUID()

    // MARK: - Activation

    func activate(ollamaService: OllamaService) {
        do {
            let schema = Schema([
                Workspace.self,
                Project.self,
                ChatSession.self,
                LearningGoal.self,
                Message.self,
                Citation.self,
                ProjectSource.self,
                UploadedDocument.self,
                DocumentChunk.self,
                WebCapture.self,
                AudioTranscription.self,
                ProjectNote.self,
                ConceptNode.self,
                ConceptLink.self,
                ConceptMention.self,
                NoteTemplate.self,
                DailyNote.self,
                LearningCard.self,
                LearningPath.self,
                PathMilestone.self,
                Artifact.self,
                Memory.self,
                ThoughtQueueItem.self,
                ConversationSummary.self,
                ContextSnapshot.self,
                AIModelEntity.self
            ])
            let container = try ModelContainer(
                for: schema,
                configurations: SwiftData.ModelConfiguration(isStoredInMemoryOnly: true)
            )
            DemoDataService.seed(into: ModelContext(container))
            demoContainer = container
        } catch {
            // Fallback: activate with an empty in-memory container so UI still works
            demoContainer = try? ModelContainer(
                for: Workspace.self,
                configurations: SwiftData.ModelConfiguration(isStoredInMemoryOnly: true)
            )
        }

        ollamaService.demoResponseProvider = DemoResponseProvider.response(for:)
        ollamaService.isAvailable = true
        isActive = true
        containerID = UUID()
    }

    // MARK: - Reset

    /// Re-seeds the in-memory container without exiting demo mode.
    /// Useful for restoring pristine demo state between presentations.
    func reset(ollamaService: OllamaService) {
        do {
            let schema = Schema([
                Workspace.self,
                Project.self,
                ChatSession.self,
                LearningGoal.self,
                Message.self,
                Citation.self,
                ProjectSource.self,
                UploadedDocument.self,
                DocumentChunk.self,
                WebCapture.self,
                AudioTranscription.self,
                ProjectNote.self,
                ConceptNode.self,
                ConceptLink.self,
                ConceptMention.self,
                NoteTemplate.self,
                DailyNote.self,
                LearningCard.self,
                LearningPath.self,
                PathMilestone.self,
                Artifact.self,
                Memory.self,
                ThoughtQueueItem.self,
                ConversationSummary.self,
                ContextSnapshot.self,
                AIModelEntity.self
            ])
            let container = try ModelContainer(
                for: schema,
                configurations: SwiftData.ModelConfiguration(isStoredInMemoryOnly: true)
            )
            DemoDataService.seed(into: ModelContext(container))
            demoContainer = container
        } catch {
            demoContainer = try? ModelContainer(
                for: Workspace.self,
                configurations: SwiftData.ModelConfiguration(isStoredInMemoryOnly: true)
            )
        }
        ollamaService.demoResponseProvider = DemoResponseProvider.response(for:)
        ollamaService.isAvailable = true
        containerID = UUID()
    }

    // MARK: - Deactivation

    func deactivate(ollamaService: OllamaService, securityManager: SecurityManager) {
        ollamaService.demoResponseProvider = nil
        isActive = false
        demoContainer = nil
        securityManager.logout()
    }
}
