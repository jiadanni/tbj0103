import SwiftUI
import SwiftData

// MARK: - Learning Path View

struct LearningPathView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext

    @Query private var allPaths: [LearningPath]
    @State private var selectedPath: LearningPath?
    @State private var showingNewPathSheet = false

    var projectPaths: [LearningPath] {
        allPaths.filter { $0.project?.id == project.id }
    }

    var body: some View {
        HSplitView {
            // Paths list
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Learning Paths")
                        .font(.headline)

                    Spacer()

                    Button(action: { showingNewPathSheet = true }) {
                        Image(systemName: "plus.circle.fill")
                    }
                    .buttonStyle(.plain)
                }
                .padding()

                Divider()

                // Paths
                if projectPaths.isEmpty {
                    ContentUnavailableView(
                        "No Learning Paths",
                        systemImage: "map",
                        description: Text("Create a learning path to track your progress")
                    )
                } else {
                    List(projectPaths, selection: $selectedPath) { path in
                        LearningPathRow(path: path)
                            .tag(path)
                    }
                }
            }
            .frame(minWidth: 250, maxWidth: 350)

            // Path detail
            if let path = selectedPath {
                LearningPathDetailView(
                    path: path,
                    modelContext: modelContext
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView(
                    "No Path Selected",
                    systemImage: "map.fill",
                    description: Text("Select a learning path to view details")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Learning Paths")
        .sheet(isPresented: $showingNewPathSheet) {
            NewLearningPathSheet(
                project: project,
                modelContext: modelContext,
                onCreate: { path in
                    selectedPath = path
                }
            )
        }
    }
}

// MARK: - Path Row

struct LearningPathRow: View {
    let path: LearningPath

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(path.title)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                if path.isCompleted {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                }
            }

            // Progress bar
            ProgressView(value: path.progress)
                .tint(.blue)

            HStack {
                Text("\(Int(path.progress * 100))% Complete")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Text("\(path.milestones.filter { $0.isCompleted }.count)/\(path.milestones.count) milestones")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let targetDate = path.targetCompletionDate {
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                        .font(.caption2)
                    Text("Due \(targetDate.formatted(date: .abbreviated, time: .omitted))")
                        .font(.caption2)
                }
                .foregroundColor(targetDate < Date() ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Path Detail

struct LearningPathDetailView: View {
    let path: LearningPath
    let modelContext: ModelContext

    @State private var showingAddMilestone = false

    var sortedMilestones: [PathMilestone] {
        path.milestones.sorted { $0.orderIndex < $1.orderIndex }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            PathHeaderView(path: path)

            Divider()

            // Milestones
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(Array(sortedMilestones.enumerated()), id: \.element.id) { index, milestone in
                        MilestoneCard(
                            milestone: milestone,
                            index: index + 1,
                            total: path.milestones.count,
                            onComplete: {
                                milestone.complete()
                                checkPathCompletion()
                            }
                        )
                    }

                    // Add milestone button
                    Button(action: { showingAddMilestone = true }) {
                        Label("Add Milestone", systemImage: "plus.circle")
                            .font(.body)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .padding(.horizontal)
                }
                .padding()
            }
        }
        .sheet(isPresented: $showingAddMilestone) {
            NewMilestoneSheet(
                path: path,
                orderIndex: path.milestones.count,
                onCreate: { milestone in
                    path.milestones.append(milestone)
                    modelContext.insert(milestone)
                }
            )
        }
    }

    private func checkPathCompletion() {
        if path.progress >= 1.0 && !path.isCompleted {
            path.isCompleted = true
            path.completedAt = Date()
        }
    }
}

struct PathHeaderView: View {
    let path: LearningPath

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Title and completion status
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(path.title)
                        .font(.title2)
                        .fontWeight(.bold)

                    if let description = path.pathDescription {
                        Text(description)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                if path.isCompleted {
                    VStack(spacing: 4) {
                        Image(systemName: "trophy.fill")
                            .font(.title)
                            .foregroundColor(.yellow)

                        Text("Completed!")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // Progress
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Overall Progress")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    Text("\(Int(path.progress * 100))%")
                        .font(.caption)
                        .fontWeight(.semibold)
                }

                ProgressView(value: path.progress)
                    .tint(.blue)
            }

            // Stats
            HStack(spacing: 20) {
                PathStatBadge(
                    value: "\(path.milestones.count)",
                    label: "Milestones",
                    icon: "flag"
                )

                PathStatBadge(
                    value: "\(path.milestones.filter { $0.isCompleted }.count)",
                    label: "Completed",
                    icon: "checkmark"
                )

                if let targetDate = path.targetCompletionDate {
                    let daysRemaining = Calendar.current.dateComponents([.day], from: Date(), to: targetDate).day ?? 0
                    PathStatBadge(
                        value: "\(daysRemaining)",
                        label: daysRemaining >= 0 ? "Days Left" : "Days Over",
                        icon: "calendar"
                    )
                }
            }
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
    }
}

// MARK: - Milestone Card

struct MilestoneCard: View {
    let milestone: PathMilestone
    let index: Int
    let total: Int
    let onComplete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Progress indicator
            ZStack {
                Circle()
                    .stroke(milestone.isCompleted ? Color.green : Color.secondary.opacity(0.3), lineWidth: 2)
                    .frame(width: 40, height: 40)

                if milestone.isCompleted {
                    Image(systemName: "checkmark")
                        .foregroundColor(.green)
                } else {
                    Text("\(index)")
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
            }

            // Content
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(milestone.title)
                        .font(.headline)
                        .strikethrough(milestone.isCompleted)

                    Spacer()

                    if !milestone.isCompleted {
                        Button(action: onComplete) {
                            Text("Complete")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                    }
                }

                if let description = milestone.milestoneDescription {
                    Text(description)
                        .font(.body)
                        .foregroundColor(.secondary)
                }

                // Related concepts
                if !milestone.relatedConcepts.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "link")
                            .font(.caption2)
                            .foregroundColor(.secondary)

                        ForEach(milestone.relatedConcepts.prefix(3)) { concept in
                            Text(concept.name)
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }
                }

                // Due date
                if let dueDate = milestone.dueDate {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.caption2)
                        Text("Due \(dueDate.formatted(date: .abbreviated, time: .omitted))")
                            .font(.caption)
                    }
                    .foregroundColor(dueDate < Date() && !milestone.isCompleted ? .red : .secondary)
                }

                if let completedAt = milestone.completedAt {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2)
                        Text("Completed \(completedAt.formatted(date: .abbreviated, time: .omitted))")
                            .font(.caption)
                    }
                    .foregroundColor(.green)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(milestone.isCompleted ? Color.green.opacity(0.05) : Color.secondary.opacity(0.05))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(milestone.isCompleted ? Color.green.opacity(0.3) : Color.clear, lineWidth: 1)
        )
    }
}

