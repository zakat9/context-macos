// contexta — the menu-bar item's label while the popover is closed.
// It shows the tags (0 to 2) of the one whole object selected in the app in front. The rules are in core/status.js;
// this file carries events to them and carries out the few commands they give back.
//
// What this file may do, and nothing more:
//   · learn from the system that another app came to the front, that the Mac slept or woke;
//   · run ONE timer;
//   · ask the app in front the same read-only "which one object is selected" question the popover asks (giving up
//     after 1 second), and only after seeing, each time, that the app is running, is in front, and has ALREADY been
//     allowed in macOS. The question runs on the main thread, as AppleScript must: while it runs, nothing else here does;
//   · read contexta's own index file;
//   · say when an app contexta follows comes to the front or leaves it ("scope"), which is when the Tag current item
//     shortcut, if the person has set one, is registered with macOS or given up.
// It never lets macOS show a permission prompt (the permission is looked up with askUserIfNeeded = false), never
// opens an app, never takes the keyboard, and listens to no keys and no pointer.

import AppKit
import ApplicationServices
import JavaScriptCore

/// core/rules.js + core/status.js, run in JavaScriptCore. Events go in and commands come out as JSON text.
final class StatusEngine {
    private let context: JSContext
    private let stepFunction: JSValue

    init?(source: String) {
        guard let context = JSContext() else { return nil }
        _ = context.evaluateScript(source)
        guard let rules = context.objectForKeyedSubscript("ContextStatus"), !rules.isUndefined,
              let step = rules.objectForKeyedSubscript("stepJson"), !step.isUndefined else { return nil }
        self.context = context
        self.stepFunction = step
    }

    func step(_ event: [String: Any]) -> [[String: Any]] {
        guard let result = stepFunction.call(withArguments: [jsonString(event)]),
              let text = result.toString(),
              let data = text.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let commands = parsed as? [[String: Any]] else { return [] }
        return commands
    }
}

/// The label's rules: inside the app bundle, or wherever WORKINDEX_STATUS points (used before bundling).
func loadStatusRules() -> String? {
    if let custom = ProcessInfo.processInfo.environment["WORKINDEX_STATUS"], !custom.isEmpty,
       let text = try? String(contentsOfFile: custom, encoding: .utf8) {
        return text
    }
    if let url = Bundle.main.url(forResource: "status", withExtension: "js"),
       let text = try? String(contentsOf: url, encoding: .utf8) {
        return text
    }
    return nil
}

final class StatusMonitor: NSObject {
    private let engine: StatusEngine
    private let scripts: ScriptRunner
    private let store: IndexStore
    private var timer: Timer?
    private var popoverOpen = false
    var onShow: (([String: Any]) -> Void)?
    /// An app contexta follows came to the front (true) or left it (false): the Tag current item shortcut is
    /// registered with macOS only in between.
    var onScope: ((Bool) -> Void)?

    init(engine: StatusEngine, scripts: ScriptRunner, store: IndexStore) {
        self.engine = engine
        self.scripts = scripts
        self.store = store
        super.init()
    }

