import SwiftUI
import SwiftData
import Charts

// MARK: - Project Dashboard

struct ProjectDashboardView: View {
    let project: AetheriumProject
    @Environment(\.modelContext) private var modelContext

    @StateObject private var analytics: ProjectAnalytics
    @State private var selectedTimeRange: TimeRange = .week

    init(project: AetheriumProject, modelContext: ModelContext) {
        self.project = project
        _analytics = StateObject(wrappedValue: ProjectAnalytics(project: project, modelContext: modelContext))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header with project info
                DashboardHeaderView(project: project)

                // Time range selector
                Picker("Time Range", selection: $selectedTimeRange) {
                    ForEach(TimeRange.allCases, id: \.self) { range in
                        Text(range.rawValue).tag(range)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                // Key metrics
                MetricsGridView(analytics: analytics)

                // Activity heatmap
                ActivityHeatmapView(
                    analytics: analytics,
                    timeRange: selectedTimeRange
                )

                // Topic cloud
                TopicCloudView(analytics: analytics)

                // Charts
                HStack(spacing: 16) {
                    ConceptGrowthChart(analytics: analytics)

                    ReviewAccuracyChart(analytics: analytics)
                }
                .frame(height: 200)
                .padding(.horizontal)

                // Recent activity
                RecentActivityView(project: project)

                // Deduplication
                NavigationLink(destination: DeduplicationView(project: project)) {
                    HStack {
                        Image(systemName: "doc.on.doc")
                        Text("Find Duplicate Notes")
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .padding()
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(8)
                    .padding(.horizontal)
                }
                .buttonStyle(.plain)

                // AI Insights
                AIInsightsView(project: project, analytics: analytics, modelContext: modelContext)
            }
            .padding(.vertical)
        }
        .navigationTitle("Dashboard")
        .task {
            await analytics.refresh()
        }
    }
}

// MARK: - Dashboard Header

struct DashboardHeaderView: View {
    let project: AetheriumProject

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title)
                        .font(.title)
                        .fontWeight(.bold)

                    Text(project.projectDescription)
                        .foregroundColor(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text("Created \(project.createdAt.formatted(.relative(presentation: .named)))")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("Last updated \(project.updatedAt.formatted(.relative(presentation: .named)))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color.blue.opacity(0.05))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

// MARK: - Metrics Grid

struct MetricsGridView: View {
    @ObservedObject var analytics: ProjectAnalytics

    let columns = [
        GridItem(.flexible()),
        GridItem(.flexible()),
        GridItem(.flexible()),
        GridItem(.flexible())
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 16) {
            MetricCard(
                title: "Concepts",
                value: "\(analytics.totalConcepts)",
                trend: analytics.conceptTrend,
                icon: "brain.head.profile",
                color: .blue
            )

            MetricCard(
                title: "Notes",
                value: "\(analytics.totalNotes)",
                trend: analytics.noteTrend,
                icon: "doc.text",
                color: .green
            )

            MetricCard(
                title: "Flashcards",
                value: "\(analytics.totalCards)",
                trend: analytics.cardTrend,
                icon: "rectangle.stack",
                color: .orange
            )

            MetricCard(
                title: "Accuracy",
                value: "\(Int(analytics.reviewAccuracy * 100))%",
                trend: analytics.accuracyTrend,
                icon: "target",
                color: .purple
            )
        }
        .padding(.horizontal)
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let trend: Double
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)

                Spacer()

                if trend != 0 {
                    HStack(spacing: 2) {
                        Image(systemName: trend > 0 ? "arrow.up.right" : "arrow.down.right")
                        Text("\(abs(Int(trend)))%")
                    }
                    .font(.caption)
                    .foregroundColor(trend > 0 ? .green : .red)
                }
            }

            Text(value)
                .font(.title)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(color.opacity(0.05))
        .cornerRadius(12)
    }
}

// MARK: - Activity Heatmap

struct ActivityHeatmapView: View {
    @ObservedObject var analytics: ProjectAnalytics
    let timeRange: TimeRange

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Activity Heatmap")
                .font(.headline)
                .padding(.horizontal)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(analytics.activityData.prefix(timeRange.days), id: \.date) { day in
                    ActivityCell(activity: day)
                }
            }
            .padding(.horizontal)

            // Legend
            HStack(spacing: 8) {
                Text("Less")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                ForEach(0..<5) { level in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(activityColor(for: Double(level) / 4.0))
                        .frame(width: 12, height: 12)
                }

                Text("More")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
        }
        .padding(.vertical)
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    private func activityColor(for intensity: Double) -> Color {
        Color.green.opacity(0.2 + intensity * 0.8)
    }
}

