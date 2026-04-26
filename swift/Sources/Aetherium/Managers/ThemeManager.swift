import SwiftUI

class ThemeManager: ObservableObject {
    @AppStorage("selectedTheme") var selectedTheme: Theme = .system
    @AppStorage("accentColor") var accentColor: AppAccentColor = .blue
    @AppStorage("fontSizeMultiplier") var fontSizeMultiplier: Double = 1.0
    @AppStorage("sidebarWidth") var sidebarWidth: Double = 250.0
    @AppStorage("customAccentColorData") var customAccentColorData: Data = Data()
    @AppStorage("isSidebarCollapsed") var isSidebarCollapsed: Bool = false

    var customAccentColor: Color {
        get {
            if customAccentColorData.isEmpty { return .blue }
            do {
                if let color = try NSKeyedUnarchiver.unarchivedObject(ofClass: NSColor.self, from: customAccentColorData) {
                    return Color(nsColor: color)
                }
            } catch {
                print("Failed to unarchive custom color: \(error)")
            }
            return .blue
        }
        set {
            do {
                let data = try NSKeyedArchiver.archivedData(withRootObject: NSColor(newValue), requiringSecureCoding: true)
                customAccentColorData = data
            } catch {
                print("Failed to archive custom color: \(error)")
            }
        }
    }

    enum Theme: String, CaseIterable, Identifiable {
        case system = "System"
        case light = "Light"
        case dark = "Dark"
        case oledDark = "OLED Dark"
        case sepia = "Sepia"
        case hacker = "Hacker"

        var id: String { rawValue }

        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light, .sepia: return .light
            case .dark, .oledDark, .hacker: return .dark
            }
        }
    }

    enum AppAccentColor: String, CaseIterable, Identifiable {
        case blue = "Blue"
        case purple = "Purple"
        case green = "Green"
        case orange = "Orange"
        case red = "Red"
        case custom = "Custom"

        var id: String { rawValue }

        func color(customColor: Color) -> Color {
            switch self {
            case .blue: return .blue
            case .purple: return .purple
            case .green: return .green
            case .orange: return .orange
            case .red: return .red
            case .custom: return customColor
            }
        }
    }
}
