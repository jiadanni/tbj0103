import Foundation
import SwiftData

// MARK: - Note Template Engine

@MainActor
class NoteTemplateEngine: ObservableObject {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Template Processing

    /// Process template content with variables
    func processTemplate(
        _ template: NoteTemplate,
        project: Workspace? = nil,
        customVariables: [String: String] = [:]
    ) -> String {
        var content = template.content

        // Built-in variables
        let variables: [String: String] = [
            "date": formatDate(Date(), style: .medium),
            "time": formatTime(Date()),
            "datetime": formatDateTime(Date()),
            "day": formatDay(Date()),
            "week": formatWeek(Date()),
            "month": formatMonth(Date()),
            "year": formatYear(Date()),
            "project": project?.title ?? "No Project",
            "project_description": project?.workspaceDescription ?? "",
            "username": NSUserName(),
            "timestamp": Date().timeIntervalSince1970.description
        ].merging(customVariables) { _, custom in custom }

        // Replace variables
        for (key, value) in variables {
            content = content.replacingOccurrences(of: "{{\(key)}}", with: value)
        }

        return content
    }

    /// Create note from template
    func createNoteFromTemplate(
        _ template: NoteTemplate,
        project: Workspace,
        customVariables: [String: String] = [:]
    ) -> ProjectNote {
        let processedContent = processTemplate(
            template,
            project: project,
            customVariables: customVariables
        )

        let note = ProjectNote(
            title: processTemplate(template, project: project, customVariables: ["title_only": template.name]).replacingOccurrences(of: "{{\(template.name)}}", with: template.name),
            content: processedContent,
            noteType: .manual,
            tags: template.tags
        )

        return note
    }

    // MARK: - Template Library

