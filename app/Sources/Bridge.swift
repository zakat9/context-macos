// Context — the bridge between the popover page and the Mac.
// The page can only name one of the requests below. It cannot hand over a script, cannot read a file that is
// neither indexed nor the current selection, and cannot open any address: every navigation is refused.

import AppKit
import WebKit

final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private let store: IndexStore
    private let scripts: ScriptRunner
    private var selectedPath: String = ""
    var onClose: (() -> Void)?
    var onQuit: (() -> Void)?
    var onReady: (() -> Void)?
    /// The page wrote the index (a tag was added or removed): the menu-bar label follows.
    var onSaved: (() -> Void)?
    /// The page asks for the App access window (with the app it is about, or "") or for System Settings.
    var onAccess: ((String) -> Void)?
    var onSettings: (() -> Void)?
    /// The page asks for Context's own Settings window (shortcuts, Insert context).
    var onPreferences: (() -> Void)?
    /// The page's own height changed: the popover follows it (the width never changes). Answers the height that was
    /// applied and the room there is, so the page can give its list a scroll bar when there is less room than content.
    var onSize: ((Double) -> [String: Any])?

    init(store: IndexStore, scripts: ScriptRunner) {
        self.store = store
        self.scripts = scripts
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false], nil)
            return
        }
        let text = body["arg"] as? String ?? ""
        let fields = body["arg"] as? [String: Any] ?? [:]
        switch op {
        case "selection":
            let answer = scripts.selection(bundleId: text)
            rememberSelectedPath(answer)
            replyHandler(answer, nil)
        case "readNote":
            replyHandler(scripts.readNote(id: text), nil)
        case "readMail":
            replyHandler(scripts.readMail(account: fields["account"] as? String ?? "",
                                          mailbox: fields["mailbox"] as? String ?? "",
                                          numericId: fields["numericId"] as? String ?? ""), nil)
        case "readFile":
            if text == selectedPath || store.indexedPaths().contains(text) {
                replyHandler(readFile(text), nil)
            } else {
                replyHandler(["ok": false, "reason": "denied"] as [String: Any], nil)
            }
        case "readIndex":
            replyHandler(store.read(), nil)
        case "indexStamp":
            replyHandler(store.stamp(), nil)
        case "writeIndex":
            let written = store.write(text)
            replyHandler(written, nil)
            if (written["ok"] as? Bool) == true { onSaved?() }
        case "copyText":
            replyHandler(copyText(text), nil)
        case "close":
            replyHandler(["ok": true], nil)
            onClose?()
        case "quit":
            replyHandler(["ok": true], nil)
            onQuit?()
        case "access":
            replyHandler(["ok": true], nil)
            onAccess?(text)
        case "settings":
            replyHandler(["ok": true], nil)
            onSettings?()
        case "preferences":
            replyHandler(["ok": true], nil)
            onPreferences?()
        case "size":
            let height = (fields["height"] as? NSNumber)?.doubleValue ?? 0
            replyHandler(onSize?(height) ?? ["ok": false], nil)
        default:
            replyHandler(["ok": false], nil)
        }
    }

    /// When the selection is a saved file, its path is the one un-indexed file the page may read.
    private func rememberSelectedPath(_ answer: [String: Any]) {
        selectedPath = ""
        guard let reply = answer["reply"] as? String else { return }
        let parts = reply.trimmingCharacters(in: .newlines).components(separatedBy: "\u{1F}")
        if parts.count >= 2, parts[0] == "path" {
            selectedPath = parts[1]
        }
    }

    /// The Tag current item shortcut asked the app in front before the popover opened: the page is handed that
    /// answer, and the file it names (if it names one) is the one un-indexed file the page may read.
    func noteSelection(_ answer: [String: Any]) {
        rememberSelectedPath(answer)
    }

    func forgetSelection() {
        selectedPath = ""
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onReady?()
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = navigationAction.request.url?.scheme ?? ""
        decisionHandler(scheme == "about" ? .allow : .cancel)
    }
}
