// Context — Insert context: the local helper, and the plumbing it shares with the app.
//
// The browser starts this same executable with "chrome-extension://…/" as an argument when the Context extension
// opens its picker (that is how browsers start a "native messaging host"). Started like that, the executable shows
// no window and no menu-bar item, and makes no AppKit call: it only carries messages.
//
//   browser ⇄ helper     standard input and output; each message is 4 bytes of length (low byte first), then JSON
//   helper  ⇄ the app    a socket file in ~/WorkIndex/composer (a folder only this user can open); same framing
//
// The helper passes a request on only when all of this is so, and otherwise answers every request with the reason:
//   forbidden     the argument is not the Context extension's own address
//   off           Insert context is not switched on in Settings
//   not-paired    the program that started the helper is not a browser Insert context was set up for
//   not-running   the Context app is not running (the helper never starts it), or what answers on the socket is not
//                 this same executable
//
// There is no network in any of this: no port is opened and nothing listens beyond this user's own files.
//
// NOT VERIFIED ON A MAC IN THIS BUILD'S TESTS (read and checked as text only). The same framing and the same refusals
// were exercised in a real browser with a stand-in for this file: tests/composer/host-standin.js.

import Foundation

let composerRequestLimit = 262_144
/// A browser takes at most 1 MB from a local helper in one message.
let composerReplyLimit = 1_000_000

func readExactly(_ fd: Int32, _ count: Int) -> Data? {
    if count == 0 { return Data() }
    var data = Data(count: count)
    var done = 0
    while done < count {
        let got = data.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return read(fd, base.advanced(by: done), count - done)
        }
        if got > 0 {
            done += got
        } else if got < 0 && errno == EINTR {
            continue
        } else {
            return nil
        }
    }
    return data
}

func readFrame(_ fd: Int32, limit: Int) -> Data? {
    guard let head = readExactly(fd, 4) else { return nil }
    let bytes = [UInt8](head)
    let length = Int(bytes[0]) | (Int(bytes[1]) << 8) | (Int(bytes[2]) << 16) | (Int(bytes[3]) << 24)
    guard length > 0, length <= limit else { return nil }
    return readExactly(fd, length)
}

func writeFrame(_ fd: Int32, _ body: Data) -> Bool {
    let count = body.count
    var frame = Data([UInt8(count & 0xFF), UInt8((count >> 8) & 0xFF), UInt8((count >> 16) & 0xFF), UInt8((count >> 24) & 0xFF)])
    frame.append(body)
    let total = frame.count
    var done = 0
    while done < total {
        let sent = frame.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return write(fd, base.advanced(by: done), total - done)
        }
        if sent > 0 {
            done += sent
        } else if sent < 0 && errno == EINTR {
            continue
        } else {
            return false
        }
    }
    return true
}

/// The address of a socket file. Nil when the path does not fit (104 bytes on macOS).
func unixAddress(_ path: String) -> sockaddr_un? {
    var address = sockaddr_un()
    let bytes = Array(path.utf8)
    let room = MemoryLayout.size(ofValue: address.sun_path)
    guard !bytes.isEmpty, bytes.count < room else { return nil }
    address.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
        for (index, byte) in bytes.enumerated() { raw[index] = byte }
        raw[bytes.count] = 0
    }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    return address
}

/// Where the program with this process number is on disk.
func executablePath(of pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    return length > 0 ? String(cString: buffer) : nil
}

/// Is the other end of this socket this same user running this same executable?
func peerIsThisExecutable(_ fd: Int32) -> Bool {
    var uid: uid_t = 0
    var gid: gid_t = 0
    guard getpeereid(fd, &uid, &gid) == 0, uid == getuid() else { return false }
    var pid: pid_t = 0
    var length = socklen_t(MemoryLayout<pid_t>.size)
    let solLocal: Int32 = 0             // SOL_LOCAL
    let localPeerPid: Int32 = 0x002     // LOCAL_PEERPID
    guard getsockopt(fd, solLocal, localPeerPid, &pid, &length) == 0, pid > 0,
          let theirs = executablePath(of: pid), let mine = executablePath(of: getpid()) else { return false }
    return theirs == mine
}

/// The bundle identifier of the application an executable belongs to: the outermost ".app" on its path
/// (a browser's helper programs live inside the browser's own bundle).
func bundleIdOfApp(containing executable: String) -> String? {
    let parts = executable.components(separatedBy: "/")
    guard let index = parts.firstIndex(where: { $0.hasSuffix(".app") }) else { return nil }
    return Bundle(path: parts[0...index].joined(separator: "/"))?.bundleIdentifier
}

func composerSocketPath(home: URL) -> String {
    return home.appendingPathComponent("composer", isDirectory: true).appendingPathComponent("bridge.sock").path
}

/// Connects to the app's socket file. -1 when nothing answers there, or what answers is not this same executable.
func connectToApp(_ path: String) -> Int32 {
    guard var address = unixAddress(path) else { return -1 }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    var one: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    var patience = timeval(tv_sec: 20, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &patience, socklen_t(MemoryLayout<timeval>.size))
    let size = socklen_t(MemoryLayout<sockaddr_un>.size)
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
    }
    if result != 0 || !peerIsThisExecutable(fd) {
        close(fd)
        return -1
    }
    return fd
}

/// The executable was started by a browser as its local helper. Returns when the browser closes the connection.
func runComposerHost(origin: String) -> Int32 {
    signal(SIGPIPE, SIG_IGN)
    let home = IndexStore.defaultHome()
    let settings = SettingsStore(home: home).read()
    var why = ""
    if origin != "chrome-extension://" + Scripts.composerExtensionId + "/" {
        why = "forbidden"
    } else if !settings.insertOn {
        why = "off"
    } else {
        let parent = executablePath(of: getppid()).flatMap { bundleIdOfApp(containing: $0) } ?? ""
        if !settings.browsers.contains(where: { $0.bundleId == parent }) { why = "not-paired" }
    }
    var app: Int32 = -1
    if why.isEmpty {
        app = connectToApp(composerSocketPath(home: home))
        if app < 0 {
            why = "not-running"
        } else {
            let hello: [String: Any] = ["hello": "context-composer-host", "origin": origin,
                                        "pid": Int(getpid()), "ppid": Int(getppid())]
            if !writeFrame(app, Data(jsonString(hello).utf8)) {
                close(app)
                app = -1
                why = "not-running"
            }
        }
    }
    while let request = readFrame(0, limit: composerRequestLimit) {
        var reply: Data?
        if app >= 0 {
            if writeFrame(app, request), let answer = readFrame(app, limit: composerReplyLimit) {
                reply = answer
            } else {
                close(app)
                app = -1
                why = "not-running"
            }
        }
        if reply == nil {
            var refusal: [String: Any] = ["ok": false, "reason": why.isEmpty ? "not-running" : why]
            if let parsed = try? JSONSerialization.jsonObject(with: request, options: []),
               let fields = parsed as? [String: Any], let id = fields["id"] as? NSNumber {
                refusal["id"] = id
            }
            reply = Data(jsonString(refusal).utf8)
        }
        guard let out = reply, writeFrame(1, out) else { break }
    }
    if app >= 0 { close(app) }
    return 0
}
