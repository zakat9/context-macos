// contexta — the Tag current item shortcut.
//
// The chord is the person's choice (Settings › Shortcuts). Nothing is registered until they choose one.
// It is given to macOS as a hot key (Carbon's RegisterEventHotKey): macOS then tells this app when that one chord is
// pressed. This app installs no event tap and no key monitor, and never sees any other key.
//
// The chord is registered only while an app contexta follows is in front (core/status.js says when: "scope"). In a
// browser, in contexta's own windows and everywhere else it is not registered at all, so the same keys keep their
// meaning there.
//
// A new chord is tried while the old one is still registered. If macOS does not take it, the old one stays as it was.
//
// NOT VERIFIED ON A MAC IN THIS BUILD'S TESTS: this file has been read and checked as text only. LIVE-CHECKS.md,
// part H, is the list of things to try once the app is compiled.

import AppKit
import Carbon.HIToolbox

/// A key chord, as the Settings page describes it and settings.json keeps it.
struct Chord: Equatable {
    let keyCode: Int
    /// Of "control", "option", "shift", "command", in that order.
    let modifiers: [String]
    /// The key's label, for showing only.
    let key: String

    static let order = ["control", "option", "shift", "command"]

    /// From the page or from the settings file. A chord without Control or Option is not a chord here
    /// (core/settings.js says the same, with the words the person sees).
    init?(_ raw: Any?) {
        guard let fields = raw as? [String: Any],
              let number = fields["keyCode"] as? NSNumber else { return nil }
        let code = number.intValue
        guard code >= 0, code <= 127, number.doubleValue == Double(code) else { return nil }
        let given = fields["modifiers"] as? [String] ?? []
        let kept = Chord.order.filter { given.contains($0) }
        guard kept.contains("control") || kept.contains("option") else { return nil }
        let label = fields["key"] as? String ?? ""
        keyCode = code
        modifiers = kept
        key = label.isEmpty ? "?" : String(label.prefix(8))
    }

    var plain: [String: Any] {
        return ["keyCode": keyCode, "modifiers": modifiers, "key": key]
    }

    /// The modifier bits RegisterEventHotKey expects.
    var carbonModifiers: UInt32 {
        var flags = 0
        if modifiers.contains("control") { flags |= controlKey }
        if modifiers.contains("option") { flags |= optionKey }
        if modifiers.contains("shift") { flags |= shiftKey }
        if modifiers.contains("command") { flags |= cmdKey }
        return UInt32(flags)
    }

    static func == (a: Chord, b: Chord) -> Bool {
        return a.keyCode == b.keyCode && a.modifiers == b.modifiers
    }
}

/// Called by macOS when a registered hot key is pressed. `userData` is the HotKeyCenter that registered it.
private func hotKeyWasPressed(_ call: EventHandlerCallRef?, _ event: EventRef?, _ userData: UnsafeMutableRawPointer?) -> OSStatus {
    let notHandled = OSStatus(-9874)                 // eventNotHandledErr
    guard let event = event, let userData = userData else { return notHandled }
    var id = EventHotKeyID()
    let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                   nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
    if status != 0 { return status }
    let center = Unmanaged<HotKeyCenter>.fromOpaque(userData).takeUnretainedValue()
    return center.pressed(signature: id.signature, id: id.id) ? 0 : notHandled
}

final class HotKeyCenter {
    private static let signature: OSType = 0x4354_5854          // "CTXT"
    private var handler: EventHandlerRef?
    private var live: EventHotKeyRef?
    private var liveId: UInt32 = 0
    private var nextId: UInt32 = 1
    private var inScope = false
    /// The chord that is set (registered or not, depending on which app is in front).
    private(set) var chord: Chord?
    /// The chord was pressed while it was registered.
    var onPressed: (() -> Void)?

    /// At launch: the chord from the settings file. Nothing is registered until an app contexta follows is in front.
    func begin(with saved: Chord?) {
        chord = saved
        apply()
    }

