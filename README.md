# Context for Mac

Tag Apple Notes, Mail messages and saved files from the macOS menu bar. Look up a tag to copy current source material into an AI draft with its dates and citations. Context never presses Send.

**[Download for Mac · Mac용 앱 다운로드 (ZIP)](https://github.com/zakat9/context-macos/releases/download/v0.12.0/Context-0.12.0-macOS-arm64-adhoc.zip)** · [Product page &amp; help](https://zakat9.github.io/context-macos/) · [한국어 안내](https://zakat9.github.io/context-macos/#ko) · [Release notes](https://github.com/zakat9/context-macos/releases/tag/v0.12.0)

**0.12.0 prerelease.** The prebuilt app is for Apple silicon (M-series). The build targets macOS 12 or later and was self-tested on macOS 27.2.1. It is ad-hoc signed, not Apple-notarized; Gatekeeper may block it. No Intel binary is provided.

## Install and try it

1. Download the **app ZIP** above, unzip it and move **Context.app** to Applications. Open the app and look for the tag icon in the menu bar.
2. Open a sample note. Click the tag icon → **App access**, select Notes and choose **Request selected**. When you return to the note, check the title under **Selected item**, type a tag such as `Quote` and press Return. Repeat for a related email or saved file. Each item can have up to two tags.
3. Under **Find context**, select `Quote`. Preview a source, untick anything you don't want, then press **Copy** and paste into your draft. No extension is required.

[See the walkthrough with screenshots](https://zakat9.github.io/context-macos/) · [Installation help](https://zakat9.github.io/context-macos/#help)

## Features and limits

- **Tag current item:** assign a shortcut in Settings to open the editor for the selected item.
- **Manage tags:** preview the number of affected sources before renaming or merging a tag. Originals are never edited.
- **Insert context:** the optional Chrome extension inserts sources into a ChatGPT draft. Tested on a fictional chat page, not the live ChatGPT editor. For any other AI app, use Copy and paste.
- **File support:** reads saved Excel cell values, plain text and saved mail; PDF, Word, PowerPoint and iWork documents are taggable by name and date only. Files over 40 MB are listed, not read.
- **Privacy:** Context keeps a local index under `~/WorkIndex/`, not copies of document contents or version history. The app makes no network requests. Review what you copy or insert before sending it to another service.

## Build from source

Install Apple's Command Line Tools. Use the [versioned source ZIP](https://github.com/zakat9/context-macos/releases/download/v0.12.0/Context-0.12.0-source.zip) for the exact prerelease source. From the project root:

```bash
cd app
bash build.sh install
open ~/Applications/Context.app
```

The script runs the Mac self-test and installs to your user Applications folder. To run the fictional-data regression suite, use `node tests/run.js` from the project root (Node 18+). See [release notes](RELEASE-NOTES.md) and [remaining live checks](LIVE-CHECKS.md) for the tested scope. GitHub's **Code → Download ZIP** gives repository files, not an installable app.

## Help and removal

- **Permission denied?** Review **System Settings → Privacy & Security → Automation**. Select one saved item and try again. Do not disable Gatekeeper.
- **Shortcut or insertion not working?** Check the shortcut in Settings, or use the tag icon and Copy. [Report an issue](https://github.com/zakat9/context-macos/issues) with the app version, macOS version and fictional reproduction steps. Do not include personal files or mail.
- **Uninstall:** disable Insert context in Settings if enabled and remove its Chrome extension. Quit Context and delete the app. Keep `~/WorkIndex/` to retain your local tags.

## 한국어 빠른 시작

**[Apple Silicon용 앱 ZIP 다운로드](https://github.com/zakat9/context-macos/releases/download/v0.12.0/Context-0.12.0-macOS-arm64-adhoc.zip)** · [화면으로 보는 사용법](https://zakat9.github.io/context-macos/#ko)

압축을 풀고 Context.app을 응용 프로그램 폴더로 옮기세요. 메뉴 막대의 태그 아이콘에서 Notes 접근을 허용한 뒤, 메모와 관련 메일에 같은 태그를 붙이세요. **Find context → Copy**로 필요한 자료만 출처와 함께 복사할 수 있습니다. 전송은 사용자가 직접 합니다. 이 버전은 Apple 공증 전 프리릴리스입니다.

## License

All rights reserved. No open-source license has been granted.
