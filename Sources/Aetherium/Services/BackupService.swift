import Foundation
import SwiftData

@MainActor
class BackupService: ObservableObject {
    @Published var isBackingUp = false
    @Published var backupProgress: Double = 0.0
    @Published var lastBackupDate: Date?
    @Published var manifest: BackupManifest = BackupManifest()
    @Published var lastError: String?

    private let modelContext: ModelContext
    private var timer: Timer?
    private let settings = AppSettings.shared

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadManifest()
        lastBackupDate = manifest.entries.last?.timestamp
    }

    // MARK: - Scheduling

    func startScheduledBackups(intervalMinutes: Int) {
        stopScheduledBackups()
        let interval = TimeInterval(intervalMinutes * 60)
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.performBackupIfNeeded()
            }
        }
    }

    func stopScheduledBackups() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Backup Logic

    func performBackupIfNeeded() async {
        // Check if anything changed since last backup
        guard let lastDate = lastBackupDate else {
            await createBackup()
            return
        }

        let hasChanges = await checkForChanges(since: lastDate)
        if hasChanges {
            await createBackup()
        }
    }

    func createBackup() async {
        guard !isBackingUp else { return }
        isBackingUp = true
        backupProgress = 0.0
        lastError = nil

        defer {
            isBackingUp = false
            backupProgress = 0.0
        }

        do {
            backupProgress = 0.1

            // Fetch all projects with relationships
            let descriptor = FetchDescriptor<Workspace>(sortBy: [SortDescriptor(\.title)])
            let projects = try modelContext.fetch(descriptor)

            backupProgress = 0.2

            // Build snapshot
            let snapshot = buildSnapshot(from: projects)

            backupProgress = 0.5

            // Detect changes vs previous backup
            let previousDirName = manifest.entries.last?.directoryName
            let changes = detectChanges(current: snapshot, previousDirectoryName: previousDirName)

            backupProgress = 0.7

            // Write to disk
            let dirName = backupDirectoryName()
            let backupDir = backupBaseURL().appendingPathComponent(dirName)
            try FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)

            let snapshotData = try encoder.encode(snapshot)
            try snapshotData.write(to: backupDir.appendingPathComponent("snapshot.json"))

            let changesData = try encoder.encode(changes)
            try changesData.write(to: backupDir.appendingPathComponent("changes.json"))

            backupProgress = 0.9

            // Update manifest
            let totalItems = snapshot.projects.reduce(0) { total, p in
                total + p.chatSessions.count + p.sources.count + p.concepts.count
                + p.learningGoals.count + p.dailyNotes.count + p.learningCards.count
                + p.learningPaths.count + p.noteTemplates.count + p.alarms.count
            }

            let entry = BackupEntry(
                id: snapshot.backupID,
                timestamp: snapshot.createdAt,
                directoryName: dirName,
                projectCount: snapshot.projects.count,
                totalItems: totalItems,
                changeSummary: generateChangeSummaryLine(changes),
                sizeBytes: Int64(snapshotData.count + changesData.count)
            )

            manifest.entries.append(entry)
            pruneBackups(keepCount: settings.backupRetentionCount)
            saveManifest()

            lastBackupDate = snapshot.createdAt
            backupProgress = 1.0
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Restore

    func restoreFromBackup(_ entry: BackupEntry) async throws {
        let backupDir = backupBaseURL().appendingPathComponent(entry.directoryName)
        let snapshotURL = backupDir.appendingPathComponent("snapshot.json")
        let data = try Data(contentsOf: snapshotURL)
        let snapshot = try decoder.decode(BackupSnapshot.self, from: data)

        // Delete all existing data
        try deleteAllData()

        // Recreate from snapshot
        for projectData in snapshot.projects {
            restoreProject(projectData)
        }

        try modelContext.save()
    }

    // MARK: - Change Detection

    private func checkForChanges(since date: Date) async -> Bool {
        let predicate = #Predicate<Workspace> { $0.updatedAt > date }
        let desc = FetchDescriptor<Workspace>(predicate: predicate)
        let projectCount = (try? modelContext.fetchCount(desc)) ?? 0
        if projectCount > 0 { return true }

        let notePredicate = #Predicate<ProjectNote> { $0.updatedAt > date }
        let noteDesc = FetchDescriptor<ProjectNote>(predicate: notePredicate)
        let noteCount = (try? modelContext.fetchCount(noteDesc)) ?? 0
        if noteCount > 0 { return true }

        let dailyPredicate = #Predicate<DailyNote> { $0.updatedAt > date }
        let dailyDesc = FetchDescriptor<DailyNote>(predicate: dailyPredicate)
        let dailyCount = (try? modelContext.fetchCount(dailyDesc)) ?? 0
        return dailyCount > 0
    }

    func detectChanges(current: BackupSnapshot, previousDirectoryName: String?) -> BackupChanges {
        guard let prevDirName = previousDirectoryName else {
            // First backup — everything is "added"
            var sections: [ChangeSection] = []
            for project in current.projects {
                var added: [ChangeItem] = []
                added.append(ChangeItem(id: project.id, title: project.title, detail: "Project"))
                for s in project.chatSessions { added.append(ChangeItem(id: s.id, title: s.title, detail: "Chat")) }
                for s in project.sources { added.append(ChangeItem(id: s.id, title: s.title, detail: s.sourceType)) }
                for c in project.concepts { added.append(ChangeItem(id: c.id, title: c.name, detail: "Concept")) }
                for g in project.learningGoals { added.append(ChangeItem(id: g.id, title: g.title, detail: "Goal")) }
                for n in project.dailyNotes { added.append(ChangeItem(id: n.id, title: "Daily Note", detail: nil)) }
                for c in project.learningCards { added.append(ChangeItem(id: c.id, title: c.front, detail: "Card")) }
                for p in project.learningPaths { added.append(ChangeItem(id: p.id, title: p.title, detail: "Path")) }
                sections.append(ChangeSection(category: project.title, added: added, modified: [], removed: []))
            }
            return BackupChanges(backupID: current.backupID, previousBackupID: nil, timestamp: current.createdAt, sections: sections)
        }

        // Load previous snapshot
        let prevURL = backupBaseURL().appendingPathComponent(prevDirName).appendingPathComponent("snapshot.json")
        guard let prevData = try? Data(contentsOf: prevURL),
              let previous = try? decoder.decode(BackupSnapshot.self, from: prevData) else {
            return BackupChanges(backupID: current.backupID, previousBackupID: nil, timestamp: current.createdAt, sections: [])
        }

        let prevProjectMap = Dictionary(uniqueKeysWithValues: previous.projects.map { ($0.id, $0) })
        let curProjectMap = Dictionary(uniqueKeysWithValues: current.projects.map { ($0.id, $0) })

        var sections: [ChangeSection] = []

        // Diff projects
        let addedProjects = current.projects.filter { prevProjectMap[$0.id] == nil }
        let removedProjects = previous.projects.filter { curProjectMap[$0.id] == nil }
        let commonIDs = Set(current.projects.map(\.id)).intersection(Set(previous.projects.map(\.id)))

        for p in addedProjects {
            sections.append(ChangeSection(
                category: p.title,
                added: [ChangeItem(id: p.id, title: p.title, detail: "New project")],
                modified: [],
                removed: []
            ))
        }

        for p in removedProjects {
            sections.append(ChangeSection(
                category: p.title,
                added: [],
                modified: [],
                removed: [ChangeItem(id: p.id, title: p.title, detail: "Removed project")]
            ))
        }

        for projectID in commonIDs {
            guard let cur = curProjectMap[projectID], let prev = prevProjectMap[projectID] else { continue }
            let section = diffProject(current: cur, previous: prev)
            if !section.isEmpty {
                sections.append(section)
            }
        }

        return BackupChanges(
            backupID: current.backupID,
            previousBackupID: previous.backupID,
            timestamp: current.createdAt,
            sections: sections
        )
    }

    private func diffProject(current: ProjectBackupData, previous: ProjectBackupData) -> ChangeSection {
        var added: [ChangeItem] = []
        var modified: [ChangeItem] = []
        var removed: [ChangeItem] = []

        // Diff chat sessions
        diffCollection(
            current: current.chatSessions, previous: previous.chatSessions,
            id: \.id, title: \.title, label: "Chat",
            isModified: { a, b in a.messages.count != b.messages.count || a.updatedAt != b.updatedAt },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff sources
        diffCollection(
            current: current.sources, previous: previous.sources,
            id: \.id, title: \.title, label: "Source",
            isModified: { a, b in a.processedAt != b.processedAt },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff concepts
        diffCollection(
            current: current.concepts, previous: previous.concepts,
            id: \.id, title: \.name, label: "Concept",
            isModified: { a, b in a.referenceCount != b.referenceCount || a.lastReferencedAt != b.lastReferencedAt },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff goals
        diffCollection(
            current: current.learningGoals, previous: previous.learningGoals,
            id: \.id, title: \.title, label: "Goal",
            isModified: { a, b in a.progress != b.progress || a.updatedAt != b.updatedAt },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff daily notes
        diffCollection(
            current: current.dailyNotes, previous: previous.dailyNotes,
            id: \.id, title: { _ in "Daily Note" }, label: "Note",
            isModified: { a, b in a.updatedAt != b.updatedAt },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff learning cards
        diffCollection(
            current: current.learningCards, previous: previous.learningCards,
            id: \.id, title: \.front, label: "Card",
            isModified: { a, b in a.totalReviews != b.totalReviews },
            added: &added, modified: &modified, removed: &removed
        )

        // Diff learning paths
        diffCollection(
            current: current.learningPaths, previous: previous.learningPaths,
            id: \.id, title: \.title, label: "Path",
            isModified: { a, b in a.isCompleted != b.isCompleted || a.milestones.count != b.milestones.count },
            added: &added, modified: &modified, removed: &removed
        )

        return ChangeSection(category: current.title, added: added, modified: modified, removed: removed)
    }

    private func diffCollection<T>(
        current: [T], previous: [T],
        id: KeyPath<T, UUID>, title: KeyPath<T, String>, label: String,
        isModified: (T, T) -> Bool,
        added: inout [ChangeItem], modified: inout [ChangeItem], removed: inout [ChangeItem]
    ) {
        let prevMap = Dictionary(uniqueKeysWithValues: previous.map { ($0[keyPath: id], $0) })
        let curMap = Dictionary(uniqueKeysWithValues: current.map { ($0[keyPath: id], $0) })

        for item in current {
            let itemID = item[keyPath: id]
            if let prev = prevMap[itemID] {
                if isModified(item, prev) {
                    modified.append(ChangeItem(id: itemID, title: item[keyPath: title], detail: label))
                }
            } else {
                added.append(ChangeItem(id: itemID, title: item[keyPath: title], detail: label))
            }
        }

        for item in previous {
            let itemID = item[keyPath: id]
            if curMap[itemID] == nil {
                removed.append(ChangeItem(id: itemID, title: item[keyPath: title], detail: label))
            }
        }
    }

    private func diffCollection<T>(
        current: [T], previous: [T],
        id: KeyPath<T, UUID>, title: (T) -> String, label: String,
        isModified: (T, T) -> Bool,
        added: inout [ChangeItem], modified: inout [ChangeItem], removed: inout [ChangeItem]
    ) {
        let prevMap = Dictionary(uniqueKeysWithValues: previous.map { ($0[keyPath: id], $0) })
        let curMap = Dictionary(uniqueKeysWithValues: current.map { ($0[keyPath: id], $0) })

        for item in current {
            let itemID = item[keyPath: id]
            if let prev = prevMap[itemID] {
                if isModified(item, prev) {
                    modified.append(ChangeItem(id: itemID, title: title(item), detail: label))
                }
            } else {
                added.append(ChangeItem(id: itemID, title: title(item), detail: label))
            }
        }

        for item in previous {
            let itemID = item[keyPath: id]
            if curMap[itemID] == nil {
                removed.append(ChangeItem(id: itemID, title: title(item), detail: label))
            }
        }
    }

    func generateChangeSummaryLine(_ changes: BackupChanges) -> String {
        var counts: [String: (added: Int, modified: Int, removed: Int)] = [:]
        for section in changes.sections {
            for item in section.added {
                let label = item.detail ?? "Item"
                counts[label, default: (0, 0, 0)].added += 1
            }
            for item in section.modified {
                let label = item.detail ?? "Item"
                counts[label, default: (0, 0, 0)].modified += 1
            }
            for item in section.removed {
                let label = item.detail ?? "Item"
                counts[label, default: (0, 0, 0)].removed += 1
            }
        }

        if counts.isEmpty { return "No changes" }

        var parts: [String] = []
        for (label, c) in counts.sorted(by: { $0.key < $1.key }) {
            var sub: [String] = []
            if c.added > 0 { sub.append("+\(c.added)") }
            if c.modified > 0 { sub.append("~\(c.modified)") }
            if c.removed > 0 { sub.append("-\(c.removed)") }
            parts.append("\(sub.joined(separator: ", ")) \(label.lowercased())\(c.added + c.modified + c.removed > 1 ? "s" : "")")
        }
        return parts.joined(separator: ", ")
    }

    // MARK: - Snapshot Building

    private func buildSnapshot(from projects: [Workspace]) -> BackupSnapshot {
        let projectData = projects.map { buildProjectData($0) }
        return BackupSnapshot(
            backupID: UUID(),
            createdAt: Date(),
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0",
            projects: projectData
        )
    }

    private func buildProjectData(_ project: Workspace) -> ProjectBackupData {
        // Fetch related NoteTemplates
        let projectID = project.id
        let templateDescriptor = FetchDescriptor<NoteTemplate>(predicate: #Predicate { $0.project?.id == projectID })
        let templates = (try? modelContext.fetch(templateDescriptor)) ?? []

        // Fetch related DailyNotes
        let dailyDescriptor = FetchDescriptor<DailyNote>(predicate: #Predicate { $0.project?.id == projectID })
        let dailyNotes = (try? modelContext.fetch(dailyDescriptor)) ?? []

        // Fetch related LearningCards
        let cardDescriptor = FetchDescriptor<LearningCard>(predicate: #Predicate { $0.project?.id == projectID })
        let cards = (try? modelContext.fetch(cardDescriptor)) ?? []

        // Fetch related LearningPaths
        let pathDescriptor = FetchDescriptor<LearningPath>(predicate: #Predicate { $0.project?.id == projectID })
        let paths = (try? modelContext.fetch(pathDescriptor)) ?? []

        // Fetch related CalendarAlarms
        let alarmDescriptor = FetchDescriptor<CalendarAlarm>(predicate: #Predicate { $0.project?.id == projectID })
        let alarms = (try? modelContext.fetch(alarmDescriptor)) ?? []

        return ProjectBackupData(
            id: project.id,
            title: project.title,
            projectDescription: project.workspaceDescription,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            learningGoals: project.learningGoals.map { buildGoalData($0) },
            chatSessions: project.chatSessions.map { buildChatData($0) },
            sources: project.sources.map { buildSourceData($0) },
            concepts: project.concepts.map { buildConceptData($0) },
            noteTemplates: templates.map { buildTemplateData($0) },
            dailyNotes: dailyNotes.map { buildDailyNoteData($0) },
            learningCards: cards.map { buildCardData($0) },
            learningPaths: paths.map { buildPathData($0) },
            alarms: alarms.map { buildAlarmData($0) }
        )
    }

    private func buildGoalData(_ goal: LearningGoal) -> LearningGoalBackupData {
        LearningGoalBackupData(
            id: goal.id, title: goal.title, goalDescription: goal.goalDescription,
            progress: goal.progress, createdAt: goal.createdAt, updatedAt: goal.updatedAt,
            prerequisiteIDs: goal.prerequisiteIDs, relatedChatIDs: goal.relatedChatIDs,
            projectID: goal.project?.id
        )
    }

    private func buildChatData(_ chat: ChatSession) -> ChatSessionBackupData {
        ChatSessionBackupData(
            id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
            modelName: chat.modelName, isLocal: chat.isLocal, extractedTopics: chat.extractedTopics,
            relatedGoalIDs: chat.relatedGoalIDs, parentMessageID: chat.parentMessageID,
            branchLabel: chat.branchLabel,
            messages: chat.messages.map { buildMessageData($0) },
            projectID: chat.project?.id
        )
    }

    private func buildMessageData(_ msg: Message) -> MessageBackupData {
        MessageBackupData(
            id: msg.id, content: msg.content, role: msg.role.rawValue,
            timestamp: msg.timestamp, tokenCount: msg.tokenCount,
            citations: msg.citations.map { buildCitationData($0) },
            chatSessionID: msg.chatSession?.id
        )
    }

    private func buildCitationData(_ c: Citation) -> CitationBackupData {
        CitationBackupData(
            id: c.id, sourceID: c.sourceID, sourceTitle: c.sourceTitle,
            sourceType: c.sourceType, excerpt: c.excerpt,
            relevanceScore: c.relevanceScore, pageNumber: c.pageNumber,
            messageID: c.message?.id
        )
    }

    private func buildConceptData(_ node: ConceptNode) -> ConceptNodeBackupData {
        ConceptNodeBackupData(
            id: node.id, name: node.name, conceptDescription: node.conceptDescription,
            createdAt: node.createdAt, lastReferencedAt: node.lastReferencedAt,
            referenceCount: node.referenceCount, nodeType: node.nodeType,
            aliases: node.aliases, tags: node.tags, relatedGoalIDs: node.relatedGoalIDs,
            outgoingLinks: node.outgoingLinks.map { buildLinkData($0) },
            mentions: node.mentions.map { buildMentionData($0) },
            projectID: node.project?.id
        )
    }

    private func buildLinkData(_ link: ConceptLink) -> ConceptLinkBackupData {
        ConceptLinkBackupData(
            id: link.id, linkType: link.linkType, strength: link.strength,
            createdAt: link.createdAt, context: link.context,
            sourceID: link.source?.id, targetID: link.target?.id
        )
    }

    private func buildMentionData(_ mention: ConceptMention) -> ConceptMentionBackupData {
        ConceptMentionBackupData(
            id: mention.id, mentionContext: mention.mentionContext,
            position: mention.position, createdAt: mention.createdAt,
            sourceType: mention.sourceType, sourceID: mention.sourceID,
            conceptID: mention.concept?.id
        )
    }

    private func buildSourceData(_ source: ProjectSource) -> ProjectSourceBackupData {
        ProjectSourceBackupData(
            id: source.id, sourceType: source.sourceType, title: source.title,
            createdAt: source.createdAt, processedAt: source.processedAt,
            isProcessing: source.isProcessing, projectID: source.project?.id,
            document: source.document.map { buildDocumentData($0) },
            webpage: source.webpage.map { buildWebCaptureData($0) },
            audioFile: source.audioFile.map { buildAudioData($0) },
            note: source.note.map { buildNoteData($0) }
        )
    }

    private func buildDocumentData(_ doc: UploadedDocument) -> UploadedDocumentBackupData {
        UploadedDocumentBackupData(
            id: doc.id, filename: doc.filename, fileType: doc.fileType,
            filePath: doc.filePath, extractedText: doc.extractedText,
            pageCount: doc.pageCount, fileSize: doc.fileSize,
            processedAt: doc.processedAt, metadata: doc.metadata,
            chunks: doc.chunks.map { buildChunkData($0) }
        )
    }

    private func buildChunkData(_ chunk: DocumentChunk) -> DocumentChunkBackupData {
        DocumentChunkBackupData(
            id: chunk.id, content: chunk.content, pageNumber: chunk.pageNumber,
            sectionTitle: chunk.sectionTitle, chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount
        )
    }

    private func buildWebCaptureData(_ web: WebCapture) -> WebCaptureBackupData {
        WebCaptureBackupData(
            id: web.id, url: web.url, pageTitle: web.pageTitle,
            extractedContent: web.extractedContent, capturedAt: web.capturedAt,
            faviconData: web.faviconData
        )
    }

    private func buildAudioData(_ audio: AudioTranscription) -> AudioTranscriptionBackupData {
        AudioTranscriptionBackupData(
            id: audio.id, filename: audio.filename, filePath: audio.filePath,
            transcription: audio.transcription, duration: audio.duration,
            transcribedAt: audio.transcribedAt, modelUsed: audio.modelUsed
        )
    }

    private func buildNoteData(_ note: ProjectNote) -> ProjectNoteBackupData {
        ProjectNoteBackupData(
            id: note.id, title: note.title, content: note.content,
            noteType: note.noteType, createdAt: note.createdAt,
            updatedAt: note.updatedAt, tags: note.tags
        )
    }

    private func buildTemplateData(_ t: NoteTemplate) -> NoteTemplateBackupData {
        NoteTemplateBackupData(
            id: t.id, name: t.name, templateDescription: t.templateDescription,
            content: t.content, category: t.category, isBuiltIn: t.isBuiltIn,
            createdAt: t.createdAt, tags: t.tags, variables: t.variables,
            projectID: t.project?.id
        )
    }

    private func buildDailyNoteData(_ d: DailyNote) -> DailyNoteBackupData {
        DailyNoteBackupData(
            id: d.id, date: d.date, content: d.content, mood: d.mood,
            productivity: d.productivity, completedTasks: d.completedTasks,
            learningHighlights: d.learningHighlights, gratitude: d.gratitude,
            createdAt: d.createdAt, updatedAt: d.updatedAt,
            projectID: d.project?.id, noteID: d.note?.id
        )
    }

    private func buildCardData(_ c: LearningCard) -> LearningCardBackupData {
        LearningCardBackupData(
            id: c.id, front: c.front, back: c.back, cardType: c.cardType,
            difficulty: c.difficulty, tags: c.tags, easeFactor: c.easeFactor,
            interval: c.interval, repetitions: c.repetitions,
            nextReviewDate: c.nextReviewDate, lastReviewDate: c.lastReviewDate,
            totalReviews: c.totalReviews, correctReviews: c.correctReviews,
            createdAt: c.createdAt, conceptID: c.concept?.id, projectID: c.project?.id
        )
    }

    private func buildPathData(_ p: LearningPath) -> LearningPathBackupData {
        LearningPathBackupData(
            id: p.id, title: p.title, pathDescription: p.pathDescription,
            targetCompletionDate: p.targetCompletionDate, isCompleted: p.isCompleted,
            createdAt: p.createdAt, completedAt: p.completedAt,
            milestones: p.milestones.map { buildMilestoneData($0) },
            projectID: p.project?.id
        )
    }

    private func buildMilestoneData(_ m: PathMilestone) -> PathMilestoneBackupData {
        PathMilestoneBackupData(
            id: m.id, title: m.title, milestoneDescription: m.milestoneDescription,
            orderIndex: m.orderIndex, isCompleted: m.isCompleted,
            completedAt: m.completedAt, dueDate: m.dueDate,
            learningPathID: m.learningPath?.id,
            relatedConceptIDs: m.relatedConcepts.map(\.id)
        )
    }

    private func buildAlarmData(_ a: CalendarAlarm) -> CalendarAlarmBackupData {
        CalendarAlarmBackupData(
            id: a.id, title: a.title, note: a.note,
            durationSeconds: a.durationSeconds, fireDate: a.fireDate,
            isActive: a.isActive, isCompleted: a.isCompleted,
            inputPrompt: a.inputPrompt, createdAt: a.createdAt,
            projectID: a.project?.id, dailyNoteID: a.dailyNote?.id
        )
    }

    // MARK: - Restore Helpers

    private func deleteAllData() throws {
        try modelContext.delete(model: Workspace.self)
        try modelContext.delete(model: NoteTemplate.self)
        try modelContext.delete(model: DailyNote.self)
        try modelContext.delete(model: LearningCard.self)
        try modelContext.delete(model: LearningPath.self)
        try modelContext.delete(model: CalendarAlarm.self)
        try modelContext.save()
    }

    private func restoreProject(_ data: ProjectBackupData) {
        let project = Workspace(title: data.title, description: data.projectDescription)
        project.createdAt = data.createdAt
        project.updatedAt = data.updatedAt
        modelContext.insert(project)

        // Build concept node map for linking
        var conceptMap: [UUID: ConceptNode] = [:]

        // Restore concepts
        for cData in data.concepts {
            let node = ConceptNode(
                name: cData.name,
                description: cData.conceptDescription,
                nodeType: ConceptNodeType(rawValue: cData.nodeType) ?? .topic,
                aliases: cData.aliases,
                tags: cData.tags
            )
            node.createdAt = cData.createdAt
            node.lastReferencedAt = cData.lastReferencedAt
            node.referenceCount = cData.referenceCount
            node.relatedGoalIDs = cData.relatedGoalIDs
            node.project = project
            modelContext.insert(node)
            conceptMap[cData.id] = node
        }

        // Restore concept links
        for cData in data.concepts {
            guard let sourceNode = conceptMap[cData.id] else { continue }
            for linkData in cData.outgoingLinks {
                let targetNode = linkData.targetID.flatMap { conceptMap[$0] } ?? sourceNode
                let link = ConceptLink(
                    source: sourceNode,
                    target: targetNode,
                    linkType: ConceptLinkType(rawValue: linkData.linkType) ?? .related,
                    strength: linkData.strength,
                    context: linkData.context
                )
                link.createdAt = linkData.createdAt
                modelContext.insert(link)
            }

            for mentionData in cData.mentions {
                let mention = ConceptMention(
                    mentionContext: mentionData.mentionContext,
                    position: mentionData.position,
                    sourceType: MentionSourceType(rawValue: mentionData.sourceType) ?? .message,
                    sourceID: mentionData.sourceID
                )
                mention.createdAt = mentionData.createdAt
                mention.concept = sourceNode
                modelContext.insert(mention)
            }
        }

        // Restore learning goals
        for gData in data.learningGoals {
            let goal = LearningGoal(title: gData.title, description: gData.goalDescription)
            goal.progress = gData.progress
            goal.createdAt = gData.createdAt
            goal.updatedAt = gData.updatedAt
            goal.prerequisiteIDs = gData.prerequisiteIDs
            goal.relatedChatIDs = gData.relatedChatIDs
            goal.project = project
            modelContext.insert(goal)
        }

        // Restore chat sessions
        for chatData in data.chatSessions {
            let chat = ChatSession(modelName: chatData.modelName)
            chat.title = chatData.title
            chat.createdAt = chatData.createdAt
            chat.updatedAt = chatData.updatedAt
            chat.isLocal = chatData.isLocal
            chat.extractedTopics = chatData.extractedTopics
            chat.relatedGoalIDs = chatData.relatedGoalIDs
            chat.parentMessageID = chatData.parentMessageID
            chat.branchLabel = chatData.branchLabel
            chat.project = project
            modelContext.insert(chat)

            for msgData in chatData.messages {
                let role = MessageRole(rawValue: msgData.role) ?? .user
                let msg = Message(content: msgData.content, role: role)
                msg.timestamp = msgData.timestamp
                msg.tokenCount = msgData.tokenCount
                msg.chatSession = chat
                modelContext.insert(msg)

                for citData in msgData.citations {
                    let cit = Citation(
                        sourceID: citData.sourceID,
                        sourceTitle: citData.sourceTitle,
                        sourceType: citData.sourceType,
                        excerpt: citData.excerpt,
                        relevanceScore: citData.relevanceScore
                    )
                    cit.pageNumber = citData.pageNumber
                    cit.message = msg
                    modelContext.insert(cit)
                }
            }
        }

        // Restore sources
        for sData in data.sources {
            let source = ProjectSource(sourceType: ProjectSourceType(rawValue: sData.sourceType) ?? .document, title: sData.title)
            source.createdAt = sData.createdAt
            source.processedAt = sData.processedAt
            source.isProcessing = sData.isProcessing
            source.project = project
            modelContext.insert(source)

            if let docData = sData.document {
                let docMetadata: DocumentMetadata
                if let metaData = docData.metadata.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(DocumentMetadata.self, from: metaData) {
                    docMetadata = decoded
                } else {
                    docMetadata = DocumentMetadata()
                }
                let doc = UploadedDocument(
                    filename: docData.filename,
                    fileType: DocumentType(rawValue: docData.fileType) ?? .unknown,
                    filePath: docData.filePath,
                    extractedText: docData.extractedText,
                    pageCount: docData.pageCount,
                    fileSize: docData.fileSize,
                    metadata: docMetadata
                )
                doc.source = source
                modelContext.insert(doc)

                for chunkData in docData.chunks {
                    let chunk = DocumentChunk(
                        content: chunkData.content,
                        chunkIndex: chunkData.chunkIndex
                    )
                    chunk.pageNumber = chunkData.pageNumber
                    chunk.sectionTitle = chunkData.sectionTitle
                    chunk.tokenCount = chunkData.tokenCount
                    chunk.document = doc
                    modelContext.insert(chunk)
                }
            }

            if let webData = sData.webpage {
                let web = WebCapture(url: webData.url, pageTitle: webData.pageTitle, extractedContent: webData.extractedContent)
                web.capturedAt = webData.capturedAt
                web.faviconData = webData.faviconData
                web.source = source
                modelContext.insert(web)
            }

            if let audioData = sData.audioFile {
                let audio = AudioTranscription(
                    filename: audioData.filename,
                    filePath: audioData.filePath,
                    transcription: audioData.transcription,
                    duration: audioData.duration,
                    modelUsed: audioData.modelUsed
                )
                audio.transcribedAt = audioData.transcribedAt
                audio.source = source
                modelContext.insert(audio)
            }

            if let noteData = sData.note {
                let note = ProjectNote(title: noteData.title, content: noteData.content, noteType: NoteType(rawValue: noteData.noteType) ?? .manual)
                note.createdAt = noteData.createdAt
                note.updatedAt = noteData.updatedAt
                note.tags = noteData.tags
                note.source = source
                modelContext.insert(note)
            }
        }

        // Restore note templates
        for tData in data.noteTemplates {
            let template = NoteTemplate(name: tData.name, content: tData.content, category: TemplateCategory(rawValue: tData.category) ?? .general)
            template.templateDescription = tData.templateDescription
            template.isBuiltIn = tData.isBuiltIn
            template.createdAt = tData.createdAt
            template.tags = tData.tags
            template.variables = tData.variables
            template.project = project
            modelContext.insert(template)
        }

        // Restore daily notes
        for dData in data.dailyNotes {
            let daily = DailyNote(date: dData.date)
            daily.content = dData.content
            daily.mood = dData.mood
            daily.productivity = dData.productivity
            daily.completedTasks = dData.completedTasks
            daily.learningHighlights = dData.learningHighlights
            daily.gratitude = dData.gratitude
            daily.createdAt = dData.createdAt
            daily.updatedAt = dData.updatedAt
            daily.project = project
            modelContext.insert(daily)
        }

        // Restore learning cards
        for cData in data.learningCards {
            let card = LearningCard(front: cData.front, back: cData.back, cardType: CardType(rawValue: cData.cardType) ?? .basic)
            card.difficulty = cData.difficulty
            card.tags = cData.tags
            card.easeFactor = cData.easeFactor
            card.interval = cData.interval
            card.repetitions = cData.repetitions
            card.nextReviewDate = cData.nextReviewDate
            card.lastReviewDate = cData.lastReviewDate
            card.totalReviews = cData.totalReviews
            card.correctReviews = cData.correctReviews
            card.createdAt = cData.createdAt
            if let conceptID = cData.conceptID {
                card.concept = conceptMap[conceptID]
            }
            card.project = project
            modelContext.insert(card)
        }

        // Restore learning paths
        for pData in data.learningPaths {
            let path = LearningPath(title: pData.title)
            path.pathDescription = pData.pathDescription
            path.targetCompletionDate = pData.targetCompletionDate
            path.isCompleted = pData.isCompleted
            path.createdAt = pData.createdAt
            path.completedAt = pData.completedAt
            path.project = project
            modelContext.insert(path)

            for mData in pData.milestones {
                let milestone = PathMilestone(title: mData.title, orderIndex: mData.orderIndex)
                milestone.milestoneDescription = mData.milestoneDescription
                milestone.isCompleted = mData.isCompleted
                milestone.completedAt = mData.completedAt
                milestone.dueDate = mData.dueDate
                milestone.learningPath = path
                milestone.relatedConcepts = mData.relatedConceptIDs.compactMap { conceptMap[$0] }
                modelContext.insert(milestone)
            }
        }

        // Restore alarms
        for aData in data.alarms {
            let alarm = CalendarAlarm(title: aData.title, note: aData.note, durationSeconds: aData.durationSeconds, inputPrompt: aData.inputPrompt)
            alarm.fireDate = aData.fireDate
            alarm.isActive = aData.isActive
            alarm.isCompleted = aData.isCompleted
            alarm.createdAt = aData.createdAt
            alarm.project = project
            modelContext.insert(alarm)
        }
    }

    // MARK: - Pruning

    func pruneBackups(keepCount: Int) {
        guard manifest.entries.count > keepCount else { return }
        let toRemove = manifest.entries.prefix(manifest.entries.count - keepCount)
        for entry in toRemove {
            let dir = backupBaseURL().appendingPathComponent(entry.directoryName)
            try? FileManager.default.removeItem(at: dir)
        }
        manifest.entries = Array(manifest.entries.suffix(keepCount))
    }

    // MARK: - File System

    func backupBaseURL() -> URL {
        if let customURL = settings.backupLocationURL {
            _ = customURL.startAccessingSecurityScopedResource()
            return customURL
        }
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("Aetherium/Backups")
    }

    private func backupDirectoryName() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return "backup_\(formatter.string(from: Date()))"
    }

    private func manifestURL() -> URL {
        backupBaseURL().appendingPathComponent("manifest.json")
    }

    private func loadManifest() {
        let url = manifestURL()
        guard let data = try? Data(contentsOf: url),
              let loaded = try? decoder.decode(BackupManifest.self, from: data) else {
            manifest = BackupManifest()
            return
        }
        manifest = loaded
    }

    private func saveManifest() {
        do {
            let dir = backupBaseURL()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try encoder.encode(manifest)
            try data.write(to: manifestURL())
        } catch {
            lastError = "Failed to save manifest: \(error.localizedDescription)"
        }
    }
}