    func start() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(appActivated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        center.addObserver(self, selector: #selector(rest(_:)), name: NSWorkspace.willSleepNotification, object: nil)
        center.addObserver(self, selector: #selector(rest(_:)), name: NSWorkspace.screensDidSleepNotification, object: nil)
        center.addObserver(self, selector: #selector(rest(_:)), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(wake(_:)), name: NSWorkspace.didWakeNotification, object: nil)
        center.addObserver(self, selector: #selector(wake(_:)), name: NSWorkspace.screensDidWakeNotification, object: nil)
        center.addObserver(self, selector: #selector(wake(_:)), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        frontChanged()
    }

    // MARK: events in

    @objc private func appActivated(_ notification: Notification) { frontChanged() }
    @objc private func rest(_ notification: Notification) { feed(["type": "pause"]) }
    @objc private func wake(_ notification: Notification) {
        feed(["type": "resume"])
        frontChanged()
    }

    func frontChanged() {
        guard let front = NSWorkspace.shared.frontmostApplication else { return }
        let own = front.bundleIdentifier == Bundle.main.bundleIdentifier
        feed(["type": "app", "bundleId": front.bundleIdentifier ?? "", "name": front.localizedName ?? "",
              "pid": Int(front.processIdentifier), "own": own, "popover": popoverOpen])
    }

    func popoverChanged(open: Bool) {
        popoverOpen = open
        feed(["type": "popover", "open": open])
        if !open {
            // Normally the system reports the app that comes back to the front. This is for the rare time it does not.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.frontChanged() }
        }
    }

    /// The popover wrote the index: the label follows at once.
    func indexSaved() { feed(["type": "saved"]) }

    /// The App access window finished asking: what is allowed may have changed.
    func accessChanged() { feed(["type": "access"]) }

    private func feed(_ event: [String: Any]) {
        var e = event
        e["now"] = Int(ProcessInfo.processInfo.systemUptime * 1000)
        if (e["type"] as? String) != "index" {
            e["stamp"] = (store.stamp()["stamp"] as? String) ?? "none"
        }
        for command in engine.step(e) { carryOut(command) }
    }

    // MARK: commands out

    private func carryOut(_ command: [String: Any]) {
        switch command["do"] as? String ?? "" {
        case "show":
            onShow?(command)
        case "wait":
            let milliseconds = (command["ms"] as? NSNumber)?.doubleValue ?? 1000
            timer?.invalidate()
            let next = Timer(timeInterval: max(0, milliseconds / 1000), repeats: false) { [weak self] _ in
                self?.feed(["type": "tick"])
            }
            next.tolerance = min(0.2, milliseconds / 10000)
            RunLoop.main.add(next, forMode: .common)
            timer = next
        case "idle":
            timer?.invalidate()
            timer = nil
        case "scope":
            onScope?((command["on"] as? Bool) == true)
        case "index":
            let stamp = (store.stamp()["stamp"] as? String) ?? "none"
            let onDisk = store.read()
            var event: [String: Any] = ["type": "index", "stamp": stamp]
            if (onDisk["ok"] as? Bool) != true {
                event["failed"] = true
            } else if (onDisk["missing"] as? Bool) == true {
                event["missing"] = true
            } else {
                event["text"] = onDisk["text"] as? String ?? ""
            }
            let indexEvent = event
            DispatchQueue.main.async { [weak self] in self?.feed(indexEvent) }
        case "ask":
            ask(command)
        default:
            break
        }
    }

    private static func inFront(_ bundleId: String, _ pid: Int) -> Bool {
        guard let front = NSWorkspace.shared.frontmostApplication, !front.isTerminated else { return false }
        return front.bundleIdentifier == bundleId && (pid == 0 || Int(front.processIdentifier) == pid)
    }

    /// One question to the app in front. Three things are seen first, every time: the app is running and in front;
    /// macOS has already allowed it (looked up without a prompt); and, just before asking, it is still in front.
    /// If any of them is not so, the app is not touched.
    private func ask(_ command: [String: Any]) {
        let seq = (command["seq"] as? NSNumber)?.intValue ?? 0
        let bundleId = command["bundleId"] as? String ?? ""
        let pid = (command["pid"] as? NSNumber)?.intValue ?? 0
        let answer: [String: Any] = ["type": "answer", "seq": seq, "bundleId": bundleId, "pid": pid]
        guard let source = Scripts.watch[bundleId], StatusMonitor.inFront(bundleId, pid) else {
            var skipped = answer
            skipped["skipped"] = true
            skipped["perm"] = 0
            let notAsked = skipped
            DispatchQueue.main.async { [weak self] in self?.feed(notAsked) }
            return
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
            let permission = Int(AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false))
            DispatchQueue.main.async {
                guard let monitor = self else { return }
                var filled = answer
                filled["perm"] = permission
                if permission == 0 {
                    if StatusMonitor.inFront(bundleId, pid) {
                        for (key, value) in monitor.scripts.run(source) { filled[key] = value }
                        StatusMonitor.addFileIdentity(&filled)
                    } else {
                        filled["skipped"] = true
                    }
                    // The question can take up to a second. If another app came to the front meanwhile,
                    // the answer is about an app that is no longer in front: it is not passed on.
                    if !StatusMonitor.inFront(bundleId, pid) {
                        filled = answer
                        filled["perm"] = 0
                        filled["skipped"] = true
                    }
                }
                monitor.feed(filled)
            }
        }
    }

    /// For a saved file the rules need its resolved path, and for a saved mail message (.eml) its Message-ID,
    /// which is in the first lines of the file. Nothing else of any file is read here.
    private static func addFileIdentity(_ answer: inout [String: Any]) {
        guard let reply = answer["reply"] as? String else { return }
        let parts = reply.trimmingCharacters(in: .newlines).components(separatedBy: "\u{1F}")
        guard parts.count >= 2, parts[0] == "path", !parts[1].contains("://") else { return }
        let expanded = (parts[1] as NSString).expandingTildeInPath
        guard let resolved = realpath(expanded, nil) else { return }
        let real = String(cString: resolved)
        free(resolved)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: real, isDirectory: &isDirectory), !isDirectory.boolValue else { return }
        answer["realPath"] = real
        if real.lowercased().hasSuffix(".eml"), !isOnlineOnly(real), let handle = FileHandle(forReadingAtPath: real) {
            let head = handle.readData(ofLength: 16384)
            handle.closeFile()
            answer["emlHead"] = String(data: head, encoding: .isoLatin1) ?? ""
        }
    }
}
