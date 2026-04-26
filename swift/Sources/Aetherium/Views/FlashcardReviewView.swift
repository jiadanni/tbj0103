import SwiftData
import SwiftUI

// MARK: - Flashcard Review View

struct FlashcardReviewView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService

    @StateObject private var srEngine: SpacedRepetitionEngine
    @State private var currentCardIndex = 0
    @State private var isShowingAnswer = false
    @State private var sessionStats = SessionStats()
    @State private var showingCongratulations = false
    @State private var showingNewCardSheet = false
    @State private var isAutoGenerating = false
    @State private var showDemoTip = false
    @EnvironmentObject var demoModeManager: DemoModeManager

    init(project: Workspace, modelContext: ModelContext) {
        self.project = project
        _srEngine = StateObject(wrappedValue: SpacedRepetitionEngine(modelContext: modelContext))
    }

    var currentCard: LearningCard? {
        guard currentCardIndex < srEngine.dueCards.count else { return nil }
        return srEngine.dueCards[currentCardIndex]
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with progress
            ReviewHeaderView(
                current: currentCardIndex + 1,
                total: srEngine.dueCards.count,
                sessionStats: sessionStats
            )

            Divider()

            if let card = currentCard {
                // Flashcard
                FlashcardView(
                    card: card,
                    isShowingAnswer: $isShowingAnswer
                )
                .frame(maxHeight: .infinity)

                Divider()

                // Controls
                if isShowingAnswer {
                    QualityRatingView(
                        onRate: { quality in
                            rateCard(card, quality: quality)
                        }
                    )
                    .padding()
                } else {
                    Button(action: { isShowingAnswer = true }) {
                        Label("Show Answer", systemImage: "eye")
                            .font(.body)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.space, modifiers: [])
                    .padding()
                }
            } else if showingCongratulations {
                CongratulationsView(
                    sessionStats: sessionStats,
                    onContinue: {
                        showingCongratulations = false
                        resetSession()
                    }
                )
            } else if isAutoGenerating {
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)
                    Text("Generating flashcards from your content...")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyReviewView(
                    onCreateCard: { showingNewCardSheet = true }
                )
            }
        }
        .navigationTitle("Review Flashcards")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showingNewCardSheet = true }) {
                    Label("New Card", systemImage: "plus.circle.fill")
                }
            }

            ToolbarItem(placement: .automatic) {
                Button(action: { autoGenerateCards() }) {
                    Label(
                        isAutoGenerating ? "Generating..." : "Auto-Generate",
                        systemImage: "sparkles"
                    )
                }
                .disabled(isAutoGenerating || (project.sources.isEmpty && project.chatSessions.isEmpty))
            }
        }
        .sheet(isPresented: $showingNewCardSheet) {
            NewFlashcardSheet(project: project, modelContext: modelContext) {
                srEngine.loadDueCards(for: project)
            }
        }
        .task {
            srEngine.loadDueCards(for: project)

            // Auto-generate flashcards if there are none but the project has content
            let allCards = srEngine.getAllCards(for: project)
            let hasContent = !project.sources.isEmpty || !project.chatSessions.isEmpty
            if allCards.isEmpty && hasContent {
                autoGenerateCards()
            }
        }
        .overlay(alignment: .bottom) {
            if showDemoTip {
                DemoTipCallout(message: "Press Space to reveal the answer", systemImage: "keyboard")
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.bottom, 24)
            }
        }
        .onAppear {
            guard demoModeManager.isActive else { return }
            withAnimation(.easeIn(duration: 0.3).delay(0.6)) { showDemoTip = true }
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                withAnimation(.easeOut(duration: 0.3)) { showDemoTip = false }
            }
        }
    }

    // MARK: - Actions

    private func rateCard(_ card: LearningCard, quality: Int) {
        srEngine.reviewCard(card, quality: quality)

        // Update session stats
        sessionStats.totalReviewed += 1
        if quality >= 3 {
            sessionStats.correct += 1
        }

        // Move to next card
        isShowingAnswer = false
        currentCardIndex += 1

        // Check if session complete
        if currentCardIndex >= srEngine.dueCards.count {
            showingCongratulations = true
        }
    }

    private func resetSession() {
        currentCardIndex = 0
        sessionStats = SessionStats()
        srEngine.loadDueCards(for: project)
    }

    private func autoGenerateCards() {
        guard !isAutoGenerating else { return }
        isAutoGenerating = true

        Task {
            let autoGen = AutoContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
            await autoGen.processEntireProject(project)
            srEngine.loadDueCards(for: project)
            isAutoGenerating = false
        }
    }
}

