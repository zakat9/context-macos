// Context — Settings: one small file of settings, and the Settings window (360 × 338, the size of App access).
//
// What can be set: the Tag current item shortcut (HotKey.swift) and Insert context (Composer.swift). Both are off
// until the person sets them. The window's content is a bundled page (settings.html) whose rules are in
// core/settings.js; this file answers the page's seven requests:
//
//   state           what is set now
//   setShortcut     try a chord: macOS must take it AND it must be saved, or nothing changes
//   clearShortcut   no shortcut
//   insertEnable    "chrome", or "other" (the person picks the browser): register the local helper for that browser
//   insertDisable   remove what insertEnable registered and stop answering the extension
//   reveal          show the extension's folder in Finder
//   close
//
// The settings file is ~/WorkIndex/settings.json (private to this user). It is written only when the person changes
// a setting; until then it does not exist.

import AppKit
import WebKit

struct PairedBrowser {
    let name: String
    let bundleId: String
    /// The helper's registration file inside that browser's own folder (written by insertEnable).
    let manifest: String

    var plain: [String: Any] { return ["name": name, "bundleId": bundleId, "manifest": manifest] }
}

struct Settings {
    var tagShortcut: Chord?
    var insertOn = false
    var browsers: [PairedBrowser] = []
}

final class SettingsStore {
    let home: URL

    init(home: URL) {
        self.home = home
    }

    var fileURL: URL { return home.appendingPathComponent("settings.json") }

    /// What the file says. A missing or unreadable file, and any field that is not what it should be, reads as "not set".
    func read() -> Settings {
        var settings = Settings()
        guard let data = FileManager.default.contents(atPath: fileURL.path),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let root = parsed as? [String: Any] else { return settings }
        settings.tagShortcut = Chord(root["tagShortcut"])
        if let insert = root["insert"] as? [String: Any] {
            let listed = insert["browsers"] as? [[String: Any]] ?? []
            settings.browsers = listed.compactMap { entry -> PairedBrowser? in
                guard let name = entry["name"] as? String, let bundleId = entry["bundleId"] as? String,
                      let manifest = entry["manifest"] as? String, !bundleId.isEmpty, !manifest.isEmpty else { return nil }
                return PairedBrowser(name: name, bundleId: bundleId, manifest: manifest)
            }
            settings.insertOn = (insert["on"] as? Bool) == true && !settings.browsers.isEmpty
        }
        return settings
    }

    /// All or nothing: the file is replaced in one step, or it stays as it was.
    func write(_ settings: Settings) -> Bool {
        let insert: [String: Any] = ["on": settings.insertOn && !settings.browsers.isEmpty,
                                     "browsers": settings.browsers.map { $0.plain }]
        var root: [String: Any] = ["version": 1, "insert": insert]
        if let chord = settings.tagShortcut {
            root["tagShortcut"] = chord.plain
        } else {
            root["tagShortcut"] = NSNull()
        }
        guard JSONSerialization.isValidJSONObject(root),
              let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]) else { return false }
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try data.write(to: fileURL, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
        } catch {
            return false
        }
        return true
    }
}

/// The settings as they are in force, and the only place that changes them.
final class Preferences {
    private let store: SettingsStore
    private let hotKeys: HotKeyCenter
    private let composer: Composer
    private(set) var current: Settings

    init(store: SettingsStore, hotKeys: HotKeyCenter, composer: Composer) {
        self.store = store
        self.hotKeys = hotKeys
        self.composer = composer
        current = store.read()
    }

    /// At launch: what was set before is in force again. Nothing new is asked of macOS or of the person.
    func start() {
        hotKeys.begin(with: current.tagShortcut)
        if current.insertOn {
            composer.refresh(current.browsers)
            _ = composer.startAnswering()
        }
    }

    func state() -> [String: Any] {
        var answer: [String: Any] = ["ok": true, "insert": insertState(), "extensionFolder": composer.extensionFolder.path]
        if let chord = current.tagShortcut {
            answer["tagShortcut"] = chord.plain
        } else {
            answer["tagShortcut"] = NSNull()
        }
        return answer
    }

    private func insertState() -> [String: Any] {
        return ["on": current.insertOn, "browsers": current.browsers.map { $0.name }]
    }

    func setShortcut(_ raw: Any?) -> [String: Any] {
        guard let chord = Chord(raw) else { return ["ok": false, "reason": "bad"] }
        let before = current.tagShortcut
        let status = hotKeys.assign(chord)
        if status != 0 { return ["ok": false, "code": Int(status)] }
        var next = current
        next.tagShortcut = chord
        if !store.write(next) {
            hotKeys.restore(before)
            return ["ok": false, "reason": "not-saved"]
        }
        current = next
        return ["ok": true]
    }

