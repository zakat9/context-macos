// Context — Insert context, the app's side.
//
// When the person has switched Insert context on (Settings), the app answers its own browser extension:
// which tags there are, which sources a tag has, and the text of the sources the person ticked. The rules are in
// core/insert.js and run here in JavaScriptCore; this file gives them five read-only functions and a local socket.
//
// What this side may do, and nothing more:
//   · read Context's own index file, and the saved files the index points at;
//   · read a tagged note or message, but only when Notes or Mail is ALREADY open and ALREADY allowed (looked up
//     without a prompt). Otherwise that source is "not available now". No app is opened, no prompt can appear;
//   · answer on a socket file in ~/WorkIndex/composer, and only to this same executable started as the helper
//     (ComposerHost.swift), whose first message names the Context extension.
// It writes nothing except, when the person sets Insert context up: the extension's folder (a copy, so the browser's
// "Load unpacked" can reach it) and one small registration file in the folder of the browser they chose.
// It never touches the clipboard, the index, a source, or the browser.
//
// NOT VERIFIED ON A MAC IN THIS BUILD'S TESTS (read and checked as text only). core/insert.js itself is tested, and
// was used in a real browser through a stand-in for this file: see tests/composer/run.js and LIVE-CHECKS.md part G.

import AppKit
import ApplicationServices
import JavaScriptCore
import UniformTypeIdentifiers

/// core/rules.js + core/read.js + core/insert.js: inside the app bundle, or wherever WORKINDEX_INSERT points.
func loadInsertRules() -> String? {
    if let custom = ProcessInfo.processInfo.environment["WORKINDEX_INSERT"], !custom.isEmpty,
       let text = try? String(contentsOfFile: custom, encoding: .utf8) {
        return text
    }
    if let url = Bundle.main.url(forResource: "insert", withExtension: "js"),
       let text = try? String(contentsOf: url, encoding: .utf8) {
        return text
    }
    return nil
}

/// The Insert context rules. One request in, one answer out, both as JSON text. Used on the main thread only.
final class InsertEngine {
    private let context: JSContext
    private let handle: JSValue

    init?(source: String, store: IndexStore, scripts: ScriptRunner) {
        guard let context = JSContext(), let native = JSValue(newObjectIn: context) else { return nil }
        func give(_ name: String, _ block: @escaping @convention(block) (String) -> String) {
            native.setObject(unsafeBitCast(block, to: AnyObject.self), forKeyedSubscript: name as NSString)
        }
        give("readIndex") { _ in
            return jsonString(store.read())
        }
        give("readFile") { text in
            // Only a file the index points at. The extension cannot name any other path.
            let path = InsertEngine.fields(text)["path"] as? String ?? ""
            guard store.indexedPaths().contains(path) else { return jsonString(["ok": false, "reason": "denied"]) }
            return jsonString(readFile(path))
        }
        give("readNote") { text in
            if let refusal = InsertEngine.refusal("com.apple.Notes", "Notes") { return refusal }
            return jsonString(scripts.readNote(id: InsertEngine.fields(text)["id"] as? String ?? ""))
        }
        give("readMail") { text in
            if let refusal = InsertEngine.refusal("com.apple.mail", "Mail") { return refusal }
            let fields = InsertEngine.fields(text)
            return jsonString(scripts.readMail(account: fields["account"] as? String ?? "",
                                               mailbox: fields["mailbox"] as? String ?? "",
                                               numericId: fields["numericId"] as? String ?? ""))
        }
        give("decodeText") { text in
            // Text of a saved message in an older charset (the bytes arrive one character per byte).
            let fields = InsertEngine.fields(text)
            guard let bytes = fields["bytes"] as? String, let charset = fields["charset"] as? String else { return "{\"ok\":false}" }
            let encoding = CFStringConvertIANACharSetNameToEncoding(charset as CFString)
            guard encoding != kCFStringEncodingInvalidId else { return "{\"ok\":false}" }
            let data = Data(bytes.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) })
            let known = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(encoding))
            guard let decoded = String(data: data, encoding: known) else { return "{\"ok\":false}" }
            return jsonString(["ok": true, "text": decoded])
        }
        context.setObject(native, forKeyedSubscript: "contextInsertNative" as NSString)
        _ = context.evaluateScript(source)
        guard let rules = context.objectForKeyedSubscript("ContextInsert"), !rules.isUndefined,
              let handle = rules.objectForKeyedSubscript("handleJson"), !handle.isUndefined else { return nil }
        self.context = context
        self.handle = handle
    }

    func answer(_ request: String) -> String {
        return handle.call(withArguments: [request])?.toString() ?? "{\"ok\":false}"
    }

    private static func fields(_ text: String) -> [String: Any] {
        guard let data = text.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return [:] }
        return parsed as? [String: Any] ?? [:]
    }

    /// A note or a message is read only when its app is already open and already allowed. Otherwise the app is not
    /// touched: nothing is opened, and macOS is given no reason to show a prompt.
    private static func refusal(_ bundleId: String, _ name: String) -> String? {
        guard AccessWindow.isRunning(bundleId) else {
            return jsonString(["ok": false, "reason": name + " is closed: open it to include this"])
        }
        let permission = AccessWindow.permission(bundleId, ask: false)
        if permission == 0 { return nil }
        return jsonString(["ok": false, "code": permission, "reason": "Context is not allowed to ask " + name + " (App access)"])
    }
}

