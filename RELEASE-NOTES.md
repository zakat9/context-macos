# Context 0.12.0 (prerelease)

A macOS menu bar app that brings the latest notes, emails, and files you choose into an AI draft, with dates and
sources attached.

> **Prerelease.** Ad-hoc signed, not notarized. The app compiles and passes its self-test on one Mac, and the rules,
> pages and browser extension pass their automated tests. The menu bar item, popover, macOS prompts, shortcut and
> Insert context have not yet been checked by a person with real apps. Please test with fictional notes, messages
> and files, and report what you find with the step numbers in `LIVE-CHECKS.md`.

## New in 0.12

### Manage tags › Rename everywhere
- Rename a tag on every source in one step, or merge it into a tag that already exists (the existing spelling is kept).
- Before anything is written you see how many sources change and how many already have the new name.
- One save: every entry changes or none does. A source that had both tags keeps the tag once; other tags, the
  two-tag limit, dates and order stay as they were.
- Only Context's index changes. No note, message or file is opened or edited.
- If the index changed after the numbers were shown, nothing is written and the numbers are shown again.

### Settings › Shortcuts › Tag current item (off until you set it)
- "Use ⌃⌥T", or record your own chord (it must include Control or Option).
- With one item selected in an app Context follows, the chord opens the tag editor on that item. Return tags,
  Escape returns you to your app.
- The chord is registered with macOS as a hot key only while such an app is in front. Context installs no key
  monitor and needs no Input Monitoring or Accessibility permission. A chord that macOS itself uses is refused; a
  chord that cannot be registered or saved leaves the previous one in place.

### Insert context (off until you set it up)
- A small Chromium extension (bundled; you load it unpacked) puts the cited, dated text of a tag's sources into the
  ChatGPT message box at the caret. It never presses Send.
- On Insert it checks that the chat, tab, message box, draft and caret are unchanged and that no source was saved
  again since it was listed. Otherwise nothing is inserted, the picker says why and offers "Copy instead".
- The extension runs on `chatgpt.com` only, has one permission (native messaging), no background script and makes
  no web requests. Settings › Turn off removes the helper registration.

## Fixes in this build
- **Self-test abort.** Earlier self-tests (0.10, 0.11) could end with `abort()` when the build was run without a
  login session: the AppleScript check used `ASCII character`, a scripting-addition command that sends an Apple Event,
  which makes macOS register the process with the window server. The app's scripts and the self-test now use
  AppleScript's built-in `character id`, which sends no Apple Event. The hot key part of the self-test runs in a
  separate process and is reported as `NOT RUN` if macOS ends it, instead of ending the whole self-test.
- **Test harness on macOS.** Two cycle checks failed on macOS because the temporary folder is behind a link
  (`/var` → `/private/var`). The pretend Mac now uses the resolved path.

## Tested for this release
- Swift: compiled with `swiftc` (Swift 6.4.2, Swift 5 language mode) on macOS 27.2.1, Apple silicon. Self-test:
  45 of 45 checks pass, with no Apple Event sent.
- `node tests/run.js`: 188 of 188. Page tests in Chromium: 6 of 6 and 20 of 20. Cycles: 87 of 87 (14 need a person
  and are listed as blocked). Extension in a real Chromium against a fixture chat page with a stand-in Mac side:
  21 of 21 (4 not run).
- All tests use fictional data. Nothing was run against real Notes, Mail, accounts, or the real ChatGPT page.

## Known limitations
- Ad-hoc signature only: Gatekeeper blocks the downloaded app until you choose "Open Anyway"; macOS may ask for
  Automation permission again after every rebuild. Building from source is recommended.
- The prebuilt zip is for Apple silicon. On an Intel Mac, build from source.
- Insert context is ChatGPT-in-Chromium only and untested against the real ChatGPT page.
- Word, PowerPoint, PDF and iWork files can be tagged but are listed by name and date only; their text is not read.
- English interface only.

## Assets
- `Context-0.12.0-source.zip`: the source, tests and fictional fixtures.
- `Context-0.12.0-macOS-arm64-adhoc.zip`: the app built from that source (ad hoc signed).
- `SHA256SUMS.txt`: checksums. Verify with `shasum -a 256 -c SHA256SUMS.txt`.

No license has been chosen yet; until one is added, all rights are reserved.