    func clearShortcut() -> [String: Any] {
        var next = current
        next.tagShortcut = nil
        if !store.write(next) { return ["ok": false, "reason": "not-saved"] }
        current = next
        hotKeys.clear()
        return ["ok": true]
    }

    /// `which` is "chrome" or "other". For "other" the person is shown file panels and chooses; nothing is guessed.
    func insertEnable(_ which: String) -> [String: Any] {
        let choice: Composer.Choice
        if which == "chrome" {
            guard let found = Composer.chrome() else { return ["ok": false, "reason": "no-folder"] }
            choice = found
        } else {
            switch Composer.askForBrowser() {
            case .cancelled: return ["ok": false, "reason": "cancelled"]
            case .notABrowser: return ["ok": false, "reason": "not-a-browser"]
            case .noFolder: return ["ok": false, "reason": "no-folder"]
            case .chosen(let picked): choice = picked
            }
        }
        // In this order, so that a step that fails leaves things as they were:
        // the extension's folder, the local connection, the helper's registration, and last the settings file.
        let wasOn = current.insertOn
        guard composer.copyExtension() else { return ["ok": false, "reason": "not-saved"] }
        guard composer.startAnswering() else { return ["ok": false, "reason": "no-socket"] }
        let known = current.browsers.contains { $0.bundleId == choice.bundleId }
        guard let manifest = composer.register(in: choice.hostsFolder) else {
            if !wasOn { composer.stopAnswering() }
            return ["ok": false, "reason": "not-saved"]
        }
        var next = current
        next.browsers = next.browsers.filter { $0.bundleId != choice.bundleId }
            + [PairedBrowser(name: choice.name, bundleId: choice.bundleId, manifest: manifest)]
        next.insertOn = true
        if !store.write(next) {
            if !known { composer.unregister(manifest) }
            if !wasOn { composer.stopAnswering() }
            return ["ok": false, "reason": "not-saved"]
        }
        current = next
        return ["ok": true, "insert": insertState()]
    }

    func insertDisable() -> [String: Any] {
        composer.stopAnswering()
        for browser in current.browsers { composer.unregister(browser.manifest) }
        var next = current
        next.insertOn = false
        next.browsers = []
        if !store.write(next) { return ["ok": false, "reason": "not-saved"] }
        current = next
        return ["ok": true]
    }

    func reveal() {
        NSWorkspace.shared.activateFileViewerSelecting([composer.extensionFolder])
    }
}

func loadSettingsPage() -> String? {
    if let custom = ProcessInfo.processInfo.environment["WORKINDEX_SETTINGS_PAGE"], !custom.isEmpty,
       let text = try? String(contentsOfFile: custom, encoding: .utf8) {
        return text
    }
    if let url = Bundle.main.url(forResource: "settings", withExtension: "html"),
       let text = try? String(contentsOf: url, encoding: .utf8) {
        return text
    }
    return nil
}

final class SettingsWindow: NSObject, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 338),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let preferences: Preferences
    private var webView: WKWebView?
    private var pageReady = false
    private var waitingCalls: [String] = []

    init(page: String, preferences: Preferences) {
        self.preferences = preferences
        super.init()
        window.title = "Context Settings"
        window.isReleasedWhenClosed = false
        window.delegate = self
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "settings")
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 360, height: 338), configuration: configuration)
        view.navigationDelegate = self
        view.loadHTMLString(page, baseURL: nil)
        window.contentView = view
        window.center()
        webView = view
    }

    func show() {
        if window.isKeyWindow {
            refresh()
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func windowDidBecomeKey(_ notification: Notification) {
        if let view = webView { window.makeFirstResponder(view) }
        refresh()
    }

    private func refresh() {
        send("window.contextSettingsShown()")
    }

    private func send(_ call: String) {
        if !pageReady {
            waitingCalls.append(call)
            return
        }
        webView?.evaluateJavaScript(call, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false], nil)
            return
        }
        switch op {
        case "state":
            replyHandler(preferences.state(), nil)
        case "setShortcut":
            replyHandler(preferences.setShortcut(body["arg"]), nil)
        case "clearShortcut":
            replyHandler(preferences.clearShortcut(), nil)
        case "insertEnable":
            let which = body["arg"] as? String ?? ""
            guard which == "chrome" || which == "other" else {
                replyHandler(["ok": false], nil)
                return
            }
            replyHandler(preferences.insertEnable(which), nil)
        case "insertDisable":
            replyHandler(preferences.insertDisable(), nil)
        case "reveal":
            replyHandler(["ok": true], nil)
            preferences.reveal()
        case "close":
            replyHandler(["ok": true], nil)
            window.orderOut(nil)
        default:
            replyHandler(["ok": false], nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let calls = waitingCalls
        waitingCalls = []
        for call in calls { send(call) }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = navigationAction.request.url?.scheme ?? ""
        decisionHandler(scheme == "about" ? .allow : .cancel)
    }
}
