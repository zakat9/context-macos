// Context — what the popover may ask the Mac for.
// Every function answers with a small dictionary of plain values, which is handed to the page as it is.

import AppKit

func jsonString(_ object: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let text = String(data: data, encoding: .utf8) else {
        return "{}"
    }
    return text
}

/// The index: one file, `index.json`, in the index folder. Nothing else is ever written by this app.
final class IndexStore {
    let home: URL

    init(home: URL) {
        self.home = home
    }

    var indexURL: URL { return home.appendingPathComponent("index.json") }

    static func defaultHome() -> URL {
        if let custom = ProcessInfo.processInfo.environment["WORKINDEX_HOME"], !custom.isEmpty {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("WorkIndex", isDirectory: true)
    }

    /// Changes whenever the index file changes, so the page knows when it must read the index again.
    func stamp() -> [String: Any] {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: indexURL.path) else { return ["ok": true, "stamp": "none"] }
        let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        let file = (attributes[.systemFileNumber] as? NSNumber)?.int64Value ?? 0
        return ["ok": true, "stamp": "\(modified):\(size):\(file)"]
    }

    func read() -> [String: Any] {
        let path = indexURL.path
        if !FileManager.default.fileExists(atPath: path) { return ["ok": true, "missing": true] }
        guard let data = FileManager.default.contents(atPath: path),
              let text = String(data: data, encoding: .utf8) else { return ["ok": false] }
        return ["ok": true, "text": text]
    }

    func write(_ text: String) -> [String: Any] {
        guard let data = text.data(using: .utf8) else { return ["ok": false] }
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try data.write(to: indexURL, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: indexURL.path)
        } catch {
            return ["ok": false, "message": error.localizedDescription]
        }
        return ["ok": true]
    }

    /// The paths of the files the index points at. The page may read these, and nothing else on disk
    /// apart from the file that is selected right now.
    func indexedPaths() -> Set<String> {
        var paths = Set<String>()
        guard let data = FileManager.default.contents(atPath: indexURL.path),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let root = parsed as? [String: Any],
              let objects = root["objects"] as? [String: Any] else { return paths }
        for value in objects.values {
            guard let entry = value as? [String: Any],
                  let locator = entry["locator"] as? [String: Any],
                  let kind = locator["type"] as? String, kind == "file",
                  let path = locator["value"] as? String else { continue }
            paths.insert(path)
        }
        return paths
    }
}

/// One saved file as it is on disk now: its resolved path, its bytes (base64) and its file date.
/// Folders, and documents saved as folders, are not files.
func readFile(_ path: String) -> [String: Any] {
    let expanded = (path as NSString).expandingTildeInPath
    guard let resolved = realpath(expanded, nil) else {
        let code = errno
        if code == ENOENT || code == ENOTDIR { return ["ok": false, "reason": "missing"] }
        if code == EACCES || code == EPERM { return ["ok": false, "reason": "denied"] }
        if code == ELOOP { return ["ok": false, "reason": "link"] }
        return ["ok": false, "reason": "error", "detail": String(code)]
    }
    let real = String(cString: resolved)
    free(resolved)
    var isDirectory: ObjCBool = false
    if !FileManager.default.fileExists(atPath: real, isDirectory: &isDirectory) { return ["ok": false, "reason": "missing"] }
    if isDirectory.boolValue { return ["ok": false, "reason": "folder"] }
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: real) else { return ["ok": false, "reason": "denied"] }
    let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
    let milliseconds = (modified * 1000).rounded(.down)
    if size > 40 * 1024 * 1024 {
        return ["ok": true, "realPath": real, "mtimeMs": milliseconds, "size": size]
    }
    guard let data = FileManager.default.contents(atPath: real) else {
        return ["ok": false, "reason": FileManager.default.isReadableFile(atPath: real) ? "error" : "denied"]
    }
    return ["ok": true, "realPath": real, "base64": data.base64EncodedString(), "mtimeMs": milliseconds, "size": size]
}

/// Puts text on the clipboard. Called only when the person presses Copy in the popover. Never reads the clipboard.
func copyText(_ text: String) -> [String: Any] {
    let board = NSPasteboard.general
    board.clearContents()
    let done = board.setString(text, forType: .string)
    return ["ok": done]
}

/// Runs one of the read-only scripts in Scripts.swift. macOS asks the person once per app before the first
/// one may run (System Settings › Privacy & Security › Automation).
final class ScriptRunner {
    private var compiled: [String: NSAppleScript] = [:]

    func run(_ source: String) -> [String: Any] {
        let script: NSAppleScript
        if let known = compiled[source] {
            script = known
        } else {
            guard let made = NSAppleScript(source: source) else { return ["ok": false, "code": 0, "message": "The script could not be prepared."] }
            if compiled.count < 32 { compiled[source] = made }
            script = made
        }
        var errorInfo: NSDictionary? = nil
        let result = script.executeAndReturnError(&errorInfo)
        if let info = errorInfo {
            let code = (info[NSAppleScript.errorNumber] as? NSNumber)?.intValue ?? 0
            let message = (info[NSAppleScript.errorMessage] as? String) ?? ""
            return ["ok": false, "code": code, "message": message]
        }
        return ["ok": true, "reply": result.stringValue ?? ""]
    }

    /// The one selected object (or open saved document) of an app the popover follows. Any other app: nothing is asked.
    func selection(bundleId: String) -> [String: Any] {
        guard let source = Scripts.selection[bundleId] else { return ["ok": false, "code": 0, "message": "not followed"] }
        return run(source)
    }

    func readNote(id: String) -> [String: Any] {
        guard id.range(of: "^x-coredata://[A-Za-z0-9/-]+$", options: .regularExpression) != nil else { return ["ok": false, "code": 0, "message": "bad id"] }
        return run(Scripts.readNote.replacingOccurrences(of: "__ID__", with: id))
    }

    func readMail(account: String, mailbox: String, numericId: String) -> [String: Any] {
        let digits = CharacterSet(charactersIn: "0123456789")
        guard !account.isEmpty, !mailbox.isEmpty, !numericId.isEmpty,
              numericId.unicodeScalars.allSatisfy({ digits.contains($0) }) else { return ["ok": false, "code": 0, "message": "bad id"] }
        let source = Scripts.readMail
            .replacingOccurrences(of: "__MAILBOX__", with: ScriptRunner.quoted(mailbox))
            .replacingOccurrences(of: "__ACCOUNT__", with: ScriptRunner.quoted(account))
            .replacingOccurrences(of: "__NUMID__", with: numericId)
        return run(source)
    }

    /// Text made safe to sit between double quotes in AppleScript.
    static func quoted(_ text: String) -> String {
        return text.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
    }
}

/// The popover page: inside the app bundle, or wherever WORKINDEX_PAGE points (used before bundling).
func loadPopoverPage() -> String? {
    if let custom = ProcessInfo.processInfo.environment["WORKINDEX_PAGE"], !custom.isEmpty,
       let text = try? String(contentsOfFile: custom, encoding: .utf8) {
        return text
    }
    if let url = Bundle.main.url(forResource: "popover", withExtension: "html"),
       let text = try? String(contentsOf: url, encoding: .utf8) {
        return text
    }
    return nil
}