// MARK: - Flashcard Display

struct FlashcardView: View {
    let card: LearningCard
    @Binding var isShowingAnswer: Bool

    @State private var isFlipped = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Card content
            VStack(spacing: 24) {
                // Card indicator
                Text(isShowingAnswer ? "Answer" : "Question")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)

                // Content
                ScrollView {
                    Text(isShowingAnswer ? card.back : card.front)
                        .font(.title2)
                        .multilineTextAlignment(.center)
                        .padding()
                }
                .frame(maxHeight: 400)
            }
            .frame(maxWidth: 600)
            .padding(40)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.secondary.opacity(0.05))
                    .shadow(radius: 10)
            )
            .rotation3DEffect(
                .degrees(isFlipped ? 180 : 0),
                axis: (x: 0, y: 1, z: 0)
            )
            .animation(.easeInOut(duration: 0.6), value: isFlipped)

            Spacer()

            // Card metadata
            HStack(spacing: 20) {
                if !card.tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(card.tags.prefix(3), id: \.self) { tag in
                            Text("#\(tag)")
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }
                }

                Spacer()

                // Card stats
                HStack(spacing: 16) {
                    Label("\(card.totalReviews) reviews", systemImage: "repeat")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Label("Ease: \(String(format: "%.1f", card.easeFactor))", systemImage: "chart.line.uptrend.xyaxis")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if card.repetitions > 0 {
                        Label("Streak: \(card.repetitions)", systemImage: "flame.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 20)
        }
        .onChange(of: isShowingAnswer) { _, newValue in
            if newValue {
                isFlipped = true
            } else {
                isFlipped = false
            }
        }
    }
}

// MARK: - Quality Rating

struct QualityRatingView: View {
    let onRate: (Int) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("How well did you know this?")
                .font(.headline)

            HStack(spacing: 12) {
                QualityButton(
                    quality: 0,
                    title: "Forgot",
                    subtitle: "< 1 day",
                    color: .red,
                    icon: "xmark.circle",
                    onRate: onRate
                )

                QualityButton(
                    quality: 3,
                    title: "Hard",
                    subtitle: "1 day",
                    color: .orange,
                    icon: "minus.circle",
                    onRate: onRate
                )

                QualityButton(
                    quality: 4,
                    title: "Good",
                    subtitle: "3 days",
                    color: .blue,
                    icon: "checkmark.circle",
                    onRate: onRate
                )

                QualityButton(
                    quality: 5,
                    title: "Easy",
                    subtitle: "7 days",
                    color: .green,
                    icon: "star.circle",
                    onRate: onRate
                )
            }
        }
    }
}

struct QualityButton: View {
    let quality: Int
    let title: String
    let subtitle: String
    let color: Color
    let icon: String
    let onRate: (Int) -> Void

    var body: some View {
        Button(action: { onRate(quality) }) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title2)

                VStack(spacing: 2) {
                    Text(title)
                        .font(.callout)
                        .fontWeight(.medium)

                    Text(subtitle)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(color.opacity(0.1))
            .foregroundColor(color)
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(KeyEquivalent(Character(UnicodeScalar(quality + 48)!)), modifiers: [])
    }
}

// MARK: - Review Header

struct ReviewHeaderView: View {
    let current: Int
    let total: Int
    let sessionStats: SessionStats

    var progress: Double {
        guard total > 0 else { return 0.0 }
        return Double(current - 1) / Double(total)
    }

    var body: some View {
        VStack(spacing: 8) {
            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.1))