final class Composer {
    struct Choice {
        let name: String
        let bundleId: String
        /// That browser's folder for local helpers ("NativeMessagingHosts").
        let hostsFolder: URL
    }

    enum Picked {
        case chosen(Choice)
        case cancelled
        case notABrowser
        case noFolder
    }

    /// ~/WorkIndex/composer: the socket file and the extension's folder. Only this user can open it.
    let directory: URL
    private let engine: InsertEngine?
    private let queue = DispatchQueue(label: "local.workindex.composer")
    private let lock = NSLock()
    private var listening: Int32 = -1
    private var source: DispatchSourceRead?
    private var open = Set<Int32>()

    init(home: URL, engine: InsertEngine?) {
        directory = home.appendingPathComponent("composer", isDirectory: true)
        self.engine = engine
    }

    var extensionFolder: URL { return directory.appendingPathComponent("extension", isDirectory: true) }
    private var socketPath: String { return directory.appendingPathComponent("bridge.sock").path }
    var isAnswering: Bool { return listening >= 0 }

    // MARK: setting up (only ever from the Settings window)

    /// Where the Chromium-family browsers Context knows keep their data, under ~/Library/Application Support.
    private static let dataFolders: [String: String] = [
        "com.google.Chrome": "Google/Chrome",
        "org.chromium.Chromium": "Chromium",
        "com.microsoft.edgemac": "Microsoft Edge",
        "com.brave.Browser": "BraveSoftware/Brave-Browser"
    ]

    /// The helpers' folder of a browser whose data folder exists (so: installed, and started at least once).
    private static func hostsFolder(inDataFolder relative: String) -> URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let data = support.appendingPathComponent(relative, isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: data.path, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
        return data.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
    }

    static func chrome() -> Choice? {
        guard let folder = hostsFolder(inDataFolder: "Google/Chrome") else { return nil }
        return Choice(name: "Google Chrome", bundleId: "com.google.Chrome", hostsFolder: folder)
    }

    /// "Other…": the person chooses the browser, and, for a browser Context does not know, its data folder.
    static func askForBrowser() -> Picked {
        let panel = NSOpenPanel()
        panel.title = "Choose the browser"
        panel.message = "Choose the Chromium-family browser in which you will load the Context extension."
        panel.prompt = "Choose"
        panel.allowedContentTypes = [.applicationBundle]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.directoryURL = URL(fileURLWithPath: "/Applications", isDirectory: true)
        guard panel.runModal() == .OK, let url = panel.url else { return .cancelled }
        guard let bundleId = Bundle(url: url)?.bundleIdentifier, !bundleId.isEmpty else { return .notABrowser }
        let name = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
        if let relative = dataFolders[bundleId] {
            guard let folder = hostsFolder(inDataFolder: relative) else { return .noFolder }
            return .chosen(Choice(name: name, bundleId: bundleId, hostsFolder: folder))
        }
        let folderPanel = NSOpenPanel()
        folderPanel.title = "Choose the browser's data folder"
        folderPanel.message = "Context does not know where " + name + " keeps its data. Choose that folder: the browser shows it at chrome://version as “Profile Path”, without the last part."
        folderPanel.prompt = "Choose"
        folderPanel.canChooseFiles = false
        folderPanel.canChooseDirectories = true
        folderPanel.allowsMultipleSelection = false
        folderPanel.directoryURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard folderPanel.runModal() == .OK, let data = folderPanel.url else { return .cancelled }
        let folder = data.lastPathComponent == "NativeMessagingHosts" ? data : data.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
        return .chosen(Choice(name: name, bundleId: bundleId, hostsFolder: folder))
    }

    private static func bundledExtension() -> URL? {
        if let custom = ProcessInfo.processInfo.environment["WORKINDEX_EXTENSION"], !custom.isEmpty {
            return URL(fileURLWithPath: custom, isDirectory: true)
        }
        return Bundle.main.resourceURL?.appendingPathComponent("composer-extension", isDirectory: true)
    }

