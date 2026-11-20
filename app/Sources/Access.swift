// contexta — the App access window: which apps macOS lets contexta ask, and one button to request several.
// The window is the size it was in 0.10.3 (360 × 338). Its content is a bundled page (access.html) whose rules are in
// core/access.js; this file answers the page's five requests. The page can only name an app contexta follows.
//
//   apps      what is installed and what is open. Nothing is opened, nothing is asked.
//   check     what macOS has already decided for one open app. Never shows a prompt.
//   request   for ONE app: open it in the background if it is closed, then let macOS ask. macOS shows its own
//             prompt, at most one, and this waits for the person's answer. contexta cannot answer or skip it.
//   settings  open System Settings at Privacy & Security › Automation.
//   show / close

import AppKit
import ApplicationServices
import WebKit

func loadAccessPage() -> String? {
    if let custom = ProcessInfo.processInfo.environment["WORKINDEX_ACCESS_PAGE"], !custom.isEmpty,
       let text = try? String(contentsOfFile: custom, encoding: .utf8) {
        return text
    }
    if let url = Bundle.main.url(forResource: "access", withExtension: "html"),
       let text = try? String(contentsOf: url, encoding: .utf8) {
        return text
    }
    return nil
}

final class AccessWindow: NSObject, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 338),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let ids = Scripts.selection.keys.sorted()
    private var webView: WKWebView?
    private var pageReady = false
    private var waitingCalls: [String] = []
    private var focusNext = ""
    /// Called after a request was answered: what is allowed may have changed.
    var onChanged: (() -> Void)?

    init(page: String) {
        super.init()
        window.title = "contexta"
        window.isReleasedWhenClosed = false
        window.delegate = self
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "access")
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 360, height: 338), configuration: configuration)
        view.navigationDelegate = self
        view.loadHTMLString(page, baseURL: nil)
        window.contentView = view
        window.center()
        webView = view
    }

    /// Bring the window forward. `focus` is the app whose row should be reached first (or "").
    func show(focus: String) {
        focusNext = focus
        if window.isKeyWindow {
            refresh()
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    /// At launch the page decides whether the window is needed, and asks to be shown if it is.
    func launch(hasIndex: Bool) {
        send("window.contextAccessLaunch(" + (hasIndex ? "true" : "false") + ")")
    }

    func windowDidBecomeKey(_ notification: Notification) {
        // Also after coming back from System Settings: every status is looked at again.
        refresh()
    }

    private func refresh() {
        send("window.contextAccessShown(" + jsonString(["focus": focusNext]) + ")")
        focusNext = ""
    }

    private func send(_ call: String) {
        if !pageReady {
            waitingCalls.append(call)
            return
        }
        webView?.evaluateJavaScript(call, completionHandler: nil)
    }

    // MARK: what macOS knows

    static func permission(_ bundleId: String, ask: Bool) -> Int {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
        return Int(AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask))
    }

    static func isRunning(_ bundleId: String) -> Bool {
        return !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty
    }

    static func openSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
    }

    private func apps() -> [[String: Any]] {
        return ids.map { id -> [String: Any] in
            let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
            var name = Scripts.names[id] ?? id
            if let found = url {
                name = FileManager.default.displayName(atPath: found.path).replacingOccurrences(of: ".app", with: "")
            }
            return ["id": id, "name": name, "installed": url != nil, "running": AccessWindow.isRunning(id)]
        }
    }

    private func request(_ bundleId: String, done: @escaping (Int) -> Void) {
        func letMacAsk() {
            DispatchQueue.global(qos: .userInitiated).async {
                let known = AccessWindow.permission(bundleId, ask: false)
                // Only when macOS has not decided yet does the second call let macOS show its prompt.
                let result = known == -1744 ? AccessWindow.permission(bundleId, ask: true) : known
                DispatchQueue.main.async { done(result) }
            }
        }
        if AccessWindow.isRunning(bundleId) {
            letMacAsk()
            return
        }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            done(-10814)
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            DispatchQueue.main.async {
                if app != nil && error == nil { letMacAsk() } else { done(-600) }
            }
        }
    }

    // MARK: the page's requests

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false], nil)
            return
        }
        let bundleId = body["arg"] as? String ?? ""
        switch op {
        case "apps":
            replyHandler(["ok": true, "apps": apps()] as [String: Any], nil)
        case "check":
            guard ids.contains(bundleId), AccessWindow.isRunning(bundleId) else {
                replyHandler(["ok": false], nil)
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                let code = AccessWindow.permission(bundleId, ask: false)
                DispatchQueue.main.async { replyHandler(["ok": true, "code": code] as [String: Any], nil) }
            }
        case "request":
            guard ids.contains(bundleId) else {
                replyHandler(["ok": false], nil)
                return
            }
            request(bundleId) { [weak self] code in
                replyHandler(["ok": true, "code": code] as [String: Any], nil)
                self?.onChanged?()
            }
        case "settings":
            replyHandler(["ok": true], nil)
            AccessWindow.openSettings()
        case "show":
            replyHandler(["ok": true], nil)
            show(focus: "")
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
