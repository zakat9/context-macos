// Context — the app: one menu-bar item, one transient popover, and two small windows (App access, Settings).
// No Dock icon, no floating window, no key or mouse monitoring, no network.
//
// The menu-bar item shows the tags of the one whole object selected in the app in front (Status.swift decides when
// that app may be asked; it never causes a prompt and never opens an app). Clicking the item opens the popover,
// which asks the same app again before anything is written.
//
// Two things are off until the person sets them in Settings:
//   · Tag current item: a shortcut of their choosing opens the same popover for what is selected (HotKey.swift).
//     macOS reports that one chord; no other key is ever seen.
//   · Insert context: the app answers its own browser extension through a local helper (Composer.swift).
//     Started by a browser as that helper, this executable only carries messages (ComposerHost.swift).

import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var bridge: Bridge?
    private var webView: WKWebView?
    private var access: AccessWindow?
    private var monitor: StatusMonitor?
    private var scripts: ScriptRunner?
    private let hotKeys = HotKeyCenter()
    private var preferences: Preferences?
    private var settingsWindow: SettingsWindow?
    private var capturing = false
    private var previousApp: NSRunningApplication?
    private var pageReady = false
    private var waitingCall: String?
    private var giveFocusBack = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        // One Context, one menu-bar item: a second copy started by mistake leaves at once.
        if let own = Bundle.main.bundleIdentifier {
            let me = ProcessInfo.processInfo.processIdentifier
            let others = NSRunningApplication.runningApplications(withBundleIdentifier: own).filter { $0.processIdentifier != me }
            if !others.isEmpty {
                NSApplication.shared.terminate(nil)
                return
            }
        }
        guard let page = loadPopoverPage() else {
            fail("The popover page is missing from the app. Build the app again with build.sh.")
            return
        }
        let store = IndexStore(home: IndexStore.defaultHome())
        let scripts = ScriptRunner()
        self.scripts = scripts
        let bridge = Bridge(store: store, scripts: scripts)
        bridge.onClose = { [weak self] in self?.popover.performClose(nil) }
        bridge.onQuit = { NSApplication.shared.terminate(nil) }
        bridge.onReady = { [weak self] in self?.pageBecameReady() }
        bridge.onSaved = { [weak self] in self?.monitor?.indexSaved() }
        bridge.onAccess = { [weak self] bundleId in self?.showAccess(focus: bundleId) }
        bridge.onSettings = { [weak self] in
            self?.giveFocusBack = false
            self?.popover.performClose(nil)
            AccessWindow.openSettings()
        }
        bridge.onPreferences = { [weak self] in self?.showSettings() }
        bridge.onSize = { [weak self] height in self?.fitPopover(height: height) ?? ["ok": false] }
        self.bridge = bridge

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "workindex")
        let size = NSSize(width: AppDelegate.popoverWidth, height: AppDelegate.popoverStartHeight)
        let webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.navigationDelegate = bridge
        webView.loadHTMLString(page, baseURL: nil)
        self.webView = webView

        let controller = NSViewController()
        controller.view = webView
        popover.contentViewController = controller
        popover.contentSize = size
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self

        if statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            if let button = item.button {
                button.target = self
                button.action = #selector(togglePopover(_:))
            }
            statusItem = item
        }
        showStatus(["state": "off", "title": "", "tooltip": "Context: tag what is selected, or copy context for an AI",
                    "label": "Context"])

        if let accessPage = loadAccessPage() {
            let window = AccessWindow(page: accessPage)
            window.onChanged = { [weak self] in self?.monitor?.accessChanged() }
            access = window
            let hasIndex = FileManager.default.fileExists(atPath: store.indexURL.path)
            DispatchQueue.main.async { window.launch(hasIndex: hasIndex) }
        }
        if let rules = loadStatusRules(), let engine = StatusEngine(source: rules) {
            let monitor = StatusMonitor(engine: engine, scripts: scripts, store: store)
            monitor.onShow = { [weak self] command in self?.showStatus(command) }
            monitor.onScope = { [weak self] on in self?.hotKeys.setScope(on) }
            self.monitor = monitor
            monitor.start()
        }

        // Settings: what the person set before is in force again. With nothing set, this registers nothing,
        // opens no socket and writes no file.
        let engine = loadInsertRules().flatMap { InsertEngine(source: $0, store: store, scripts: scripts) }
        let preferences = Preferences(store: SettingsStore(home: store.home), hotKeys: hotKeys,
                                      composer: Composer(home: store.home, engine: engine))
        self.preferences = preferences
        hotKeys.onPressed = { [weak self] in self?.tagCurrentItem() }
        preferences.start()
        if let settingsPage = loadSettingsPage() {
            settingsWindow = SettingsWindow(page: settingsPage, preferences: preferences)
        }
    }

    /// The popover is always 352 points wide. Its height is the page's height, between a floor and the room on the
    /// screen the menu-bar item is on (below the menu bar, above the Dock, less a margin for the arrow), and never
    /// more than a comfortable maximum. The page measures its content, not the window, so this cannot start a loop.
    static let popoverWidth: CGFloat = 352
    static let popoverStartHeight: CGFloat = 300
    static let popoverMinHeight: CGFloat = 160
    static let popoverMaxHeight: CGFloat = 720

    /// The room for the popover on a screen whose visible part (below the menu bar, above the Dock) is this tall.
    static func popoverRoom(visibleHeight: CGFloat) -> CGFloat {
        max(popoverMinHeight, min(popoverMaxHeight, floor(visibleHeight - 28)))
    }

    /// The popover's height for a page this tall, in this much room. nil for a height that is not a height.
    static func popoverHeight(content: Double, room: CGFloat) -> CGFloat? {
        guard content.isFinite, content > 0 else { return nil }
        return min(room, max(popoverMinHeight, CGFloat(content.rounded(.up))))
    }

    private func popoverRoom() -> CGFloat {
        let screen = statusItem?.button?.window?.screen ?? NSScreen.main
        return AppDelegate.popoverRoom(visibleHeight: screen?.visibleFrame.height ?? 800)
    }

    private func fitPopover(height: Double) -> [String: Any] {
        let room = popoverRoom()
        guard let applied = AppDelegate.popoverHeight(content: height, room: room) else { return ["ok": false, "room": Double(room)] }
        let size = NSSize(width: AppDelegate.popoverWidth, height: applied)
        if popover.contentSize != size { popover.contentSize = size }
        return ["ok": true, "height": Double(applied), "room": Double(room)]
    }

    private func showSettings() {
        if popover.isShown {
            giveFocusBack = false
            popover.performClose(nil)
        }
        settingsWindow?.show()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showAccess(focus: "")
        return false
    }

    private func showAccess(focus: String) {
        if popover.isShown {
            giveFocusBack = false
            popover.performClose(nil)
        }
        access?.show(focus: focus)
    }

    /// What the menu-bar item shows: decided in core/status.js, drawn here.
    ///   tags  a filled tag and the tag names      none  an outlined tag (one item selected, no tags)
    ///   off   a dimmed outlined tag (nothing to tag here, or not allowed)      wait  an outlined tag, briefly
    private func showStatus(_ command: [String: Any]) {
        guard let button = statusItem?.button else { return }
        let state = command["state"] as? String ?? "off"
        let title = command["title"] as? String ?? ""
        if let image = NSImage(systemSymbolName: state == "tags" ? "tag.fill" : "tag", accessibilityDescription: "Context") {
            image.isTemplate = true
            button.image = image
            button.title = title.isEmpty ? "" : " " + title
            button.imagePosition = title.isEmpty ? .imageOnly : .imageLeading
        } else {
            button.image = nil
            button.title = title.isEmpty ? "C" : "C " + title
        }
        button.appearsDisabled = (state == "off")
        button.toolTip = command["tooltip"] as? String
        button.setAccessibilityLabel(command["label"] as? String)
    }

    @objc private func togglePopover(_ sender: Any?) {
        if popover.isShown {
            popover.performClose(sender)
            return
        }
        openPopover(captured: nil)
    }

    /// The Tag current item shortcut was pressed. macOS reports the one registered chord; nothing else is listened to.
    /// What is selected is asked BEFORE Context comes forward, and only of an app Context follows that is in front
    /// and already allowed (looked up without a prompt). The popover then opens on exactly that answer; before a tag
    /// is written the popover asks again and refuses if the selection is no longer the same item.
    private func tagCurrentItem() {
        guard !popover.isShown, !capturing, let scripts = scripts,
              let front = NSWorkspace.shared.frontmostApplication, !front.isTerminated,
              let bundleId = front.bundleIdentifier, bundleId != Bundle.main.bundleIdentifier,
              Scripts.selection[bundleId] != nil else { return }
        let pid = front.processIdentifier
        capturing = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let permission = AccessWindow.permission(bundleId, ask: false)
            DispatchQueue.main.async {
                guard let app = self else { return }
                app.capturing = false
                // If the person has already moved to another app, nothing opens.
                guard !app.popover.isShown, let now = NSWorkspace.shared.frontmostApplication,
                      now.processIdentifier == pid else { return }
                let captured: [String: Any] = permission == 0 ? scripts.selection(bundleId: bundleId)
                                                              : ["ok": false, "code": permission]
                app.openPopover(captured: captured)
            }
        }
    }

    /// `captured` is the front app's answer when the shortcut already asked it; nil when the menu-bar item was clicked
    /// (the page then asks).
    private func openPopover(captured: [String: Any]?) {
        guard let button = statusItem?.button else { return }
        // The app the person was working in, noted before this app comes forward.
        if let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp = front
        }
        var info: [String: Any] = ["bundleId": previousApp?.bundleIdentifier ?? "", "name": previousApp?.localizedName ?? "",
                                   "room": Double(popoverRoom())]
        if let captured = captured {
            info["captured"] = captured
            info["via"] = "shortcut"
            bridge?.noteSelection(captured)
        }
        giveFocusBack = true
        monitor?.popoverChanged(open: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApplication.shared.activate(ignoringOtherApps: true)
        if let webView = webView {
            webView.window?.makeFirstResponder(webView)
        }
        send("window.workIndexOpened(" + jsonString(info) + ")")
    }

    func popoverDidClose(_ notification: Notification) {
        bridge?.forgetSelection()
        send("window.workIndexClosed()")
        // Give the keyboard back to the app the person came from, unless they have already moved elsewhere
        // or the popover closed to make room for App access or System Settings.
        if giveFocusBack, NSApplication.shared.isActive, let previous = previousApp, !previous.isTerminated {
            previous.activate(options: [])
        }
        giveFocusBack = true
        monitor?.popoverChanged(open: false)
    }

    private func pageBecameReady() {
        pageReady = true
        if let call = waitingCall {
            waitingCall = nil
            send(call)
        }
    }

    private func send(_ call: String) {
        if !pageReady {
            waitingCall = call
            return
        }
        webView?.evaluateJavaScript(call, completionHandler: nil)
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Context cannot start"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        NSApplication.shared.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }
}

@main
struct WorkIndexMain {
    @MainActor
    static func main() {
        // A browser starts this executable as its local helper with the extension's address as an argument.
        // Then there is no app: no window, no menu-bar item, only messages carried to the running Context.
        if let origin = CommandLine.arguments.dropFirst().first(where: { $0.hasPrefix("chrome-extension://") }) {
            exit(runComposerHost(origin: origin))
        }
        if CommandLine.arguments.contains("--self-test-hot-key") {
            exit(runHotKeySelfTest())
        }
        if CommandLine.arguments.contains("--self-test") {
            exit(runSelfTest())
        }
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
