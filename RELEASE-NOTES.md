# Context 0.12.2 (prerelease)

A macOS menu bar app that brings the latest notes, emails, and files you choose into an AI draft, with dates and
sources attached.

> **Prerelease.** Ad-hoc signed, not notarized. The app compiles and passes its self-test on one Mac. The cloud-folder
> handling is tested with fictional paths against a stand-in for the app; it has not yet been tried with a real Google
> Drive, Dropbox or iCloud Drive folder (see `LIVE-CHECKS.md`, section K). Please test with fictional files.

A small update to 0.12.1. Everything else works as before: the popover sizes itself to its content, there are at most
two tags per item, and the Tag current item shortcut, Insert context and Manage tags are unchanged. Your tags,
settings and index format are unchanged.

## New in 0.12.2: cloud folders

Files in the folders that Google Drive, Dropbox, OneDrive, Box and iCloud Drive keep on your Mac can be tagged, looked
up and copied like any other saved file. Context does not sign in to any service and opens no network connection.

- **Named by service, not by account.** In the popover, the lookup list and the copied text, such a file appears as
  `Google Drive › My Drive › Reports › q3.xlsx` or `Dropbox › Team › list.csv`. The account folder on disk is left
  out; for Google Drive, that folder's name contains your email address.
- **Online-only files are never downloaded.** A file that is still in the cloud (it has a cloud icon in Finder) can be
  tagged by name and date. A lookup lists it as not read and says what to do: in Finder, choose "Make Available
  Offline" or "Download Now", then look the tag up again. Context does not open its contents, so the cloud app does
  not start a download.
- **Google Docs, Sheets and Slides** (`.gdoc`, `.gsheet`, `.gslides`, and similar) are only links on your Mac; their
  text is online. They can be tagged and are listed by name and date, with how to include them: download a copy (for
  example as `.xlsx` or `.csv`), tag that copy and look the tag up again. The account email and document address
  inside the link file are never used.
- Files opened in a web browser (drive.google.com, dropbox.com) still cannot be tagged.

## Tested for this release
- **Native, on this Mac:** compiled with `swiftc` (Swift 6.4.2, Swift 5 language mode) on macOS 27.2.1, Apple silicon,
  with no warnings. Self-test: 50 of 50 checks pass. The new check confirms that a file stored on this Mac is not
  mistaken for an online-only placeholder and that its contents are read.
- **Simulated (fictional data, a stand-in for the Mac app):**
  - `node tests/run.js`: 196 of 196, including 8 new cloud-folder checks with made-up Google Drive, Dropbox, OneDrive,
    Box and iCloud Drive paths. They run from Finder all the way to the copied text and confirm no email address or home
    folder appears in it.
  - Page tests in Chrome: 6 of 6, 20 of 20 and 14 of 14.
  - Cycles: 87 of 87 (14 need a person). Rounds: 39 of 39 (7 need a person).
  - Browser extension in a real Chromium: 21 of 21 (4 not run).
- Not tested: a real online-only file. Only the cloud app can create one, and no real cloud folder or account on this
  Mac was opened.

## Known limitations
- Ad-hoc signature only. Gatekeeper blocks the downloaded app until you choose "Open Anyway", and macOS may ask for
  Automation permission again after every rebuild. Building from source is recommended.
- The prebuilt zip is for Apple silicon. On an Intel Mac, build from source.
- A file that the cloud app moves or renames is a different file to Context: tag it again.
- Insert context works with ChatGPT in a Chromium-family browser only and is untested against the real ChatGPT page.
- Word, PowerPoint, PDF and iWork files can be tagged but are listed by name and date only; their text is not read.
- English interface only.

## Assets
- `Context-0.12.2-source.zip`: the source, tests and fictional fixtures.
- `Context-0.12.2-macOS-arm64-adhoc.zip`: the app built from that source (ad hoc signed).
- `SHA256SUMS.txt`: checksums. Verify with `shasum -a 256 -c SHA256SUMS.txt`.

No license has been chosen yet; until one is added, all rights are reserved.
