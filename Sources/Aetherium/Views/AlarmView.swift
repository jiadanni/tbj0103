import SwiftUI
import SwiftData

// MARK: - Alarm Panel (embedded in Calendar Sidebar)

struct AlarmPanelView: View {
    let project: Workspace
    let dailyNote: DailyNote?
    @ObservedObject private var alarmManager = AlarmManager.shared

    @State private var showingCreateAlarm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Alarms", systemImage: "alarm")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: { showingCreateAlarm = true }) {
                    Image(systemName: "plus.circle")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .help("Set a new alarm")
            }

            if alarmManager.activeAlarms.isEmpty {
                Text("No active alarms")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 4)
            } else {
                ForEach(alarmManager.activeAlarms) { alarm in
                    ActiveAlarmRow(alarm: alarm, onCancel: {
                        alarmManager.cancelAlarm(alarm)
                    })
                }
            }
        }
        .sheet(isPresented: $showingCreateAlarm) {
            CreateAlarmSheet(
                project: project,
                dailyNote: dailyNote,
                isPresented: $showingCreateAlarm
            )
        }
    }
}

// MARK: - Active Alarm Row

struct ActiveAlarmRow: View {
    let alarm: CalendarAlarm
    let onCancel: () -> Void

    @State private var remainingText = ""

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "alarm.fill")
                .font(.caption)
                .foregroundColor(alarm.remainingSeconds < 60 ? .red : .orange)

            VStack(alignment: .leading, spacing: 2) {
                Text(alarm.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)

                Text(alarm.formattedRemaining)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(alarm.remainingSeconds < 60 ? .red : .secondary)
            }

            Spacer()

            Button(action: onCancel) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .help("Cancel alarm")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(alarm.remainingSeconds < 60
                      ? Color.red.opacity(0.08)
                      : Color.orange.opacity(0.08))
        )
    }
}

// MARK: - Create Alarm Sheet

struct CreateAlarmSheet: View {
    let project: Workspace
    let dailyNote: DailyNote?
    @Binding var isPresented: Bool

    @ObservedObject private var alarmManager = AlarmManager.shared

    @State private var title = ""
    @State private var hours = 0
    @State private var minutes = 25
    @State private var seconds = 0
    @State private var inputPrompt = ""
    @State private var includePrompt = false

    private let presets: [(String, Int)] = [
        ("5 min", 5 * 60),
        ("15 min", 15 * 60),
        ("25 min", 25 * 60),
        ("45 min", 45 * 60),
        ("1 hour", 60 * 60),
        ("2 hours", 120 * 60),
    ]

    var body: some View {
        VStack(spacing: 20) {
            Text("Set Alarm")
                .font(.headline)

            // Title
            TextField("Alarm title", text: $title)
                .textFieldStyle(.roundedBorder)

            // Quick presets
            VStack(alignment: .leading, spacing: 6) {
                Text("Quick Set")
                    .font(.caption)
                    .foregroundColor(.secondary)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                    ForEach(presets, id: \.1) { preset in
                        Button(preset.0) {
                            applyPreset(preset.1)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }

            // Custom duration
            VStack(alignment: .leading, spacing: 6) {
                Text("Duration")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 12) {
                    DurationPicker(label: "Hours", value: $hours, range: 0...23)
                    DurationPicker(label: "Min", value: $minutes, range: 0...59)
                    DurationPicker(label: "Sec", value: $seconds, range: 0...59)
                }
            }

            // Duration preview
            let totalSeconds = hours * 3600 + minutes * 60 + seconds
            if totalSeconds > 0 {
                Text("Timer: \(CalendarAlarm.formatDuration(totalSeconds))")
                    .font(.caption)
                    .foregroundColor(.blue)
            }

            Divider()

            // Input prompt toggle
            Toggle(isOn: $includePrompt) {
                Text("Prompt for input when alarm fires")
                    .font(.caption)
            }

            if includePrompt {
                TextField("What would you like to be asked?", text: $inputPrompt)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
            }

            // Actions
            HStack {
                Button("Cancel") {
                    isPresented = false
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Set Alarm") {
                    createAlarm()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(totalSeconds == 0)
            }
        }
        .padding()
        .frame(width: 340)
    }

    private func applyPreset(_ totalSeconds: Int) {
        hours = totalSeconds / 3600
        minutes = (totalSeconds % 3600) / 60
        seconds = totalSeconds % 60
    }

    private func createAlarm() {
        let totalSeconds = hours * 3600 + minutes * 60 + seconds
        guard totalSeconds > 0 else { return }

        let alarmTitle = title.isEmpty ? "Alarm (\(CalendarAlarm.formatDuration(totalSeconds)))" : title

        _ = alarmManager.createAlarm(
            title: alarmTitle,
            durationSeconds: totalSeconds,
            inputPrompt: includePrompt ? inputPrompt : nil,
            project: project,
            dailyNote: dailyNote
        )

        isPresented = false
    }
}

// MARK: - Duration Picker Component

struct DurationPicker: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    var body: some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)

            Picker("", selection: $value) {
                ForEach(Array(range), id: \.self) { n in
                    Text(String(format: "%02d", n)).tag(n)
                }
            }
            .labelsHidden()
            .frame(width: 60)
        }
    }
}

// MARK: - Alarm Fired Overlay

struct AlarmFiredOverlay: View {
    @ObservedObject private var alarmManager = AlarmManager.shared
    @State private var userInput = ""
    @State private var isPulsing = false

    var body: some View {
        if let alarm = alarmManager.firedAlarm {
            ZStack {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()

                VStack(spacing: 20) {
                    // Alarm icon with animation
                    Image(systemName: "alarm.waves.left.and.right")
                        .font(.system(size: 48))
                        .foregroundColor(.orange)
                        .scaleEffect(isPulsing ? 1.1 : 1.0)
                        .animation(
                            .easeInOut(duration: 0.6).repeatForever(autoreverses: true),
                            value: isPulsing
                        )

                    Text("Alarm!")
                        .font(.title)
                        .fontWeight(.bold)

                    Text(alarm.title)
                        .font(.title3)
                        .foregroundColor(.secondary)

                    if let note = alarm.note, !note.isEmpty {
                        Text(note)
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // Input prompt section
                    if let prompt = alarm.inputPrompt, !prompt.isEmpty {
                        Divider()
                            .frame(width: 200)

                        Text(prompt)
                            .font(.body)
                            .fontWeight(.medium)

                        TextEditor(text: $userInput)
                            .frame(height: 100)
                            .border(Color.secondary.opacity(0.3))
                            .padding(.horizontal)

                        HStack(spacing: 12) {
                            Button("Dismiss") {
                                alarmManager.dismissFiredAlarm()
                            }
                            .buttonStyle(.bordered)

                            Button("Submit") {
                                alarmManager.submitAlarmInput(userInput)
                                userInput = ""
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    } else {
                        Button("Dismiss") {
                            alarmManager.dismissFiredAlarm()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    }
                }
                .padding(32)
                .frame(maxWidth: 420)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(nsColor: .windowBackgroundColor))
                        .shadow(radius: 20)
                )
            }
            .onAppear { isPulsing = true }
        }
    }
}
