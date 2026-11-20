// Context — self-test:  "Context.app/Contents/MacOS/WorkIndex" --self-test
// Checks the Mac side of this build: the index file, file reading, the script table, the script runner,
// that the menu-bar label's rules run in this Mac's JavaScriptCore and give the expected commands, the settings
// file, and the Insert context plumbing (the rules in JavaScriptCore, the message framing, and the app answering
// this same executable over its socket file).
// It opens no window, asks no other app anything, and works in temporary folders that are removed at the end.
// It does not show that the popover, the shortcut or the browser extension work: see LIVE-CHECKS.md for that.

import Foundation

func runSelfTest() -> Int32 {
    var passed = 0
    var failed = 0
    func check(_ name: String, _ ok: Bool, _ detail: String = "") {
        if ok {
            passed += 1
            print("PASS  " + name)
        } else {
            failed += 1
            print("FAIL  " + name + (detail.isEmpty ? "" : "\n      → " + detail))
        }
    }

    let manager = FileManager.default
    let temp = manager.temporaryDirectory.appendingPathComponent("workindex-selftest-" + UUID().uuidString, isDirectory: true)
    do {
        try manager.createDirectory(at: temp, withIntermediateDirectories: true, attributes: nil)
    } catch {
        print("FAIL  could not make a temporary folder: " + error.localizedDescription)
        return 2
    }
    defer { try? manager.removeItem(at: temp) }

    func note(_ text: String) { print("NOTE  " + text) }

    let page = loadPopoverPage() ?? ""
    check("the popover page is in the app and carries its rules", page.contains("WorkIndexPopover") && page.contains("WorkIndexRead") && !page.contains("/*__RULES__*/"), String(page.count) + " characters")

    check("the popover page sends its own height and sizes nothing from the window", page.contains("call('size'") && page.contains("ResizeObserver") && !page.contains("height:100%"))

    // The popover's size, by the same functions the app uses: 352 points wide always; the page's height within a
    // floor and the room on the screen; a screen too small or a nonsense height cannot produce a bad size.
    let roomTall = AppDelegate.popoverRoom(visibleHeight: 1415), roomLow = AppDelegate.popoverRoom(visibleHeight: 600),
        roomTiny = AppDelegate.popoverRoom(visibleHeight: 90)
    check("the popover is 352 points wide and its room is the screen less a margin, at most 720 and at least 160",
          AppDelegate.popoverWidth == 352 && roomTall == 720 && roomLow == 572 && roomTiny == 160,
          "\(roomTall) \(roomLow) \(roomTiny)")
    let grown = AppDelegate.popoverHeight(content: 517.2, room: roomTall), shrunk = AppDelegate.popoverHeight(content: 233, room: roomTall),
        clamped = AppDelegate.popoverHeight(content: 2400, room: roomLow), floor = AppDelegate.popoverHeight(content: 40, room: roomLow)
    check("the popover's height follows the page up and down, rounded up, kept within the floor and the room",
          grown == 518 && shrunk == 233 && clamped == 572 && floor == 160 &&
          AppDelegate.popoverHeight(content: .nan, room: roomLow) == nil && AppDelegate.popoverHeight(content: -5, room: roomLow) == nil,
          "\(String(describing: grown)) \(String(describing: shrunk)) \(String(describing: clamped)) \(String(describing: floor))")

    // The application icon: named by Info.plist, inside the app, an .icns with every standard size up to 1024 pixels.
    let iconName = Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String ?? ""
    let iconData = Bundle.main.url(forResource: iconName, withExtension: "icns").flatMap { try? Data(contentsOf: $0) } ?? Data()
    var iconTypes: [String] = []
    if iconData.count > 8, String(decoding: iconData.prefix(4), as: UTF8.self) == "icns" {
        var at = 8
        while at + 8 <= iconData.count {
            let type = String(decoding: iconData[at..<at + 4], as: UTF8.self)
            let length = iconData[at + 4..<at + 8].reduce(0) { $0 << 8 | Int($1) }
            if length < 8 { break }
            iconTypes.append(type)
            at += length
        }
    }
    // 16 and 32 pixels are ic04/ic05 (as iconutil writes them) or icp4/icp5; 16@2x ic11, 32@2x ic12, 128 ic07,
    // 128@2x ic13, 256 ic08, 256@2x ic14, 512 ic09, 512@2x (1024 pixels) ic10.
    let iconSizes = [["ic04", "icp4"], ["ic05", "icp5"], ["ic11"], ["ic12"], ["ic07"], ["ic13"], ["ic08"], ["ic14"], ["ic09"], ["ic10"]]
    check("the app icon is named in Info.plist and is an .icns with 16, 32, 128, 256 and 512 points at 1x and 2x (1024 pixels)",
          iconName == "AppIcon" && iconSizes.allSatisfy { $0.contains(where: iconTypes.contains) }, iconName + ": " + iconTypes.joined(separator: " "))

    let store = IndexStore(home: temp.appendingPathComponent("home", isDirectory: true))
    check("no index yet reads as missing", (store.read()["missing"] as? Bool) == true)
    let workbook = temp.appendingPathComponent("fictional costs.xlsx")
    let bytes = Data([0x50, 0x4B, 0x03, 0x04, 0x00, 0xFF, 0x10, 0x80])
    manager.createFile(atPath: workbook.path, contents: bytes, attributes: nil)
    let info = readFile(workbook.path)
    let real = info["realPath"] as? String ?? ""
    check("a file that is on this Mac is not taken for an online-only cloud placeholder, and its contents are read",
          !isOnlineOnly(real) && info["online"] == nil && info["base64"] != nil)
    let indexText = "{\"schema\":1,\"app\":\"work-index\",\"objects\":{\"file:x\":{\"locator\":{\"type\":\"file\",\"value\":\"" + real + "\"}}}}"
    let stampBefore = store.stamp()["stamp"] as? String ?? ""
    let wrote = store.write(indexText)
    check("the index file's stamp changes when the index is written", stampBefore == "none" && (store.stamp()["stamp"] as? String ?? "none") != "none")
    check("the index is written and read back unchanged", (wrote["ok"] as? Bool) == true && (store.read()["text"] as? String) == indexText)
    let permissions = (try? manager.attributesOfItem(atPath: store.indexURL.path))?[.posixPermissions] as? NSNumber
    check("the index file is private to this user (0600)", permissions?.intValue == 0o600, String(describing: permissions))
    let names = ((try? manager.contentsOfDirectory(atPath: store.home.path)) ?? []).sorted()
    check("the index folder holds index.json and nothing else", names == ["index.json"], names.joined(separator: ", "))
    check("the files the index points at are the ones the page may read", store.indexedPaths() == Set([real]) && !real.isEmpty, store.indexedPaths().sorted().joined(separator: ", "))

    check("a file is read whole, with its resolved path, size and date", (info["ok"] as? Bool) == true && (info["base64"] as? String) == bytes.base64EncodedString() && (info["size"] as? Int) == 8 && ((info["mtimeMs"] as? Double) ?? 0) > 0, jsonString(info))
    check("a missing file is reported as missing", (readFile(temp.appendingPathComponent("nothing.xlsx").path)["reason"] as? String) == "missing")
    check("a folder is not a file", (readFile(temp.path)["reason"] as? String) == "folder")

    check("the script table has the eleven apps and both read scripts", Scripts.selection.count == 11 && Scripts.selection["com.apple.Notes"] != nil && Scripts.readNote.contains("__ID__") && Scripts.readMail.contains("__NUMID__"))
    let runner = ScriptRunner()
    check("an app that is not followed is asked nothing", (runner.selection(bundleId: "com.example.other")["ok"] as? Bool) == false)
    check("a note id that is not an id is refused before any script runs", (runner.readNote(id: "x\" & (do shell script \"true\") & \"")["message"] as? String) == "bad id")
    check("a mail id that is not a number is refused before any script runs", (runner.readMail(account: "Work", mailbox: "INBOX", numericId: "1 or true")["message"] as? String) == "bad id")
    check("quotes in a mailbox name cannot end the quoted text", ScriptRunner.quoted("In\"box\\") == "In\\\"box\\\\")
    // Only AppleScript's own built-ins here: no Apple event is sent, not even to this process. A scripting-addition
    // command (such as "ASCII character") sends one, which makes macOS register the process as an app; launched
    // without a login-window session (from a daemon or over ssh) that registration calls abort() (0.10 and 0.11).
    check("the app's scripts use no scripting-addition command", !Scripts.selection.values.contains { $0.contains("ASCII character") } && !Scripts.watch.values.contains { $0.contains("ASCII character") } && !Scripts.readNote.contains("ASCII character") && !Scripts.readMail.contains("ASCII character"))
    let local = runner.run("return \"ok\" & (character id 31) & \"1\"")
    check("the script runner runs AppleScript and returns its text", (local["ok"] as? Bool) == true && (local["reply"] as? String) == "ok\u{1F}1", jsonString(local))
    let broken = runner.run("error \"no\" number -1743")
    check("a script error comes back with its number", (broken["ok"] as? Bool) == false && (broken["code"] as? Int) == -1743, jsonString(broken))

    // The menu-bar label's rules, in this Mac's JavaScriptCore. No app is asked anything: the answers are made up here.
    let accessPage = loadAccessPage() ?? ""
    check("the App access page is in the app and carries its rules", accessPage.contains("ContextAccess") && !accessPage.contains("/*__ACCESS__*/"), String(accessPage.count) + " characters")
    if let rules = loadStatusRules(), let engine = StatusEngine(source: rules) {
        func kinds(_ commands: [[String: Any]]) -> String { return commands.map { ($0["do"] as? String ?? "?") + (($0["state"] as? String).map { ":" + $0 } ?? "") }.joined(separator: " ") }
        let other = engine.step(["type": "app", "bundleId": "com.example.other", "name": "Other", "pid": 11, "now": 1000, "stamp": "none"])
        check("label rules: an app Context does not follow is asked nothing", kinds(other).contains("show:off") && kinds(other).contains("idle") && !kinds(other).contains("ask"), kinds(other))
        _ = engine.step(["type": "index", "stamp": "none", "missing": true, "now": 1001])
        let notes = engine.step(["type": "app", "bundleId": "com.apple.Notes", "name": "Notes", "pid": 12, "now": 2000, "stamp": "none"])
        func scope(_ commands: [[String: Any]]) -> Bool? { return commands.first { ($0["do"] as? String) == "scope" }?["on"] as? Bool }
        check("label rules: the shortcut is in scope while a followed app is in front, and only then", scope(other) == false && scope(notes) == true, kinds(other) + " / " + kinds(notes))
        check("label rules: a followed app clears the label and waits a moment before asking", kinds(notes).contains("show:wait") && kinds(notes).contains("wait") && !kinds(notes).contains("ask"), kinds(notes))
        let tick = engine.step(["type": "tick", "now": 2200, "stamp": "none"])
        let seq = (tick.first { ($0["do"] as? String) == "ask" }?["seq"] as? NSNumber)?.intValue ?? -1
        check("label rules: then one question, for the app in front", seq > 0 && (tick.first { ($0["do"] as? String) == "ask" }?["bundleId"] as? String) == "com.apple.Notes", kinds(tick))
        let text = "{\"schema\":1,\"app\":\"work-index\",\"objects\":{\"applenotes:x-coredata://SELFTEST/ICNote/p1\":{\"id\":\"applenotes:x-coredata://SELFTEST/ICNote/p1\",\"kind\":\"note\",\"title\":\"Self-test note\",\"tags\":[\"Cost\",\"QuarterlyBudgetReview\"],\"tagKeys\":[\"cost\",\"quarterlybudgetreview\"],\"locator\":{\"type\":\"apple-notes\",\"value\":\"x-coredata://SELFTEST/ICNote/p1\"},\"sourceTime\":null,\"sourceTimeType\":\"unknown\",\"sourceCreated\":null,\"capturedAt\":\"2026-11-20T09:00:00+09:00\",\"updatedAt\":\"2026-11-20T09:00:00+09:00\"}}}"
        _ = engine.step(["type": "index", "stamp": "s1", "text": text, "now": 2201])
        let stale = engine.step(["type": "answer", "seq": seq - 1, "bundleId": "com.apple.Notes", "pid": 12, "perm": 0, "ok": true, "reply": "note\u{1F}x-coredata://SELFTEST/ICNote/p1\u{1F}Self-test note\u{1F}\u{1F}", "now": 2210, "stamp": "s1"])
        check("label rules: an answer to an older question is not believed", !kinds(stale).contains("show"), kinds(stale))
        let answer = engine.step(["type": "answer", "seq": seq, "bundleId": "com.apple.Notes", "pid": 12, "perm": 0, "ok": true, "reply": "note\u{1F}x-coredata://SELFTEST/ICNote/p1\u{1F}Self-test note\u{1F}\u{1F}", "now": 2220, "stamp": "s1"])
        let shown = answer.first { ($0["do"] as? String) == "show" }
        check("label rules: the tags of the selected note, shortened for the menu bar, full in the tooltip", (shown?["state"] as? String) == "tags" && (shown?["title"] as? String) == "Cost, Quarterly…" && ((shown?["tooltip"] as? String) ?? "").contains("QuarterlyBudgetReview"), jsonString(shown ?? [:]))
        _ = engine.step(["type": "tick", "now": 2800, "stamp": "s1"])
        let denied = engine.step(["type": "answer", "seq": seq + 1, "bundleId": "com.apple.Notes", "pid": 12, "perm": -1743, "now": 2810, "stamp": "s1"])
        check("label rules: when macOS no longer allows the app, the tags are cleared at once", (denied.first { ($0["do"] as? String) == "show" }?["state"] as? String) == "off", kinds(denied))
    } else {
        check("the menu-bar label's rules load in JavaScriptCore", false, "status.js is missing from the app or did not load")
    }

    // Settings: one small file, written all at once, and only known fields are believed.
    let settingsPage = loadSettingsPage() ?? ""
    check("the Settings page is in the app and carries its rules", settingsPage.contains("ContextSettings") && !settingsPage.contains("/*__SETTINGS__*/"), String(settingsPage.count) + " characters")
    let settingsStore = SettingsStore(home: temp.appendingPathComponent("settings-home", isDirectory: true))
    let unset = settingsStore.read()
    check("with no settings file nothing is set, and reading does not make one", unset.tagShortcut == nil && !unset.insertOn && unset.browsers.isEmpty && !manager.fileExists(atPath: settingsStore.fileURL.path))
    let suggested = Chord(["keyCode": 17, "modifiers": ["option", "control"], "key": "T"] as [String: Any])
    check("the suggested chord is Control-Option-T in macOS's terms", suggested?.keyCode == 17 && (suggested?.modifiers ?? []) == ["control", "option"] && suggested?.carbonModifiers == 6144, String(describing: suggested?.carbonModifiers))
    check("a chord without Control or Option, or with a key number that is none, is not a chord", Chord(["keyCode": 17, "modifiers": ["command"], "key": "T"] as [String: Any]) == nil && Chord(["keyCode": 300, "modifiers": ["control"], "key": "T"] as [String: Any]) == nil && Chord(["keyCode": 1.5, "modifiers": ["control"], "key": "T"] as [String: Any]) == nil)
    var wanted = Settings()
    wanted.tagShortcut = suggested
    wanted.insertOn = true
    wanted.browsers = [PairedBrowser(name: "Fixture Browser", bundleId: "com.example.fixture-browser", manifest: "/tmp/fixture/local.workindex.composer.json")]
    let settingsSaved = settingsStore.write(wanted)
    let reread = settingsStore.read()
    check("settings are written and read back unchanged", settingsSaved && reread.tagShortcut == suggested && reread.insertOn && reread.browsers.count == 1 && reread.browsers.first?.bundleId == "com.example.fixture-browser")
    let settingsMode = (try? manager.attributesOfItem(atPath: settingsStore.fileURL.path))?[.posixPermissions] as? NSNumber
    check("the settings file is private to this user (0600)", settingsMode?.intValue == 0o600, String(describing: settingsMode))
    _ = try? Data("{\"tagShortcut\":{\"keyCode\":17,\"modifiers\":[\"command\"],\"key\":\"T\"},\"insert\":{\"on\":true,\"browsers\":[]}}".utf8).write(to: settingsStore.fileURL)
    let odd = settingsStore.read()
    check("a settings file with a chord that is not allowed, or 'on' with no browser, reads as not set", odd.tagShortcut == nil && !odd.insertOn)

    // The hot key itself, in a separate run of this executable. A hot key needs macOS to register the process as an
    // app with the window server; started without a login session (from a daemon, over ssh) macOS ends the process
    // with abort() instead of answering. In a child process that ends the trial only, and it is reported as NOT RUN.
    var notRun = 0
    if let own = Bundle.main.executablePath ?? CommandLine.arguments.first {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: own)
        child.arguments = ["--self-test-hot-key"]
        let output = Pipe()
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice
        do {
            try child.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            child.waitUntilExit()
            let lines = (String(data: data, encoding: .utf8) ?? "").split(separator: "\n").map(String.init)
            for line in lines {
                print(line)
                if line.hasPrefix("PASS  ") { passed += 1 }
                if line.hasPrefix("FAIL  ") { failed += 1 }
            }
            if child.terminationReason == .uncaughtSignal {
                notRun += 1
                print("NOT RUN  the hot key trial: macOS ended it (signal " + String(child.terminationStatus) + ") before it could register a hot key. This happens when the build runs without a login session (from a daemon or over ssh). Run build.sh from Terminal to check the hot key.")
            } else if child.terminationStatus != 0 && !lines.contains(where: { $0.hasPrefix("FAIL  ") }) {
                check("the hot key trial ran to its end", false, "exit status " + String(child.terminationStatus))
            }
        } catch {
            notRun += 1
            print("NOT RUN  the hot key trial: this executable could not be started again (" + error.localizedDescription + ")")
        }
    }

    // Insert context: the rules in this Mac's JavaScriptCore, the message framing, and the socket file.
    var pipeEnds: [Int32] = [0, 0]
    if pipe(&pipeEnds) == 0 {
        let body = Data("{\"op\":\"open\",\"note\":\"한글 ✓\"}".utf8)
        let sent = writeFrame(pipeEnds[1], body)
        let got = readFrame(pipeEnds[0], limit: 1_024)
        _ = writeFrame(pipeEnds[1], Data(count: 2_000))
        let tooLong = readFrame(pipeEnds[0], limit: 1_024)
        close(pipeEnds[0])
        close(pipeEnds[1])
        check("a message is framed and read back whole; one over the limit is not read", sent && got == body && tooLong == nil)
    }
    let registration = Composer.registration(executable: "/Applications/Context.app/Contents/MacOS/WorkIndex").flatMap { try? JSONSerialization.jsonObject(with: $0, options: []) } as? [String: Any]
    check("the helper's registration names this helper, this executable and the Context extension only", (registration?["name"] as? String) == "local.workindex.composer" && (registration?["type"] as? String) == "stdio" && (registration?["path"] as? String) == "/Applications/Context.app/Contents/MacOS/WorkIndex" && (registration?["allowed_origins"] as? [String] ?? []) == ["chrome-extension://" + Scripts.composerExtensionId + "/"])
    let ownPath = executablePath(of: getpid()) ?? ""
    if ownPath.contains(".app/") {
        check("a running program's application is found from its place on disk (as the helper finds the browser)", bundleIdOfApp(containing: ownPath) == Bundle.main.bundleIdentifier, ownPath)
    } else {
        note("not run from inside an app bundle, so finding an application from a program's place on disk was not checked (" + ownPath + ")")
    }
    let insertStore = IndexStore(home: temp.appendingPathComponent("insert-home", isDirectory: true))
    _ = insertStore.write("{\"schema\":1,\"app\":\"work-index\",\"objects\":{\"applenotes:x-coredata://SELFTEST/ICNote/p1\":{\"id\":\"applenotes:x-coredata://SELFTEST/ICNote/p1\",\"kind\":\"note\",\"title\":\"Self-test note\",\"tags\":[\"Cost\"],\"tagKeys\":[\"cost\"],\"locator\":{\"type\":\"apple-notes\",\"value\":\"x-coredata://SELFTEST/ICNote/p1\"},\"sourceTime\":null,\"sourceTimeType\":\"unknown\",\"sourceCreated\":null,\"capturedAt\":\"2026-11-20T09:00:00+09:00\",\"updatedAt\":\"2026-11-20T09:00:00+09:00\"}}}")
    if let insertRules = loadInsertRules(), let engine = InsertEngine(source: insertRules, store: insertStore, scripts: runner) {
        let opened = engine.answer("{\"id\":7,\"op\":\"open\"}")
        check("Insert context rules: run in JavaScriptCore and list the index's tags with their counts", opened.contains("\"ok\":true") && opened.contains("\"id\":7") && opened.contains("\"name\":\"Cost\"") && opened.contains("\"count\":1"), opened)
        let refused = engine.answer("{\"id\":8,\"op\":\"writeIndex\"}")
        check("Insert context rules: a request that is not one of the four is refused", refused.contains("\"ok\":false") && refused.contains("\"reason\":\"unknown\""), refused)

        // The socket file, asked by this same executable (as the helper is). The folder name is short on purpose:
        // a socket file's path may be at most 103 bytes.
        let shortHome = URL(fileURLWithPath: "/tmp/ctx-" + String(UUID().uuidString.prefix(8)), isDirectory: true)
        defer { try? manager.removeItem(at: shortHome) }
        let composer = Composer(home: shortHome, engine: engine)
        if composer.startAnswering() {
            let socketFile = composerSocketPath(home: shortHome)
            let socketMode = (try? manager.attributesOfItem(atPath: socketFile))?[.posixPermissions] as? NSNumber
            let folderMode = (try? manager.attributesOfItem(atPath: composer.directory.path))?[.posixPermissions] as? NSNumber
            check("the socket file and its folder are for this user only (0600 in 0700)", socketMode?.intValue == 0o600 && folderMode?.intValue == 0o700, String(describing: socketMode) + " " + String(describing: folderMode))
            var answered = ""
            var stranger = "not tried"
            var finished = false
            DispatchQueue.global(qos: .userInitiated).async {
                let good = connectToApp(socketFile)
                if good >= 0 {
                    let hello: [String: Any] = ["hello": "context-composer-host", "origin": "chrome-extension://" + Scripts.composerExtensionId + "/"]
                    if writeFrame(good, Data(jsonString(hello).utf8)), writeFrame(good, Data("{\"id\":9,\"op\":\"open\"}".utf8)),
                       let reply = readFrame(good, limit: composerReplyLimit) {
                        answered = String(data: reply, encoding: .utf8) ?? ""
                    }
                    close(good)
                }
                let other = connectToApp(socketFile)
                if other >= 0 {
                    let hello: [String: Any] = ["hello": "context-composer-host", "origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
                    _ = writeFrame(other, Data(jsonString(hello).utf8))
                    _ = writeFrame(other, Data("{\"id\":10,\"op\":\"open\"}".utf8))
                    stranger = readFrame(other, limit: composerReplyLimit) == nil ? "no answer" : "answered"
                    close(other)
                }
                DispatchQueue.main.async { finished = true }
            }
            let deadline = Date().addingTimeInterval(8)
            while !finished && Date() < deadline { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
            check("over the socket file the app answers this same executable naming the Context extension", answered.contains("\"ok\":true") && answered.contains("\"id\":9") && answered.contains("\"name\":\"Cost\""), answered)
            check("a hello that names another extension gets no answer", stranger == "no answer", stranger)
            composer.stopAnswering()
            check("switched off, the socket file is gone", !manager.fileExists(atPath: socketFile) && !composer.isAnswering)
        } else {
            check("the app can open its socket file", false, composerSocketPath(home: shortHome))
        }
    } else {
        check("the Insert context rules load in JavaScriptCore", false, "insert.js is missing from the app or did not load")
    }

    print("\n== " + String(passed) + "/" + String(passed + failed) + " self-test checks passed" + (notRun > 0 ? "; " + String(notRun) + " NOT RUN (see above)" : "") + " ==")
    print("These checks do not open the popover, change the menu bar, press a shortcut, start a browser or ask Notes, Mail or Finder anything: see LIVE-CHECKS.md.")
    return failed == 0 ? 0 : 1
}

/// "--self-test-hot-key": the hot key part of the self-test, run by the self-test as a separate process (see above).
/// It asks macOS for a registration of an unusual chord and gives it straight back; nothing stays registered.
func runHotKeySelfTest() -> Int32 {
    var failed = 0
    func check(_ name: String, _ ok: Bool, _ detail: String = "") {
        print((ok ? "PASS  " : "FAIL  ") + name + (ok || detail.isEmpty ? "" : "\n      → " + detail))
        if !ok { failed += 1 }
    }
    guard let unusual = Chord(["keyCode": 111, "modifiers": ["control", "option", "shift", "command"], "key": "F12"] as [String: Any]) else {
        check("the trial chord is a chord", false)
        return 1
    }
    let trial = HotKeyCenter.trial(unusual)
    print("NOTE  macOS answered " + String(trial) + " to a trial registration of ⌃⌥⇧⌘F12 (0 means it accepted it; it was given back at once)")
    let center = HotKeyCenter()
    center.begin(with: nil)
    let assigned = center.assign(unusual)
    if assigned != 0 {
        print("NOTE  macOS did not take ⌃⌥⇧⌘F12 (" + String(assigned) + "; another app may use it), so the scope checks were not run")
        center.clear()
        return 0
    }
    let outOfScope = center.isRegistered
    center.setScope(true)
    let inScope = center.isRegistered
    center.setScope(false)
    let after = center.isRegistered
    center.clear()
    center.setScope(true)
    let cleared = center.isRegistered
    center.setScope(false)
    check("hot key: a chord that is set is not registered while no followed app is in front", !outOfScope)
    check("hot key: it is registered while a followed app is in front, and given up when that app leaves", inScope && !after, String(inScope) + " " + String(after))
    check("hot key: once cleared, nothing is registered even with a followed app in front", !cleared)
    return failed == 0 ? 0 : 1
}
