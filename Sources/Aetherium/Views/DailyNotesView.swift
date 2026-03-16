import SwiftUI
import SwiftData

// MARK: - Daily Notes View with Calendar

struct DailyNotesView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext

    @StateObject private var templateEngine: NoteTemplateEngine
    @State private var selectedDate = Date()
    @State private var currentDailyNote: DailyNote?
    @State private var showingTemplates = false
    @State private var selectedTemplate: NoteTemplate?

    init(project: Workspace, modelContext: ModelContext) {
        self.project = project
        _templateEngine = StateObject(wrappedValue: NoteTemplateEngine(modelContext: modelContext))
    }

    var body: some View {
        HSplitView {
            // Calendar sidebar
            CalendarSidebarView(
                selectedDate: $selectedDate,
                project: project,
                modelContext: modelContext
            )
            .frame(minWidth: 250, maxWidth: 350)

            // Daily note editor
            VStack(spacing: 0) {
                // Header
                DailyNoteHeader(
                    date: selectedDate,
                    dailyNote: currentDailyNote,
                    onPreviousDay: moveToPreviousDay,
                    onNextDay: moveToNextDay,
                    onSelectTemplate: { showingTemplates = true }
                )

                Divider()

                // Note editor
                if let dailyNote = currentDailyNote {
                    DailyNoteEditorView(
                        dailyNote: dailyNote,
                        project: project,
                        modelContext: modelContext
                    )
                } else {
                    CreateDailyNoteView(
                        date: selectedDate,
                        onCreate: { createDailyNote(with: nil) }
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Daily Notes")
        .sheet(isPresented: $showingTemplates) {
            TemplatePickerView(
                category: .daily,
                modelContext: modelContext,
                onSelect: { template in
                    selectedTemplate = template
                    showingTemplates = false
                    createDailyNote(with: template)
                }
            )
        }
        .task(id: selectedDate) {
            loadDailyNote()
        }
        .onAppear {
            templateEngine.initializeBuiltInTemplates()
        }
    }

    // MARK: - Actions

    private func loadDailyNote() {
        currentDailyNote = templateEngine.getOrCreateDailyNote(
            for: selectedDate,
            project: project
        )
    }

    private func createDailyNote(with template: NoteTemplate? = nil) {
        currentDailyNote = templateEngine.getOrCreateDailyNote(
            for: selectedDate,
            project: project,
            template: template
        )
    }

    private func moveToPreviousDay() {
        selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) ?? selectedDate
    }

    private func moveToNextDay() {
        selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate) ?? selectedDate
    }
}

// MARK: - Calendar Sidebar

struct CalendarSidebarView: View {
    @Binding var selectedDate: Date
    let project: Workspace
    let modelContext: ModelContext

    @State private var displayedMonth = Date()
    @State private var currentDailyNote: DailyNote?
    @StateObject private var templateEngine: NoteTemplateEngine

    init(selectedDate: Binding<Date>, project: Workspace, modelContext: ModelContext) {
        self._selectedDate = selectedDate
        self.project = project
        self.modelContext = modelContext
        _templateEngine = StateObject(wrappedValue: NoteTemplateEngine(modelContext: modelContext))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Month navigation
            HStack {
                Button(action: previousMonth) {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.plain)

                Spacer()

                Text(monthYearString)
                    .font(.headline)

                Spacer()

                Button(action: nextMonth) {
                    Image(systemName: "chevron.right")
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider()

            // Calendar grid
            CalendarGridView(
                month: displayedMonth,
                selectedDate: $selectedDate,
                project: project,
                modelContext: modelContext
            )

            Divider()

            // Quick stats
            DailyNoteStatsView(
                month: displayedMonth,
                project: project,
                modelContext: modelContext
            )
            .padding()

            Divider()

            // Alarm panel
            AlarmPanelView(
                project: project,
                dailyNote: currentDailyNote
            )
            .padding()
        }
        .background(Color.secondary.opacity(0.05))
        .task(id: selectedDate) {
            currentDailyNote = templateEngine.getOrCreateDailyNote(
                for: selectedDate,
                project: project
            )
        }
    }

    private var monthYearString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM yyyy"
        return formatter.string(from: displayedMonth)
    }

    private func previousMonth() {
        displayedMonth = Calendar.current.date(byAdding: .month, value: -1, to: displayedMonth) ?? displayedMonth
    }

    private func nextMonth() {
        displayedMonth = Calendar.current.date(byAdding: .month, value: 1, to: displayedMonth) ?? displayedMonth
    }
}

// MARK: - Calendar Grid

struct CalendarGridView: View {
    let month: Date
    @Binding var selectedDate: Date
    let project: Workspace
    let modelContext: ModelContext

    private let columns = Array(repeating: GridItem(.flexible()), count: 7)
    private let calendar = Calendar.current

    var body: some View {
        VStack(spacing: 0) {
            // Day headers
            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(calendar.shortWeekdaySymbols, id: \.self) { day in
                    Text(day)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
            }

            Divider()

            // Calendar days
            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(daysInMonth, id: \.self) { date in
                    if let date = date {
                        CalendarDayCell(
                            date: date,
                            isSelected: calendar.isDate(date, inSameDayAs: selectedDate),
                            isToday: calendar.isDateInToday(date),
                            hasNote: hasNoteForDate(date),
                            onSelect: { selectedDate = date }
                        )
                    } else {
                        Color.clear
                            .frame(height: 40)
                    }
                }
            }
        }
        .padding(.horizontal, 8)
    }

    private var daysInMonth: [Date?] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: month),
              let firstWeekday = calendar.dateInterval(of: .weekOfMonth, for: monthInterval.start)?.start else {
            return []
        }

        var days: [Date?] = []
        var date = firstWeekday

        // Add days from previous month
        while !calendar.isDate(date, equalTo: monthInterval.start, toGranularity: .day) {
            days.append(nil)
            date = calendar.date(byAdding: .day, value: 1, to: date)!
        }

        // Add days of current month
        date = monthInterval.start
        while date < monthInterval.end {
            days.append(date)
            date = calendar.date(byAdding: .day, value: 1, to: date)!
        }

        return days
    }

    private func hasNoteForDate(_ date: Date) -> Bool {
        let normalizedDate = DailyNote.normalizeDate(date)
        let projectId = project.id
        let descriptor = FetchDescriptor<DailyNote>(
            predicate: #Predicate { note in
                note.date == normalizedDate && note.project?.id == projectId
            }
        )
        return (try? modelContext.fetch(descriptor).first) != nil
    }
}

