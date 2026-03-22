import SwiftData
import SwiftUI

struct RecycleBinView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    
    // Fallback: assuming ChatSession has a deletedAt or isActive flag
    // SwiftData makes true soft-delete tricky out of the box unless we
    // explicitly modeled a `isDeleted` flag. We will just show an empty UI
    // if we haven't added it to the model. Assumes `isDeleted` exists.
    @State private var searchQuery = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recycle Bin").font(.headline)
                    Text("Deleted chat sessions").font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                Button(role: .destructive, action: emptyRecycleBin) {
                    Label("Empty Trash", systemImage: "trash")
                }
            }
            .padding()
            
            Divider()
            
            // Search
            HStack {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("Search deleted sessions...", text: $searchQuery)
            }
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor))
            
            Divider()
            
            // Content (Empty state for parity prototype)
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "trash")
                    .font(.system(size: 40))
                    .foregroundColor(.secondary.opacity(0.3))
                Text("Recycle bin is empty")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .navigationTitle("Recycle Bin")
    }
    
    private func emptyRecycleBin() {
        // Logic to permanently delete soft-deleted chats
    }
}
