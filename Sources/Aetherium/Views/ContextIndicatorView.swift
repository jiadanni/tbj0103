import SwiftUI
import SwiftData

struct ContextIndicatorView: View {
    let memoriesCount: Int
    let artifactsCount: Int
    let summariesCount: Int
    let documentsCount: Int
    
    @State private var isExpanded = false
    
    var totalSources: Int {
        memoriesCount + artifactsCount + summariesCount + documentsCount
    }
    
    var body: some View {
        if totalSources == 0 {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        Image(systemName: "bolt.fill")
                            .foregroundColor(.orange)
                        Text("Context Used (\(totalSources))")
                    }
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                
                if isExpanded {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        if memoriesCount > 0 {
                            ContextIndicatorBadge(
                                icon: "brain.head.profile",
                                color: .purple,
                                title: "Memories",
                                subtitle: "\(memoriesCount) active memories injected"
                            )
                        }
                        if artifactsCount > 0 {
                            ContextIndicatorBadge(
                                icon: "doc.text.fill",
                                color: .blue,
                                title: "Artifacts",
                                subtitle: "\(artifactsCount) artifacts referenced"
                            )
                        }
                        if summariesCount > 0 {
                            ContextIndicatorBadge(
                                icon: "message.fill",
                                color: .green,
                                title: "Summaries",
                                subtitle: "\(summariesCount) past turn summaries"
                            )
                        }
                        if documentsCount > 0 {
                            ContextIndicatorBadge(
                                icon: "doc.text.viewfinder",
                                color: .orange,
                                title: "Documents (RAG)",
                                subtitle: "\(documentsCount) relevant chunks retrieved"
                            )
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(.vertical, 8)
        }
    }
}

private struct ContextIndicatorBadge: View {
    let icon: String
    let color: Color
    let title: String
    let subtitle: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(color)
                .padding(.top, 2)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(.primary)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.secondary.opacity(0.1), lineWidth: 1)
        )
    }
}
