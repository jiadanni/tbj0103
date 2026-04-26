import Foundation
import SwiftData

@Model
final class QuickSearchDocument {
    @Attribute(.unique) var rowid: Int64
    var docId: String
    var targetId: String?
    var kind: String?
    var workspaceId: String?
    var projectId: String?
    var sessionId: String?
    var sourceSessionId: String?
    var title: String?
    var subtitle: String?
    var body: String?
    var updatedAt: Date?

    init(
        rowid: Int64 = 0,
        docId: String,
        title: String? = nil,
        body: String? = nil
    ) {
        self.rowid = rowid
        self.docId = docId
        self.title = title
        self.body = body
        self.updatedAt = Date()
    }
}
