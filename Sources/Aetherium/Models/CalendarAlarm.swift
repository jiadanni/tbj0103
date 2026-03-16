import Foundation
import SwiftData

// MARK: - Calendar Alarm Model

@Model
final class CalendarAlarm {
    @Attribute(.unique) var id: UUID
    var title: String
    var note: String?
    var durationSeconds: Int // The original duration set by the user
    var fireDate: Date // When the alarm should fire
    var isActive: Bool
    var isCompleted: Bool
    var inputPrompt: String? // Optional prompt shown when alarm fires
    var createdAt: Date

    var project: Workspace?
    var dailyNote: DailyNote?

    init(
        id: UUID = UUID(),
        title: String,
        note: String? = nil,
        durationSeconds: Int,
        inputPrompt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.note = note
        self.durationSeconds = durationSeconds
        self.fireDate = Date().addingTimeInterval(TimeInterval(durationSeconds))
        self.isActive = true
        self.isCompleted = false
        self.inputPrompt = inputPrompt
        self.createdAt = Date()
    }

    var remainingSeconds: Int {
        max(0, Int(fireDate.timeIntervalSinceNow))
    }

    var isExpired: Bool {
        fireDate <= Date()
    }

    var formattedDuration: String {
        Self.formatDuration(durationSeconds)
    }

    var formattedRemaining: String {
        Self.formatDuration(remainingSeconds)
    }

    static func formatDuration(_ totalSeconds: Int) -> String {
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%d:%02d", minutes, seconds)
        }
    }
}
