import SwiftData
import SwiftUI

struct WorkspaceListView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var demoModeManager: DemoModeManager
    let projects: [Workspace]
    @Binding var selectedProject: Workspace?
    @Binding var showingNewWorkspaceSheet: Bool
    @State private var projectToEdit: Workspace?
    @State private var createParentWorkspace: Workspace?
    @State private var showingDemoAlert = false
    @State private var showHiddenWorkspaces = false

    private var rootWorkspaces: [Workspace] {
        visibleAndSorted(projects)
            .filter { $0.isRootWorkspace }
    }

    var body: some View {
        List(selection: $selectedProject) {
            ForEach(rootWorkspaces) { workspace in
                WorkspaceHierarchyRow(
                    workspace: workspace,
                    selectedProject: $selectedProject,
                    showHiddenWorkspaces: showHiddenWorkspaces,
                    childrenProvider: { visibleAndSorted($0.childWorkspaces) },
                    canMoveUp: canMoveUp,
                    canMoveDown: canMoveDown,
                    onEdit: { projectToEdit = $0 },
                    onCreateChild: {
                        createParentWorkspace = $0
                        showingNewWorkspaceSheet = true
                    },
                    onToggleHidden: toggleWorkspaceHidden,
                    onMoveUp: moveWorkspaceUp,
                    onMoveDown: moveWorkspaceDown,
                    onDelete: { deleteProject($0) }
                )
            }
        }
        .navigationTitle("Workspaces")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(action: {
                        createParentWorkspace = nil
                        showingNewWorkspaceSheet = true
                    }) {
                        Label("New Workspace", systemImage: "plus")
                    }

                    Toggle(isOn: $showHiddenWorkspaces) {
                        Label("Show Hidden Workspaces", systemImage: "eye")
                    }
                } label: {
                    Label("Workspace Actions", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(item: $projectToEdit) { project in
            EditWorkspaceSheet(project: project)
        }
        .sheet(isPresented: $showingNewWorkspaceSheet) {
            NewWorkspaceSheet(
                isPresented: $showingNewWorkspaceSheet,
                parentWorkspace: createParentWorkspace,
                availableWorkspaces: projects
            )
        }
        .alert("Demo Mode", isPresented: $showingDemoAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Deletions are disabled in demo mode. Exit demo to manage your real projects.")
        }
    }

    private func deleteProject(_ project: Workspace) {
        if demoModeManager.isActive {
            showingDemoAlert = true
            return
        }

        // Keep sibling ordering compact after deletions.
        let siblings = orderedSiblings(for: project)
            .filter { $0.id != project.id }
        reindexSiblings(siblings)

        modelContext.delete(project)
        if selectedProject?.id == project.id {
            selectedProject = nil
        }

        try? modelContext.save()
    }

    private func visibleAndSorted(_ workspaces: [Workspace]) -> [Workspace] {
        workspaces
            .filter { showHiddenWorkspaces || !$0.isHidden }
            .sorted { lhs, rhs in
                if lhs.sortOrder == rhs.sortOrder {
                    return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
                }
                return lhs.sortOrder < rhs.sortOrder
            }
    }

    private func orderedSiblings(for workspace: Workspace) -> [Workspace] {
        let siblings = projects.filter { candidate in
            candidate.parentWorkspace?.id == workspace.parentWorkspace?.id
        }
        return siblings.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }
    }

    private func canMoveUp(_ workspace: Workspace) -> Bool {
        guard !workspace.isHidden else { return false }
        let siblings = visibleAndSorted(orderedSiblings(for: workspace))
        guard let index = siblings.firstIndex(where: { $0.id == workspace.id }) else { return false }
        return index > 0
    }

    private func canMoveDown(_ workspace: Workspace) -> Bool {
        guard !workspace.isHidden else { return false }
        let siblings = visibleAndSorted(orderedSiblings(for: workspace))
        guard let index = siblings.firstIndex(where: { $0.id == workspace.id }) else { return false }
        return index < siblings.count - 1
    }

    private func moveWorkspaceUp(_ workspace: Workspace) {
        moveWorkspace(workspace, direction: -1)
    }

    private func moveWorkspaceDown(_ workspace: Workspace) {
        moveWorkspace(workspace, direction: 1)
    }

    private func moveWorkspace(_ workspace: Workspace, direction: Int) {
        guard direction == -1 || direction == 1 else { return }
        var ordered = visibleAndSorted(orderedSiblings(for: workspace))
        guard let fromIndex = ordered.firstIndex(where: { $0.id == workspace.id }) else { return }

        let toIndex = fromIndex + direction
        guard ordered.indices.contains(toIndex) else { return }

        ordered.swapAt(fromIndex, toIndex)
        reindexSiblings(ordered)
        try? modelContext.save()
    }

    private func toggleWorkspaceHidden(_ workspace: Workspace) {
        workspace.isHidden.toggle()
        workspace.updateTimestamp()

        // If a currently selected workspace is hidden while hidden rows are not shown,
        // move selection to a visible root fallback.
        if workspace.isHidden,
           !showHiddenWorkspaces,
           selectedProject?.id == workspace.id {
            selectedProject = rootWorkspaces.first
        }

        try? modelContext.save()
    }

    private func reindexSiblings(_ siblings: [Workspace]) {
        for (index, sibling) in siblings.enumerated() {
            sibling.sortOrder = index
            sibling.updateTimestamp()
        }
    }
}