    /// A copy of the extension where the browser's "Load unpacked" can reach it (it cannot look inside an app).
    func copyExtension() -> Bool {
        guard let from = Composer.bundledExtension() else { return false }
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try manager.createDirectory(at: extensionFolder, withIntermediateDirectories: true, attributes: nil)
            for name in try manager.contentsOfDirectory(atPath: from.path) {
                let target = extensionFolder.appendingPathComponent(name)
                if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
                try manager.copyItem(at: from.appendingPathComponent(name), to: target)
            }
        } catch {
            return false
        }
        return true
    }

    /// What tells a browser that the Context extension, and no other, may start this executable as its helper.
    static func registration(executable: String) -> Data? {
        let manifest: [String: Any] = ["name": Scripts.composerHostName,
                                       "description": "Context: gives the Context extension the tagged sources you choose",
                                       "path": executable,
                                       "type": "stdio",
                                       "allowed_origins": ["chrome-extension://" + Scripts.composerExtensionId + "/"]]
        return try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    }

    /// Writes the registration file into a browser's helpers folder. Answers its path, or nil.
    func register(in hostsFolder: URL) -> String? {
        guard let executable = Bundle.main.executablePath, let data = Composer.registration(executable: executable) else { return nil }
        let file = hostsFolder.appendingPathComponent(Scripts.composerHostName + ".json")
        do {
            try FileManager.default.createDirectory(at: hostsFolder, withIntermediateDirectories: true, attributes: nil)
            try data.write(to: file, options: .atomic)
        } catch {
            return nil
        }
        return file.path
    }

    /// Removes a registration file this app wrote. Any other file is left alone.
    func unregister(_ path: String) {
        guard (path as NSString).lastPathComponent == Scripts.composerHostName + ".json" else { return }
        try? FileManager.default.removeItem(atPath: path)
    }

    /// At launch, when Insert context is on: the app may have been moved or rebuilt since it was set up, so the
    /// extension's copy and the registrations are written again. Nothing new is registered.
    func refresh(_ browsers: [PairedBrowser]) {
        _ = copyExtension()
        for browser in browsers {
            let folder = URL(fileURLWithPath: browser.manifest).deletingLastPathComponent()
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue {
                _ = register(in: folder)
            }
        }
    }

    // MARK: answering

    func startAnswering() -> Bool {
        if listening >= 0 { return true }
        guard engine != nil else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch {
            return false
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let path = socketPath
        guard var address = unixAddress(path) else { return false }
        unlink(path)                                    // left by an earlier run; there is only ever one Context
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(fd, 4) == 0, fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else {
            close(fd)
            unlink(path)
            return false
        }
        listening = fd
        let waiting = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        waiting.setEventHandler { [weak self] in self?.accepted(on: fd) }
        waiting.setCancelHandler { close(fd) }
        waiting.resume()
        source = waiting
        return true
    }

    func stopAnswering() {
        guard listening >= 0 else { return }
        listening = -1
        source?.cancel()                                // closes the listening socket
        source = nil
        unlink(socketPath)
        lock.lock()
        for fd in open { shutdown(fd, SHUT_RDWR) }      // each connection's own thread then closes it
        lock.unlock()
    }

    private func accepted(on listener: Int32) {
        let fd = accept(listener, nil, nil)
        guard fd >= 0 else { return }
        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        lock.lock()
        let room = open.count < 4
        if room { open.insert(fd) }
        lock.unlock()
        guard room else {
            close(fd)
            return
        }
        guard peerIsThisExecutable(fd) else {
            finished(fd)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.serve(fd)
            if let composer = self {
                composer.finished(fd)
            } else {
                close(fd)
            }
        }
    }

    /// Forgotten and closed in one step, so that stopAnswering never touches a socket that is already closed.
    private func finished(_ fd: Int32) {
        lock.lock()
        open.remove(fd)
        close(fd)
        lock.unlock()
    }

    /// One picker's conversation: the helper's hello, then requests and answers until the picker closes.
    private func serve(_ fd: Int32) {
        guard let engine = engine,
              let hello = readFrame(fd, limit: 4_096),
              let parsed = try? JSONSerialization.jsonObject(with: hello, options: []),
              let fields = parsed as? [String: Any],
              (fields["hello"] as? String) == "context-composer-host",
              (fields["origin"] as? String) == "chrome-extension://" + Scripts.composerExtensionId + "/" else { return }
        while let request = readFrame(fd, limit: composerRequestLimit) {
            guard let text = String(data: request, encoding: .utf8) else { return }
            var reply = "{\"ok\":false}"
            DispatchQueue.main.sync { reply = engine.answer(text) }
            var body = Data(reply.utf8)
            if body.count > composerReplyLimit {
                var refusal: [String: Any] = ["ok": false, "reason": "too-large",
                                              "message": "These sources are too long to hand over in one piece. Untick some of them."]
                if let asked = try? JSONSerialization.jsonObject(with: request, options: []),
                   let askedFields = asked as? [String: Any], let id = askedFields["id"] as? NSNumber {
                    refusal["id"] = id
                }
                body = Data(jsonString(refusal).utf8)
            }
            if !writeFrame(fd, body) { return }
        }
    }
}