// MARK: - New Path Sheet

struct NewLearningPathSheet: View {
    let project: Workspace
    let modelContext: ModelContext
    let onCreate: (LearningPath) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var description = ""
    @State private var hasTargetDate = false
    @State private var targetDate = Date()

    var body: some View {
        VStack(spacing: 20) {
            Text("New Learning Path")
                .font(.headline)

            Form {
                TextField("Title", text: $title)

                TextField("Description (optional)", text: $description, axis: .vertical)
                    .lineLimit(3...6)

                Toggle("Set target completion date", isOn: $hasTargetDate)

                if hasTargetDate {
                    DatePicker("Target Date", selection: $targetDate, displayedComponents: .date)
                }
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)

                Button("Create") {
                    createPath()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }

    private func createPath() {
        let path = LearningPath(
            title: title,
            description: description.isEmpty ? nil : description,
            targetCompletionDate: hasTargetDate ? targetDate : nil
        )
        path.project = project

        modelContext.insert(path)
        onCreate(path)
        dismiss()
    }
}

// MARK: - New Milestone Sheet

struct NewMilestoneSheet: View {
    let path: LearningPath
    let orderIndex: Int
    let onCreate: (PathMilestone) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var description = ""
    @State private var hasDueDate = false
    @State private var dueDate = Date()

    var body: some View {
        VStack(spacing: 20) {
            Text("New Milestone")
                .font(.headline)

            Form {
                TextField("Title", text: $title)

                TextField("Description (optional)", text: $description, axis: .vertical)
                    .lineLimit(3...6)

                Toggle("Set due date", isOn: $hasDueDate)

                if hasDueDate {
                    DatePicker("Due Date", selection: $dueDate, displayedComponents: .date)
                }
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)

                Button("Create") {
                    createMilestone()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }

    private func createMilestone() {
        let milestone = PathMilestone(
            title: title,
            description: description.isEmpty ? nil : description,
            orderIndex: orderIndex,
            dueDate: hasDueDate ? dueDate : nil
        )
        milestone.learningPath = path

        onCreate(milestone)
        dismiss()
    }
}

// MARK: - Path Stat Badge

struct PathStatBadge: View {
    let value: String
    let label: String
    let icon: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.blue)

            Text(value)
                .font(.headline)

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(minWidth: 80)
        .padding(10)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(10)
    }
}


