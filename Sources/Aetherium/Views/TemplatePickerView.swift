import SwiftData
import SwiftUI

// MARK: - Template Picker

struct TemplatePickerView: View {
    let category: TemplateCategory?
    let modelContext: ModelContext
    let onSelect: (NoteTemplate) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var templateEngine: NoteTemplateEngine
    @State private var searchText = ""
    @State private var selectedCategory: TemplateCategory?

    init(
        category: TemplateCategory? = nil,
        modelContext: ModelContext,
        onSelect: @escaping (NoteTemplate) -> Void
    ) {
        self.category = category
        self.modelContext = modelContext
        self.onSelect = onSelect
        _templateEngine = StateObject(wrappedValue: NoteTemplateEngine(modelContext: modelContext))
        _selectedCategory = State(initialValue: category)
    }

    var allTemplates: [NoteTemplate] {
        if let category = selectedCategory {
            return templateEngine.getTemplates(category: category)
        } else {
            return templateEngine.getTemplates()
        }
    }

    var filteredTemplates: [NoteTemplate] {
        if searchText.isEmpty {
            return allTemplates
        }
        return allTemplates.filter { template in
            template.name.localizedCaseInsensitiveContains(searchText) ||
            (template.templateDescription?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Choose Template")
                    .font(.headline)

                Spacer()

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider()

            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("Search templates...", text: $searchText)
                    .textFieldStyle(.plain)

                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(8)
            .padding()

            // Category filter
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    CategoryButton(
                        category: nil,
                        isSelected: selectedCategory == nil,
                        onSelect: { selectedCategory = nil }
                    )

                    ForEach(TemplateCategory.allCases, id: \.self) { cat in
                        CategoryButton(
                            category: cat,
                            isSelected: selectedCategory == cat,
                            onSelect: { selectedCategory = cat }
                        )
                    }
                }
                .padding(.horizontal)
            }

            Divider()

            // Templates list
            if filteredTemplates.isEmpty {
                ContentUnavailableView(
                    "No Templates",
                    systemImage: "doc.text",
                    description: Text("No templates match your search")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredTemplates) { template in
                            TemplateCard(
                                template: template,
                                onSelect: {
                                    onSelect(template)
                                }
                            )
                        }
                    }
                    .padding()
                }
            }
        }
        .frame(width: 600, height: 500)
    }
}

struct CategoryButton: View {
    let category: TemplateCategory?
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 4) {
                if let category = category {
                    Image(systemName: category.icon)
                    Text(category.rawValue)
                } else {
                    Image(systemName: "square.grid.2x2")
                    Text("All")
                }
            }
            .font(.caption)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.blue : Color.secondary.opacity(0.1))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

struct TemplateCard: View {
    let template: NoteTemplate
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 12) {
                // Icon
                Image(systemName: template.categoryEnum().icon)
                    .font(.title2)
                    .foregroundColor(.blue)
                    .frame(width: 40, height: 40)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(8)

                // Content
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(template.name)
                            .font(.headline)

                        if template.isBuiltIn {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.caption)
                                .foregroundColor(.blue)
                        }

                        Spacer()

                        Text(template.categoryEnum().rawValue)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.secondary.opacity(0.1))
                            .cornerRadius(4)
                    }

                    if let description = template.templateDescription {
                        Text(description)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    // Preview content snippet
                    Text(template.content)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.05))
                        .cornerRadius(6)

                    // Tags
                    if !template.tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(template.tags.prefix(3), id: \.self) { tag in
                                Text("#\(tag)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.05))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.blue.opacity(0.3), lineWidth: 0)
            )
        }
        .buttonStyle(.plain)
        .onHover { _ in
            // Could add hover effects here
        }
    }
}