struct ActivityCell: View {
    let activity: ActivityDay

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(color)
            .frame(height: 12)
            .help("\(activity.date.formatted(date: .abbreviated, time: .omitted)): \(activity.count) activities")
    }

    private var color: Color {
        let intensity = min(Double(activity.count) / 10.0, 1.0)
        return Color.green.opacity(0.2 + intensity * 0.8)
    }
}

// MARK: - Charts

struct ConceptGrowthChart: View {
    @ObservedObject var analytics: ProjectAnalytics

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Concept Growth")
                .font(.headline)

            Chart(analytics.growthData) { dataPoint in
                LineMark(
                    x: .value("Date", dataPoint.date),
                    y: .value("Concepts", dataPoint.count)
                )
                .foregroundStyle(.blue)

                AreaMark(
                    x: .value("Date", dataPoint.date),
                    y: .value("Concepts", dataPoint.count)
                )
                .foregroundStyle(.blue.opacity(0.1))
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 7))
            }
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(12)
    }
}

struct ReviewAccuracyChart: View {
    @ObservedObject var analytics: ProjectAnalytics

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Review Accuracy")
                .font(.headline)

            Chart(analytics.accuracyData) { dataPoint in
                BarMark(
                    x: .value("Date", dataPoint.date),
                    y: .value("Accuracy", dataPoint.accuracy)
                )
                .foregroundStyle(.purple)
            }
            .chartYScale(domain: 0...100)
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(12)
    }
}

// MARK: - Recent Activity

struct RecentActivityView: View {
    let project: AetheriumProject

    var recentItems: [(String, String, Date)] {
        var items: [(String, String, Date)] = []

        // Recent notes
        for source in project.sources.prefix(3) {
            items.append((source.title, "Note", source.createdAt))
        }

        // Recent concepts
        for concept in project.concepts.sorted(by: { $0.createdAt > $1.createdAt }).prefix(3) {
            items.append((concept.name, "Concept", concept.createdAt))
        }

        // Recent chats
        for chat in project.chatSessions.sorted(by: { $0.updatedAt > $1.updatedAt }).prefix(3) {
            items.append((chat.title, "Chat", chat.updatedAt))
        }

        return items.sorted { $0.2 > $1.2 }.prefix(5).map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Activity")
                .font(.headline)
                .padding(.horizontal)

            ForEach(Array(recentItems.enumerated()), id: \.offset) { _, item in
                HStack {
                    Image(systemName: iconForType(item.1))
                        .foregroundColor(.blue)
                        .frame(width: 24)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.0)
                            .font(.body)
                            .lineLimit(1)

                        Text(item.1)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    Text(item.2.formatted(.relative(presentation: .named)))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color.secondary.opacity(0.05))
                .cornerRadius(8)
            }
            .padding(.horizontal)
        }
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "Note": return "doc.text"
        case "Concept": return "brain.head.profile"
        case "Chat": return "message"
        default: return "circle"
        }
    }
}

// MARK: - AI Insights

struct AIInsightsView: View {
    let project: AetheriumProject
    @ObservedObject var analytics: ProjectAnalytics
    let modelContext: ModelContext

    @State private var insights: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("AI Insights")
                    .font(.headline)

                Spacer()