struct CalendarDayCell: View {
    let date: Date
    let isSelected: Bool
    let isToday: Bool
    let hasNote: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 2) {
                Text("\(Calendar.current.component(.day, from: date))")
                    .font(.body)
                    .fontWeight(isToday ? .bold : .regular)
                    .foregroundColor(isSelected ? .white : (isToday ? .blue : .primary))

                if hasNote {
                    Circle()
                        .fill(isSelected ? Color.white : Color.blue)
                        .frame(width: 4, height: 4)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(isSelected ? Color.blue : (isToday ? Color.blue.opacity(0.1) : Color.clear))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Daily Note Header

struct DailyNoteHeader: View {
    let date: Date
    let dailyNote: DailyNote?
    let onPreviousDay: () -> Void
    let onNextDay: () -> Void
    let onSelectTemplate: () -> Void

    var body: some View {
        HStack {
            Button(action: onPreviousDay) {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)

            Spacer()

            VStack(spacing: 4) {
                Text(formattedDate)
                    .font(.title2)
                    .fontWeight(.semibold)

                if let dailyNote = dailyNote {
                    HStack(spacing: 12) {
                        if let mood = dailyNote.mood {
                            Text(mood)
                                .font(.caption)
                        }

                        if let productivity = dailyNote.productivity {
                            HStack(spacing: 2) {
                                ForEach(1...5, id: \.self) { level in
                                    Image(systemName: level <= productivity ? "star.fill" : "star")
                                        .font(.caption2)
                                        .foregroundColor(.orange)
                                }
                            }
                        }
                    }
                    .foregroundColor(.secondary)
                }
            }

            Spacer()

            Button(action: onNextDay) {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)

            Divider()
                .frame(height: 24)

            Button(action: onSelectTemplate) {
                Label("Template", systemImage: "doc.text.image")
                    .font(.caption)
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .full
        return formatter.string(from: date)
    }
}

// MARK: - Daily Note Editor

struct DailyNoteEditorView: View {
    let dailyNote: DailyNote
    let project: Workspace
    let modelContext: ModelContext

    var body: some View {
        VStack(spacing: 0) {
            if let note = dailyNote.note {
                NoteEditorView(
                    note: note,
                    project: project,
                    modelContext: modelContext
                )
            } else {
                Text("No note content")
                    .foregroundColor(.secondary)
            }

            Divider()

            // Quick metadata
            DailyNoteMetadataView(dailyNote: dailyNote)
        }
    }
}

struct DailyNoteMetadataView: View {
    let dailyNote: DailyNote

    var body: some View {
        HStack(spacing: 20) {
            // Mood selector
            Menu {
                Button("😔 Down") { dailyNote.mood = "😔" }
                Button("😐 Neutral") { dailyNote.mood = "😐" }
                Button("🙂 Good") { dailyNote.mood = "🙂" }
                Button("😊 Great") { dailyNote.mood = "😊" }
                Button("🤩 Amazing") { dailyNote.mood = "🤩" }
            } label: {
                Label(dailyNote.mood ?? "Set Mood", systemImage: "face.smiling")
                    .font(.caption)
            }
            .buttonStyle(.bordered)

            // Productivity selector
            Menu {
                ForEach(1...10, id: \.self) { level in
                    Button("\(level) / 10") {
                        dailyNote.productivity = level
                        dailyNote.updateTimestamp()
                    }
                }
            } label: {
                if let productivity = dailyNote.productivity {
                    Label("Productivity: \(productivity)/10", systemImage: "chart.bar")
                        .font(.caption)
                } else {
                    Label("Set Productivity", systemImage: "chart.bar")
                        .font(.caption)
                }
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
    }
}

// MARK: - Stats View

struct DailyNoteStatsView: View {
    let month: Date
    let project: Workspace
    let modelContext: ModelContext

    @State private var stats: Stats?

    struct Stats {
        var totalNotes: Int
        var currentStreak: Int
        var avgProductivity: Double
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("This Month")
                .font(.caption)
                .foregroundColor(.secondary)

            if let stats = stats {
                HStack(spacing: 16) {
                    PathStatBadge(
                        value: "\(stats.totalNotes)",
                        label: "Notes",
                        icon: "doc.text"
                    )

                    PathStatBadge(
                        value: "\(stats.currentStreak)",
                        label: "Streak",
                        icon: "flame"
                    )
                }
            } else {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .task {
            await loadStats()
        }
    }

    private func loadStats() async {
        let calendar = Calendar.current
        guard let monthInterval = calendar.dateInterval(of: .month, for: month) else { return }

        let projectId = project.id
        let descriptor = FetchDescriptor<DailyNote>(
            predicate: #Predicate { note in
                note.project?.id == projectId &&
                note.date >= monthInterval.start &&
                note.date < monthInterval.end
            }
        )

        guard let notes = try? modelContext.fetch(descriptor) else { return }

        let totalNotes = notes.count
        let productivities = notes.compactMap { $0.productivity }
        let avgProductivity = productivities.isEmpty ? 0.0 : Double(productivities.reduce(0, +)) / Double(productivities.count)

        // Calculate streak (simplified)
        let currentStreak = calculateStreak(notes)

        stats = Stats(
            totalNotes: totalNotes,
            currentStreak: currentStreak,
            avgProductivity: avgProductivity
        )
    }

    private func calculateStreak(_ notes: [DailyNote]) -> Int {
        // Simplified streak calculation
        var streak = 0
        var currentDate = Date()
        let calendar = Calendar.current

        while true {
            let normalizedDate = DailyNote.normalizeDate(currentDate)
            if notes.contains(where: { calendar.isDate($0.date, inSameDayAs: normalizedDate) }) {
                streak += 1
                currentDate = calendar.date(byAdding: .day, value: -1, to: currentDate)!
            } else {
                break
            }
        }

        return streak
    }
}

// MARK: - Create Daily Note View

struct CreateDailyNoteView: View {
    let date: Date
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "calendar.badge.plus")
                .font(.system(size: 60))
                .foregroundColor(.blue)

            Text("No daily note for this day")
                .font(.title3)
                .fontWeight(.medium)

            Button(action: onCreate) {
                Label("Create Daily Note", systemImage: "plus.circle.fill")
                    .font(.body)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}


