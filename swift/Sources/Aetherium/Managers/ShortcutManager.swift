import SwiftUI

class ShortcutManager: ObservableObject {
    @AppStorage("shortcut_newProject") var newProjectShortcut: String = "n"
    @AppStorage("shortcut_newProjectModifiers") var newProjectModifiersRaw: Int = EventModifiers.command.rawValue

    @AppStorage("shortcut_newChat") var newChatShortcut: String = "n"
    @AppStorage("shortcut_newChatModifiers") var newChatModifiersRaw: Int = (EventModifiers.command.rawValue | EventModifiers.shift.rawValue)

    @AppStorage("shortcut_search") var searchShortcut: String = "k"
    @AppStorage("shortcut_searchModifiers") var searchModifiersRaw: Int = EventModifiers.command.rawValue

    @AppStorage("shortcut_toggleSidebar") var toggleSidebarShortcut: String = "s"
    @AppStorage("shortcut_toggleSidebarModifiers") var toggleSidebarModifiersRaw: Int = EventModifiers.command.rawValue

    var newProjectKeyEquivalent: KeyEquivalent {
        KeyEquivalent(newProjectShortcut.first ?? "n")
    }
    var newProjectModifiers: EventModifiers {
        EventModifiers(rawValue: newProjectModifiersRaw)
    }

    var newChatKeyEquivalent: KeyEquivalent {
        KeyEquivalent(newChatShortcut.first ?? "n")
    }
    var newChatModifiers: EventModifiers {
        EventModifiers(rawValue: newChatModifiersRaw)
    }

    var searchKeyEquivalent: KeyEquivalent {
        KeyEquivalent(searchShortcut.first ?? "k")
    }
    var searchModifiers: EventModifiers {
        EventModifiers(rawValue: searchModifiersRaw)
    }

    var toggleSidebarKeyEquivalent: KeyEquivalent {
        KeyEquivalent(toggleSidebarShortcut.first ?? "s")
    }
    var toggleSidebarModifiers: EventModifiers {
        EventModifiers(rawValue: toggleSidebarModifiersRaw)
    }
}