                    Rectangle()
                        .fill(Color.blue)
                        .frame(width: geometry.size.width * progress)
                }
            }
            .frame(height: 4)

            HStack {
                // Progress text
                Text("\(current) / \(total)")
                    .font(.headline)

                Spacer()

                // Session stats
                HStack(spacing: 20) {
                    Label("\(sessionStats.totalReviewed) reviewed", systemImage: "checkmark.circle")
                        .font(.caption)

                    if sessionStats.totalReviewed > 0 {
                        let accuracy = Double(sessionStats.correct) / Double(sessionStats.totalReviewed) * 100
                        Label("\(Int(accuracy))% correct", systemImage: "chart.line.uptrend.xyaxis")
                            .font(.caption)
                            .foregroundColor(accuracy >= 80 ? .green : (accuracy >= 60 ? .orange : .red))
                    }
                }
                .foregroundColor(.secondary)
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.05))
    }
}

// MARK: - Empty State

struct EmptyReviewView: View {
    let onCreateCard: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundColor(.green)

            Text("All caught up!")
                .font(.title)
                .fontWeight(.semibold)

            Text("You have no cards due for review right now")
                .foregroundColor(.secondary)

            Button(action: onCreateCard) {
                Label("Create New Card", systemImage: "plus.circle")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Congratulations View

struct CongratulationsView: View {
    let sessionStats: SessionStats
    let onContinue: () -> Void

    var accuracy: Double {
        guard sessionStats.totalReviewed > 0 else { return 0.0 }
        return Double(sessionStats.correct) / Double(sessionStats.totalReviewed)
    }

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 80))
                .foregroundColor(.yellow)

            Text("Session Complete!")
                .font(.largeTitle)
                .fontWeight(.bold)

            VStack(spacing: 12) {
                FlashcardStatRow(label: "Cards Reviewed", value: "\(sessionStats.totalReviewed)")
                FlashcardStatRow(label: "Correct", value: "\(sessionStats.correct)")
                FlashcardStatRow(label: "Accuracy", value: "\(Int(accuracy * 100))%")
            }
            .padding(20)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(12)

            Button(action: onContinue) {
                Label("Continue Learning", systemImage: "arrow.right.circle.fill")
                    .font(.body)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FlashcardStatRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .fontWeight(.semibold)
        }
    }
}

// MARK: - New Flashcard Sheet

struct NewFlashcardSheet: View {
    let project: Workspace
    let modelContext: ModelContext
    let onCreated: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var front = ""
    @State private var back = ""
    @State private var selectedType: CardType = .basic
    @State private var difficulty = 3
    @State private var tagsText = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Flashcard")
                .font(.headline)

            Form {
                Section("Card Content") {
                    TextField("Front (question)", text: $front, axis: .vertical)
                        .lineLimit(2...6)

                    TextField("Back (answer)", text: $back, axis: .vertical)
                        .lineLimit(2...6)
                }

                Section("Options") {
                    Picker("Type", selection: $selectedType) {
                        Text("Basic").tag(CardType.basic)
                        Text("Cloze Deletion").tag(CardType.cloze)
                        Text("Reversed").tag(CardType.reversed)
                    }

                    Picker("Difficulty", selection: $difficulty) {
                        ForEach(1...5, id: \.self) { level in
                            Text("\(level)").tag(level)
                        }
                    }

                    TextField("Tags (comma-separated)", text: $tagsText)
                }
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)

                Button("Create") {
                    createCard()
                }
                .buttonStyle(.borderedProminent)
                .disabled(front.isEmpty || back.isEmpty)
            }
        }
        .padding()
        .frame(width: 450, height: 420)
    }

    private func createCard() {
        let tags = tagsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        let card = LearningCard(
            front: front,
            back: back,
            cardType: selectedType,
            difficulty: difficulty,
            tags: tags
        )
        card.project = project

        modelContext.insert(card)
        onCreated()
        dismiss()
    }
}

// MARK: - Session Stats

struct SessionStats {
    var totalReviewed = 0
    var correct = 0
}
