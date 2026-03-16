import Foundation
import SwiftUI

enum ProjectTabPosition: String, CaseIterable {
    case top = "Horizontal Tabs"
    case sidebar = "Sidebar"
}

@MainActor
class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @AppStorage("preferredModel") var preferredModel: String = "qwen2.5:7b"
    @AppStorage("preferredEmbeddingModel") var preferredEmbeddingModel: String = "nomic-embed-text"
    @AppStorage("projectTabPosition") var projectTabPosition: String = ProjectTabPosition.top.rawValue
    @AppStorage("touchIDEnabled") var touchIDEnabled: Bool = true
    @AppStorage("autoLockMinutes") var autoLockMinutes: Int = 0

    var tabPosition: ProjectTabPosition {
        get { ProjectTabPosition(rawValue: projectTabPosition) ?? .top }
        set { projectTabPosition = newValue.rawValue }
    }
}