    /// An app contexta follows came to the front (true), or any other app, or contexta itself (false).
    func setScope(_ on: Bool) {
        if inScope == on { return }
        inScope = on
        apply()
    }

    var isRegistered: Bool { return live != nil }

    /// Tries a new chord. Answers 0 when macOS took it; then, and only then, the old chord is given up.
    /// Any other answer: nothing has changed.
    func assign(_ new: Chord) -> OSStatus {
        if let current = chord, current == new { return 0 }
        if HotKeyCenter.systemUses(new) { return OSStatus(-9878) }          // eventHotKeyExistsErr
        installHandler()
        var trial: EventHotKeyRef?
        let id = nextId
        nextId += 1
        let status = RegisterEventHotKey(UInt32(new.keyCode), new.carbonModifiers,
                                         EventHotKeyID(signature: HotKeyCenter.signature, id: id),
                                         GetEventDispatcherTarget(), 0, &trial)
        guard status == 0, let registered = trial else { return status == 0 ? OSStatus(-9869) : status }   // eventInternalErr
        if let old = live { UnregisterEventHotKey(old) }
        chord = new
        if inScope {
            live = registered
            liveId = id
        } else {
            // It was a trial: macOS took the chord. It is registered again when a followed app comes to the front.
            UnregisterEventHotKey(registered)
            live = nil
            liveId = 0
        }
        return 0
    }

    /// Back to an earlier chord (or to none): used when a newly accepted chord could not be saved.
    func restore(_ earlier: Chord?) {
        chord = earlier
        apply()
    }

    func clear() {
        chord = nil
        apply()
    }

    private func apply() {
        if let old = live {
            UnregisterEventHotKey(old)
            live = nil
            liveId = 0
        }
        guard inScope, let wanted = chord else { return }
        installHandler()
        var made: EventHotKeyRef?
        let id = nextId
        nextId += 1
        let status = RegisterEventHotKey(UInt32(wanted.keyCode), wanted.carbonModifiers,
                                         EventHotKeyID(signature: HotKeyCenter.signature, id: id),
                                         GetEventDispatcherTarget(), 0, &made)
        if status == 0, let registered = made {
            live = registered
            liveId = id
        }
    }

    private func installHandler() {
        if handler != nil { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetEventDispatcherTarget(), hotKeyWasPressed, 1, &spec,
                            Unmanaged.passUnretained(self).toOpaque(), &handler)
    }

    fileprivate func pressed(signature: OSType, id: UInt32) -> Bool {
        guard signature == HotKeyCenter.signature, id == liveId, live != nil else { return false }
        DispatchQueue.main.async { [weak self] in self?.onPressed?() }
        return true
    }

    /// Is this chord one of macOS's own switched-on shortcuts (Spotlight, Mission Control, input sources…)?
    /// macOS keeps those for itself, so such a chord is refused here instead of being set and never arriving.
    static func systemUses(_ chord: Chord) -> Bool {
        var list: Unmanaged<CFArray>?
        guard CopySymbolicHotKeys(&list) == 0, let entries = list?.takeRetainedValue() as? [[String: Any]] else { return false }
        for entry in entries {
            let enabled = (entry["kHISymbolicHotKeyEnabled"] as? NSNumber)?.boolValue ?? false
            let code = (entry["kHISymbolicHotKeyCode"] as? NSNumber)?.intValue ?? -1
            let modifiers = (entry["kHISymbolicHotKeyModifiers"] as? NSNumber)?.uint32Value ?? 0
            if enabled && code == chord.keyCode && modifiers == chord.carbonModifiers { return true }
        }
        return false
    }

    /// For the self-test: does this Mac take, and give back, a hot key registration at all? Nothing stays registered.
    static func trial(_ chord: Chord) -> OSStatus {
        var made: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(chord.keyCode), chord.carbonModifiers,
                                         EventHotKeyID(signature: HotKeyCenter.signature, id: 9_999),
                                         GetEventDispatcherTarget(), 0, &made)
        if status == 0, let registered = made { UnregisterEventHotKey(registered) }
        return status
    }
}