private struct WorkspaceHierarchyRow: View {
    let workspace: Workspace
    @Binding var selectedProject: Workspace?
    let showHiddenWorkspaces: Bool
    let childrenProvider: (Workspace) -> [Workspace]
    let canMoveUp: (Workspace) -> Bool
    let canMoveDown: (Workspace) -> Bool
    let onEdit: (Workspace) -> Void
    let onCreateChild: (Workspace) -> Void
    let onToggleHidden: (Workspace) -> Void
    let onMoveUp: (Workspace) -> Void
    let onMoveDown: (Workspace) -> Void
    let onDelete: (Workspace) -> Void

    private var childWorkspaces: [Workspace] {
        childrenProvider(workspace)
    }

    var body: some View {
        DisclosureGroup {
            ForEach(childWorkspaces) { child in
                WorkspaceHierarchyRow(
                    workspace: child,
                    selectedProject: $selectedProject,
                    showHiddenWorkspaces: showHiddenWorkspaces,
                    childrenProvider: childrenProvider,
                    canMoveUp: canMoveUp,
                    canMoveDown: canMoveDown,
                    onEdit: onEdit,
                    onCreateChild: onCreateChild,
                    onToggleHidden: onToggleHidden,
                    onMoveUp: onMoveUp,
                    onMoveDown: onMoveDown,
                    onDelete: onDelete
                )
                .padding(.leading, 8)
            }
        } label: {
            WorkspaceRowView(project: workspace)
                .tag(workspace)
                .contextMenu {
                    Button("Edit Workspace") {
                        onEdit(workspace)
                    }

                    Button("New Child Workspace") {
                        onCreateChild(workspace)
                    }

                    Divider()

                    Button {
                        onMoveUp(workspace)
                    } label: {
                        Label("Move Up", systemImage: "arrow.up")
                    }
                    .disabled(!canMoveUp(workspace))

                    Button {
                        onMoveDown(workspace)
                    } label: {
                        Label("Move Down", systemImage: "arrow.down")
                    }
                    .disabled(!canMoveDown(workspace))

                    Button {
                        onToggleHidden(workspace)
                    } label: {
                        Label(
                            workspace.isHidden ? "Unhide Workspace" : "Hide Workspace",
                            systemImage: workspace.isHidden ? "eye" : "eye.slash"
                        )
                    }

                    Divider()

                    Button("Delete Workspace", role: .destructive) {
                        onDelete(workspace)
                    }
                }
        }
    }
}

struct WorkspaceListRowView: View {
    let project: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(project.title)
                .font(.headline)

