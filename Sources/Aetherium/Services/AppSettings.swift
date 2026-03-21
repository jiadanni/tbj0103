import Foundation
import SwiftUI

enum ProjectTabPosition: String, CaseIterable {
    case top = "Horizontal Tabs"
    case sidebar = "Sidebar"
}

@MainActor
class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @AppStorage("preferredModel") var preferredModel: String = ""
    @AppStorage("preferredEmbeddingModel") var preferredEmbeddingModel: String = "nomic-embed-text"
    @AppStorage("projectTabPosition") var projectTabPosition: String = ProjectTabPosition.top.rawValue
    @AppStorage("touchIDEnabled") var touchIDEnabled: Bool = true
    @AppStorage("autoLockMinutes") var autoLockMinutes: Int = 0

    // Backup settings
    @AppStorage("backupEnabled") var backupEnabled: Bool = false
    @AppStorage("backupIntervalMinutes") var backupIntervalMinutes: Int = 60
    @AppStorage("backupRetentionCount") var backupRetentionCount: Int = 25
    @AppStorage("backupLocationBookmark") var backupLocationBookmark: Data = Data()

    var tabPosition: ProjectTabPosition {
        get { ProjectTabPosition(rawValue: projectTabPosition) ?? .top }
        set { projectTabPosition = newValue.rawValue }
    }

    var backupLocationURL: URL? {
        guard !backupLocationBookmark.isEmpty else { return nil }
        var isStale = false
        guard let url = try? URL(
            resolvingBookmarkData: backupLocationBookmark,
            options: .withSecurityScope,
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        ) else { return nil }
        if isStale {
            // Refresh bookmark
            if let fresh = try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil) {
                backupLocationBookmark = fresh
            }
        }
        return url
    }

    var backupLocationDisplay: String {
        if let url = backupLocationURL {
            return url.lastPathComponent
        }
        return "Default"
    }
}
