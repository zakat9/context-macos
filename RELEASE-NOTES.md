# contexta 0.12.3 (prerelease)

A macOS menu bar app that brings the latest notes, emails, and files you choose into an AI draft, with dates and
sources attached.

> **Prerelease.** Ad-hoc signed, not notarized. The app compiles and passes its self-test on one Mac. The upgrade from
> Context 0.12.2 is tested natively with temporary folders, but not yet by a person on a Mac: see `LIVE-CHECKS.md`,
> section L. Please test with fictional notes, messages and files.

## New name: contexta

The app formerly called **Context** is now **contexta**, all lowercase. This release only changes the name; every
feature works as in 0.12.2:
- the popover sizes itself to its content;
- at most two tags per item;
- Tag current item, Insert context and Manage tags;
- cloud folders.

The name changed in:
- Finder and Spotlight (`contexta.app`);
- the menu bar item's tooltip and VoiceOver label;
- window titles and messages;
- the macOS Automation prompt;
- the browser extension's name ("contexta: Insert context") and messages;
- the documentation;
- the download names.

The everyday phrases "Insert context" and "Find context" stay as they were.

What stays the same, so your setup carries over:
- the bundle ID `local.workindex.app` and the executable `WorkIndex`;
- your tags and settings in `~/WorkIndex/`, and your shortcut;
- the browser extension's ID and its helper (`local.workindex.composer`).

## Upgrading from Context 0.12.2

1. Quit Context.
2. Install contexta. It goes in `~/Applications/contexta.app` and does not remove or overwrite `Context.app`.
3. Open contexta once. If you had turned on Insert context, contexta updates the browser's helper registration so it
   points to contexta instead of Context.app.
   - Only registrations you set up before are changed.
   - A registration you removed is not recreated.
   - No new browser is registered and nothing is asked.
4. Delete `Context.app` yourself. If you open it again, it points the registration back to itself.
5. In `chrome://extensions`, press reload on the extension. It is now called "contexta: Insert context" and keeps its
   ID and shortcut.

If Insert context says "The contexta helper stopped", open contexta once. If the message stays, turn Insert context
off in contexta's Settings and set it up again. macOS may ask for Automation permission again, as it can after any
update of an ad-hoc signed app.

## Tested for this release
- **Native, on this Mac:** compiled with `swiftc` (Swift 6.4.2, Swift 5 language mode) on macOS 27.2.1, Apple silicon,
  with no warnings. Self-test: 54 of 54 checks pass. Four new checks run the upgrade with temporary folders:
  - the app is named contexta and keeps its bundle ID and executable;
  - settings written by 0.12.2 are read unchanged;
  - a helper registration still pointing to `Context.app` is updated to point to contexta, one that is already right
    is left alone, and one that was removed stays removed;
  - a browser that was never set up is not touched, and no connection is opened.
- **Simulated (fictional data, a stand-in for the Mac app):** `node tests/run.js` passes 203 of 203, including 7 new
  checks for the name change and what stays the same. Page tests in Chrome, cycles, rounds and the browser-extension
  test: see `RELEASE-REVIEW-0.12.3.md`.
- Nothing was installed, and no real user data was read.

## Known limitations
- Ad-hoc signature only: Gatekeeper blocks the downloaded app until you choose "Open Anyway". Building from source is
  recommended.
- The prebuilt zip is for Apple silicon. On an Intel Mac, build from source.
- Not yet checked by a person: the upgrade on a real Mac, including whether macOS keeps the Automation permissions you
  gave Context.
- Insert context works with ChatGPT in a Chromium-family browser only and is untested against the real ChatGPT page.
- English interface only.

## Assets
- `contexta-0.12.3-source.zip`: the source, tests and fictional fixtures.
- `contexta-0.12.3-macOS-arm64-adhoc.zip`: the app built from that source (ad hoc signed).
- `SHA256SUMS.txt`: checksums. Verify with `shasum -a 256 -c SHA256SUMS.txt`.

No license has been chosen yet; until one is added, all rights are reserved.