    /// Get all templates for a project
    func getTemplates(for project: Workspace? = nil) -> [NoteTemplate] {
        let descriptor: FetchDescriptor<NoteTemplate>

        if let project = project {
            let projectId = project.id
            descriptor = FetchDescriptor<NoteTemplate>(
                predicate: #Predicate { template in
                    template.project?.id == projectId || template.isBuiltIn
                }
            )
        } else {
            descriptor = FetchDescriptor<NoteTemplate>(
                predicate: #Predicate { template in
                    template.isBuiltIn
                }
            )
        }

        return (try? modelContext.fetch(descriptor)) ?? []
    }

    /// Get templates by category
    func getTemplates(category: TemplateCategory) -> [NoteTemplate] {
        let descriptor = FetchDescriptor<NoteTemplate>(
            predicate: #Predicate { template in
                template.category == category.rawValue
            }
        )

        return (try? modelContext.fetch(descriptor)) ?? []
    }

    /// Initialize built-in templates
    func initializeBuiltInTemplates() {
        let existingTemplates = (try? modelContext.fetch(FetchDescriptor<NoteTemplate>(
            predicate: #Predicate { $0.isBuiltIn }
        ))) ?? []

        guard existingTemplates.isEmpty else { return }

        let templates = createBuiltInTemplates()
        for template in templates {
            modelContext.insert(template)
        }
    }

    // MARK: - Daily Note Management

    /// Get or create daily note for a specific date
    func getOrCreateDailyNote(
        for date: Date,
        project: Workspace,
        template: NoteTemplate? = nil
    ) -> DailyNote {
        let normalizedDate = DailyNote.normalizeDate(date)

        // Check if daily note exists
        let projectId = project.id
        let descriptor = FetchDescriptor<DailyNote>(
            predicate: #Predicate { note in
                note.date == normalizedDate && note.project?.id == projectId
            }
        )

        if let existing = try? modelContext.fetch(descriptor).first {
            return existing
        }

        // Create new daily note
        let dailyNote = DailyNote(date: normalizedDate)
        dailyNote.project = project

        // Apply template if provided
        if let template = template {
            dailyNote.content = processTemplate(
                template,
                project: project,
                customVariables: ["date": formatDate(date, style: .full)]
            )
        } else {
            // Use default daily note template
            dailyNote.content = defaultDailyNoteContent(for: date)
        }

        modelContext.insert(dailyNote)

        // Create associated ProjectNote
        let projectNote = ProjectNote(
            title: "Daily Note - \(formatDate(date, style: .medium))",
            content: dailyNote.content,
            noteType: .manual,
            tags: ["daily-note"]
        )
        dailyNote.note = projectNote

        return dailyNote
    }

    /// Get daily notes for a date range
    func getDailyNotes(
        from startDate: Date,
        to endDate: Date,
        project: Workspace
    ) -> [DailyNote] {
        let projectId = project.id
        let descriptor = FetchDescriptor<DailyNote>(
            predicate: #Predicate { note in
                note.project?.id == projectId &&
                note.date >= startDate &&
                note.date <= endDate
            },
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )

        return (try? modelContext.fetch(descriptor)) ?? []
    }

    // MARK: - Formatting Helpers

    private func formatDate(_ date: Date, style: DateFormatter.Style) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = style
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func formatDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func formatDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE" // Full day name
        return formatter.string(from: date)
    }

    private func formatWeek(_ date: Date) -> String {
        let calendar = Calendar.current
        let week = calendar.component(.weekOfYear, from: date)
        return "Week \(week)"
    }

    private func formatMonth(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM" // Full month name
        return formatter.string(from: date)
    }

    private func formatYear(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy"
        return formatter.string(from: date)
    }

    // MARK: - Default Templates

    private func defaultDailyNoteContent(for date: Date) -> String {
        """
        # Daily Note - {{date}}

        ## 🎯 Goals for Today
        -

        ## 📚 Learning
        -

        ## ✅ Completed
        -

        ## 💭 Thoughts & Reflections


        ## 🔗 Related
        -

        ---
        *Created: {{datetime}}*
        """
    }

    private func createBuiltInTemplates() -> [NoteTemplate] {
        return [
            // Daily Note Template
            NoteTemplate(
                name: "Daily Note",
                description: "Standard daily note with goals, learning, and reflection",
                content: """
                # {{day}}, {{date}}

                ## 🎯 Today's Goals
                -

                ## 📚 What I Learned
                -

                ## ✅ Completed Tasks
                -

                ## 💡 Ideas & Insights
                -

                ## 🙏 Gratitude
                -

                ## 📝 Notes


                ---
                *Productivity: [ ] Low [ ] Medium [ ] High*
                *Mood: [ ] 😔 [ ] 😐 [ ] 🙂 [ ] 😊 [ ] 🤩*
                """,
                category: .daily,
                isBuiltIn: true,
                tags: ["daily"],
                variables: ["day", "date"]
            ),

            // Meeting Notes Template
            NoteTemplate(
                name: "Meeting Notes",
                description: "Template for recording meeting minutes",
                content: """
                # Meeting: [Topic]
                **Date:** {{date}}
                **Time:** {{time}}
                **Attendees:**

                ## Agenda
                1.

                ## Discussion Points
                -

                ## Decisions Made
                -

                ## Action Items
                - [ ] Task 1 (@person)
                - [ ] Task 2 (@person)

                ## Follow-up
                -

                ## Next Meeting
                **Date:**
                **Topics:**
                """,
                category: .meeting,
                isBuiltIn: true,
                tags: ["meeting"],
                variables: ["date", "time"]
            ),

            // Learning Session Template
            NoteTemplate(
                name: "Learning Session",
                description: "Template for structured learning sessions",
                content: """
                # Learning: [Topic]
                **Date:** {{date}}
                **Project:** {{project}}

                ## 📖 What I'm Learning


                ## 🎯 Learning Goals
                - [ ]
                - [ ]
                - [ ]

                ## 📝 Key Concepts
                - [[Concept 1]]:
                - [[Concept 2]]:

                ## 💻 Practice & Examples
                ```
                // Code examples
                ```

                ## ❓ Questions
                -

                ## 🔗 Resources
                -

                ## 💡 Summary


                ---
                *Next: *
                """,
                category: .learning,
                isBuiltIn: true,
                tags: ["learning"],
                variables: ["date", "project"]
            ),

            // Weekly Review Template
            NoteTemplate(
                name: "Weekly Review",
                description: "Reflect on the week's progress",
                content: """
                # Weekly Review - {{week}}, {{year}}

                ## 🎯 Goals Review
                ### Completed
                -

                ### In Progress
                -

                ### Deferred
                -

                ## 📚 What I Learned This Week
                -

                ## 🏆 Wins & Achievements
                -

                ## 🔄 What I'd Do Differently
                -

                ## 📊 Stats
                - Notes Created:
                - Concepts Learned:
                - Documents Processed:

                ## 🎯 Next Week's Focus
                1.
                2.
                3.

                ---
                *Overall Rating: [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5*
                """,
                category: .retrospective,
                isBuiltIn: true,
                tags: ["weekly", "review"],
                variables: ["week", "year"]
            ),

            // Project Planning Template
            NoteTemplate(
                name: "Project Planning",
                description: "Template for planning new learning projects",
                content: """
                # Project: {{project}}

                ## 🎯 Project Goal


                ## 📋 Description


                ## 🗓 Timeline
                **Start Date:** {{date}}
                **Target Completion:**

                ## 🎓 Learning Objectives
                1.
                2.
                3.

                ## 📚 Resources Needed
                - [ ]
                - [ ]

                ## 🛤 Milestones
                - [ ] Milestone 1
                - [ ] Milestone 2
                - [ ] Milestone 3

                ## 📊 Success Criteria
                -

                ## 🔗 Related Concepts
                - [[Concept 1]]
                - [[Concept 2]]

                ## 📝 Notes


                ---
                *Status: [ ] Planning [ ] In Progress [ ] Completed*
                """,
                category: .project,
                isBuiltIn: true,
                tags: ["project", "planning"],
                variables: ["project", "date"]
            ),

            // Quick Note Template
            NoteTemplate(
                name: "Quick Note",
                description: "Simple template for quick thoughts",
                content: """
                # {{datetime}}



                ---
                Tags:
                Related:
                """,
                category: .general,
                isBuiltIn: true,
                tags: ["quick"],
                variables: ["datetime"]
            )
        ]
    }
}