                Image(systemName: "sparkles")
                    .foregroundColor(.yellow)
            }
            .padding(.horizontal)

            ForEach(insights, id: \.self) { insight in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "lightbulb.fill")
                        .foregroundColor(.yellow)

                    Text(insight)
                        .font(.body)
                }
                .padding()
                .background(Color.yellow.opacity(0.05))
                .cornerRadius(8)
            }
            .padding(.horizontal)
        }
        .task {
            generateInsights()
        }
    }

    private func generateInsights() {
        var generatedInsights: [String] = []

        // Learning pace
        if analytics.totalConcepts > 20 {
            generatedInsights.append("You're building a rich knowledge base with \(analytics.totalConcepts) concepts. Consider creating learning paths to organize your learning journey.")
        }

        // Review accuracy (only show if user has done reviews)
        let totalReviews = analytics.totalCards > 0
        if totalReviews && analytics.reviewAccuracy < 0.7 {
            generatedInsights.append("Your review accuracy is \(Int(analytics.reviewAccuracy * 100))%. Try spacing out your review sessions for better retention.")
        } else if analytics.reviewAccuracy > 0.9 {
            generatedInsights.append("Excellent retention rate! You're mastering the material with \(Int(analytics.reviewAccuracy * 100))% accuracy.")
        }

        // Activity consistency
        let recentActivity = analytics.activityData.prefix(7).map { $0.count }.reduce(0, +)
        if recentActivity > 0 {
            generatedInsights.append("You've been active \(recentActivity) times this week. Consistency is key to effective learning!")
        }

        // Concept connections (only show if user has concepts)
        let connectedConcepts = project.concepts.filter { !$0.linkedConcepts.isEmpty }.count
        let connectionRatio = Double(connectedConcepts) / Double(max(project.concepts.count, 1))
        if project.concepts.count > 0 && connectionRatio < 0.3 {
            generatedInsights.append("Only \(Int(connectionRatio * 100))% of your concepts are linked. Try connecting related concepts to strengthen understanding.")
        }

        insights = generatedInsights
    }
}

// MARK: - Project Analytics

@MainActor
class ProjectAnalytics: ObservableObject {
    @Published var totalConcepts = 0
    @Published var totalNotes = 0
    @Published var totalCards = 0
    @Published var reviewAccuracy = 0.0

    @Published var conceptTrend = 0.0
    @Published var noteTrend = 0.0
    @Published var cardTrend = 0.0
    @Published var accuracyTrend = 0.0

    @Published var activityData: [ActivityDay] = []
    @Published var growthData: [GrowthPoint] = []
    @Published var accuracyData: [AccuracyPoint] = []
    @Published var topicFrequencies: [TopicFrequency] = []

    private let project: AetheriumProject
    private let modelContext: ModelContext

    init(project: AetheriumProject, modelContext: ModelContext) {
        self.project = project
        self.modelContext = modelContext
    }

    func refresh() async {
        // Calculate metrics
        totalConcepts = project.concepts.count
        totalNotes = project.sources.filter { $0.type == .note }.count

        // Get flashcards
        let projectId = project.id
        let cardDescriptor = FetchDescriptor<LearningCard>(
            predicate: #Predicate { $0.project?.id == projectId }
        )
        let cards = (try? modelContext.fetch(cardDescriptor)) ?? []
        totalCards = cards.count

        let totalReviews = cards.map { $0.totalReviews }.reduce(0, +)
        let correctReviews = cards.map { $0.correctReviews }.reduce(0, +)
        reviewAccuracy = totalReviews > 0 ? Double(correctReviews) / Double(totalReviews) : 0.0

        // Generate activity data (past 49 days for 7x7 grid)
        activityData = generateActivityData(days: 49)

        // Generate growth data
        growthData = generateGrowthData(days: 30)

        // Generate accuracy data
        accuracyData = generateAccuracyData(days: 7)

        // Calculate topic frequencies from chat sessions
        topicFrequencies = computeTopicFrequencies()

        // Calculate trends (simplified)
        conceptTrend = 15.0 // Mock data
        noteTrend = 8.0
        cardTrend = 22.0
        accuracyTrend = 5.0
    }

    private func generateActivityData(days: Int) -> [ActivityDay] {
        var data: [ActivityDay] = []
        let calendar = Calendar.current

        for dayOffset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: -dayOffset, to: Date()) else { continue }

            // Mock activity count (in real implementation, query actual activity)
            let count = Int.random(in: 0...10)

