import AppKit
import Foundation
import SwiftData
import UserNotifications

// MARK: - Alarm Manager

@MainActor
final class AlarmManager: ObservableObject {
    @Published var activeAlarms: [CalendarAlarm] = []
    @Published var firedAlarm: CalendarAlarm? // Currently fired alarm awaiting input

    private var timer: Timer?
    private var modelContext: ModelContext?

    static let shared = AlarmManager()

    private init() {}

    func configure(modelContext: ModelContext) {
        self.modelContext = modelContext
        requestNotificationPermission()
        loadActiveAlarms()
        startPolling()
    }

    // MARK: - Notification Permission

    private func requestNotificationPermission() {
        guard Bundle.main.bundleIdentifier != nil else {
            print("Skipping notification permission: no app bundle available")
            return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
            if let error = error {
                print("Notification permission error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Alarm CRUD

    func createAlarm(
        title: String,
        durationSeconds: Int,
        note: String? = nil,
        inputPrompt: String? = nil,
        project: Workspace? = nil,
        dailyNote: DailyNote? = nil
    ) -> CalendarAlarm? {
        guard let modelContext else { return nil }

        let alarm = CalendarAlarm(
            title: title,
            note: note,
            durationSeconds: durationSeconds,
            inputPrompt: inputPrompt
        )
        alarm.project = project
        alarm.dailyNote = dailyNote

        modelContext.insert(alarm)
        try? modelContext.save()

        scheduleNotification(for: alarm)
        loadActiveAlarms()

        return alarm
    }

    func cancelAlarm(_ alarm: CalendarAlarm) {
        alarm.isActive = false
        alarm.isCompleted = true
        try? modelContext?.save()

        if Bundle.main.bundleIdentifier != nil {
            UNUserNotificationCenter.current().removePendingNotificationRequests(
                withIdentifiers: [alarm.id.uuidString]
            )
        }

        loadActiveAlarms()
    }

    func dismissFiredAlarm() {
        if let alarm = firedAlarm {
            alarm.isCompleted = true
            alarm.isActive = false
            try? modelContext?.save()
        }
        firedAlarm = nil
        loadActiveAlarms()
    }

    func submitAlarmInput(_ input: String) {
        if let alarm = firedAlarm {
            alarm.note = (alarm.note ?? "") + "\n---\nResponse: \(input)"
            alarm.isCompleted = true
            alarm.isActive = false
            try? modelContext?.save()
        }
        firedAlarm = nil
        loadActiveAlarms()
    }

    // MARK: - Scheduling

    private func scheduleNotification(for alarm: CalendarAlarm) {
        let content = UNMutableNotificationContent()
        content.title = "Aetherium Alarm"
        content.body = alarm.title
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, alarm.fireDate.timeIntervalSinceNow),
            repeats: false
        )

        let request = UNNotificationRequest(
            identifier: alarm.id.uuidString,
            content: content,
            trigger: trigger
        )

        if Bundle.main.bundleIdentifier != nil {
            UNUserNotificationCenter.current().add(request)
        }
    }

    // MARK: - Polling

    private func startPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
    }

    private func tick() {
        objectWillChange.send()

        // Check for newly expired alarms
        for alarm in activeAlarms where alarm.isExpired && alarm.isActive && !alarm.isCompleted {
            alarm.isActive = false
            firedAlarm = alarm

            // Bring app to front
            NSApplication.shared.activate(ignoringOtherApps: true)

            // Play system sound
            NSSound.beep()
            break // Handle one at a time
        }
    }

    private func loadActiveAlarms() {
        guard let modelContext else { return }

        let descriptor = FetchDescriptor<CalendarAlarm>(
            predicate: #Predicate { alarm in
                alarm.isActive && !alarm.isCompleted
            },
            sortBy: [SortDescriptor(\.fireDate)]
        )

        activeAlarms = (try? modelContext.fetch(descriptor)) ?? []
    }

    deinit {
        timer?.invalidate()
    }
}