            Text(project.workspaceDescription)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)

            HStack {
                Label("\(project.chatSessions.count)", systemImage: "message")
                Label("\(project.learningGoals.count)", systemImage: "target")
            }
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct NewWorkspaceSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Binding var isPresented: Bool
    let parentWorkspace: Workspace?
    let availableWorkspaces: [Workspace]

    @State private var title = ""
    @State private var description = ""
    @State private var selectedParentId: UUID?

    init(
        isPresented: Binding<Bool>,
        parentWorkspace: Workspace? = nil,
        availableWorkspaces: [Workspace] = []
    ) {
        self._isPresented = isPresented
        self.parentWorkspace = parentWorkspace
        self.availableWorkspaces = availableWorkspaces
        self._selectedParentId = State(initialValue: parentWorkspace?.id)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("New Workspace")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Workspace Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)

                Picker("Parent Workspace", selection: $selectedParentId) {
                    Text("None (Root Workspace)").tag(UUID?.none)
                    ForEach(availableWorkspaces.sorted { lhs, rhs in
                        lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
                    }) { workspace in
                        Text(workspace.title).tag(Optional(workspace.id))
                    }
                }
            }

            Text("Workspaces help organize your learning goals and related conversations.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    createProject()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 450)
    }

    private func createProject() {
        let selectedParent = selectedParentId.flatMap { parentId in
            availableWorkspaces.first(where: { $0.id == parentId })
        }

        let newProject = Workspace(
            title: title,
            description: description,
            sortOrder: nextSortOrder(for: selectedParent)
        )
        if let parent = selectedParent {
            newProject.parentWorkspace = parent
        }
        modelContext.insert(newProject)
        try? modelContext.save()
        dismiss()
    }

    private func nextSortOrder(for parent: Workspace?) -> Int {
        let siblings = availableWorkspaces.filter { workspace in
            workspace.parentWorkspace?.id == parent?.id
        }
        return (siblings.map(\.sortOrder).max() ?? -1) + 1
    }
}

// MARK: - Edit Workspace Sheet

struct EditWorkspaceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    let project: Workspace

    @State private var title: String
    @State private var description: String
    @State private var selectedParentId: UUID?

    @Query private var allWorkspaces: [Workspace]

    private var assignableParents: [Workspace] {
        let descendants = collectDescendants(of: project)
        return allWorkspaces
            .filter { candidate in
                candidate.id != project.id && !descendants.contains(candidate.id)
            }
            .sorted { lhs, rhs in
                lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
    }

    init(project: Workspace) {
        self.project = project
        _title = State(initialValue: project.title)
        _description = State(initialValue: project.workspaceDescription)
        _selectedParentId = State(initialValue: project.parentWorkspace?.id)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Edit Workspace")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Workspace Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)

                Picker("Parent Workspace", selection: $selectedParentId) {
                    Text("None (Root Workspace)").tag(UUID?.none)
                    ForEach(assignableParents) { workspace in
                        Text(workspace.title).tag(Optional(workspace.id))
                    }
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Save") {
                    let previousParentId = project.parentWorkspace?.id

                    project.title = title
                    project.workspaceDescription = description

                    if let parentId = selectedParentId {
                        project.parentWorkspace = allWorkspaces.first(where: { $0.id == parentId })
                    } else {
                        project.parentWorkspace = nil
                    }

                    if previousParentId != project.parentWorkspace?.id {
                        project.sortOrder = nextSortOrder(for: project.parentWorkspace)
                    }

                    project.updateTimestamp()
                    try? modelContext.save()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 450)
    }

    private func collectDescendants(of workspace: Workspace) -> Set<UUID> {
        var ids = Set<UUID>()
        var stack = Array(workspace.childWorkspaces)

        while let next = stack.popLast() {
            if ids.insert(next.id).inserted {
                stack.append(contentsOf: next.childWorkspaces)
            }
        }

        return ids
    }

    private func nextSortOrder(for parent: Workspace?) -> Int {
        let siblings = allWorkspaces.filter { workspace in
            workspace.parentWorkspace?.id == parent?.id && workspace.id != project.id
        }
        return (siblings.map(\.sortOrder).max() ?? -1) + 1
    }
}