            data.append(ActivityDay(date: date, count: count))
        }

        return data.reversed()
    }

    private func generateGrowthData(days: Int) -> [GrowthPoint] {
        var data: [GrowthPoint] = []
        let calendar = Calendar.current
        var cumulativeCount = 0

        for dayOffset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: -dayOffset, to: Date()) else { continue }

            // Mock growth (in real implementation, query actual concept creation dates)
            cumulativeCount += Int.random(in: 0...2)

            data.append(GrowthPoint(date: date, count: cumulativeCount))
        }

        return data.reversed()
    }

    private func computeTopicFrequencies() -> [TopicFrequency] {
        var counts: [String: Int] = [:]
        for session in project.chatSessions {
            // Count extracted topics
            for topic in session.extractedTopics {
                let normalized = topic.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                guard !normalized.isEmpty else { continue }
                counts[normalized, default: 0] += 1
            }
            // Also count the chat title as a topic if it's not the default
            if !session.needsAutoTitle {
                let titleNormalized = session.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if !titleNormalized.isEmpty {
                    counts[titleNormalized, default: 0] += 1
                }
            }
        }
        return counts
            .map { TopicFrequency(topic: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
    }

    private func generateAccuracyData(days: Int) -> [AccuracyPoint] {
        var data: [AccuracyPoint] = []
        let calendar = Calendar.current

        for dayOffset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: -dayOffset, to: Date()) else { continue }

            // Mock accuracy
            let accuracy = Double.random(in: 70...95)

            data.append(AccuracyPoint(date: date, accuracy: accuracy))
        }

        return data.reversed()
    }
}

// MARK: - Supporting Types

enum TimeRange: String, CaseIterable {
    case week = "Week"
    case month = "Month"
    case quarter = "Quarter"

    var days: Int {
        switch self {
        case .week: return 7
        case .month: return 30
        case .quarter: return 90
        }
    }
}

struct ActivityDay: Identifiable {
    let id = UUID()
    let date: Date
    let count: Int
}

struct GrowthPoint: Identifiable {
    let id = UUID()
    let date: Date
    let count: Int
}

struct AccuracyPoint: Identifiable {
    let id = UUID()
    let date: Date
    let accuracy: Double
}

struct TopicFrequency: Identifiable {
    let id = UUID()
    let topic: String
    let count: Int
}

// MARK: - Topic Cloud

struct TopicCloudView: View {
    @ObservedObject var analytics: ProjectAnalytics

    private let cloudColors: [Color] = [
        .blue, .purple, .orange, .green, .pink, .cyan, .indigo, .mint, .teal, .red
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Topic Cloud")
                    .font(.headline)

                Spacer()

                if !analytics.topicFrequencies.isEmpty {
                    Text("\(analytics.topicFrequencies.count) topics")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal)

            if analytics.topicFrequencies.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "cloud")
                            .font(.largeTitle)
                            .foregroundColor(.secondary.opacity(0.5))
                        Text("No topics yet")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Text("Topics will appear as you chat")
                            .font(.caption)
                            .foregroundColor(.secondary.opacity(0.7))
                    }
                    .padding(.vertical, 24)
                    Spacer()
                }
            } else {
                let maxCount = analytics.topicFrequencies.first?.count ?? 1

                FlowLayout(spacing: 8) {
                    ForEach(Array(analytics.topicFrequencies.prefix(40).enumerated()), id: \.element.id) { index, item in
                        let scale = scaleFactor(count: item.count, max: maxCount)
                        let color = cloudColors[index % cloudColors.count]

                        Text(item.topic)
                            .font(.system(size: fontSize(for: scale)))
                            .fontWeight(fontWeight(for: scale))
                            .foregroundColor(color)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(color.opacity(heatOpacity(for: scale)))
                            .cornerRadius(6)
                            .help("\(item.topic): \(item.count) occurrence\(item.count == 1 ? "" : "s")")
                    }
                }
                .padding(.horizontal)

                // Heat legend
                HStack(spacing: 8) {
                    Text("Less frequent")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    ForEach(0..<5) { level in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.blue.opacity(0.1 + Double(level) * 0.2))
                            .frame(width: 12, height: 12)
                    }

                    Text("More frequent")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    private func scaleFactor(count: Int, max: Int) -> Double {
        guard max > 1 else { return 1.0 }
        return Double(count) / Double(max)
    }

    private func fontSize(for scale: Double) -> CGFloat {
        12 + scale * 16 // Range: 12–28pt
    }

    private func fontWeight(for scale: Double) -> Font.Weight {
        if scale > 0.7 { return .bold }
        if scale > 0.4 { return .semibold }
        return .regular
    }

    private func heatOpacity(for scale: Double) -> Double {
        0.08 + scale * 0.15
    }
}

