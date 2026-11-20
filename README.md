# contexta for Mac

Tag Apple Notes, Mail messages and saved files from the macOS menu bar. Look up a tag to copy current source material into an AI draft with its dates and citations. contexta never presses Send.

**[Download for Mac · Mac용 앱 다운로드 (ZIP)](https://github.com/zakat9/context-macos/releases/download/v0.12.2/Context-0.12.2-macOS-arm64-adhoc.zip)** · [Product page &amp; help](https://zakat9.github.io/context-macos/) · [한국어 안내](https://zakat9.github.io/context-macos/#ko) · [Release notes](https://github.com/zakat9/context-macos/releases/tag/v0.12.2)

contexta was formerly called Context. Version 0.12.2 still installs as **Context.app**.

**0.12.2 prerelease.** The prebuilt app is for Apple silicon (M-series). The build targets macOS 12 or later and was self-tested on macOS 27.2.1. It is ad-hoc signed, not Apple-notarized; Gatekeeper may block it. No Intel binary is provided.

## Install and try it

1. Download the **app ZIP** above, unzip it and move **Context.app** to Applications. Open the app and look for the tag icon in the menu bar.
2. Open a sample note. Click the tag icon → **App access**, select Notes and choose **Request selected**. When you return to the note, check the title under **Selected item**, type a tag such as `Quote` and press Return. Repeat for a related email or saved file. Each item can have up to two tags.
3. Under **Find context**, select `Quote`. Preview a source, untick anything you don't want, then press **Copy** and paste into your draft. No extension is required.

[See the walkthrough (0.12.0 example screens)](https://zakat9.github.io/context-macos/) · [Installation help](https://zakat9.github.io/context-macos/#help)

## Features and limits

- **Tag current item:** assign a shortcut in Settings to open the editor for the selected item.
- **Manage tags:** preview the number of affected sources before renaming or merging a tag. Originals are never edited.
- **Insert context:** the optional Chrome extension inserts sources into a ChatGPT draft. Tested on a fictional chat page, not the live ChatGPT editor. For any other AI app, use Copy and paste.
- **File support:** reads saved Excel cell values, plain text and saved mail; PDF, Word, PowerPoint and iWork documents are taggable by name and date only. Files over 40 MB are listed, not read.
- **Synced files:** In Finder, select a file stored locally by Google Drive, Dropbox, OneDrive, Box or iCloud Drive. This includes provider folders under `~/Library/CloudStorage/`. contexta reads supported formats just as it does other local files. Citations show the service and folder, not the account folder. Online-only files and Google Docs links can be tagged by name and date; contexta does not read their contents or download them. Tests used fictional paths, not a real cloud folder or online-only file.
- **App icon and menu:** Look for the teal tag on Context.app. The menu bar keeps its original tag symbol. The menu stays 352 points wide, grows or shrinks with its contents, and scrolls when the list is too tall for the screen.
- **Privacy:** contexta keeps a local index under `~/WorkIndex/`, not copies of document contents or version history. The app makes no network requests. Review what you copy or insert before sending it to another service.

## Build from source

Install Apple's Command Line Tools. Use the [versioned source ZIP](https://github.com/zakat9/context-macos/releases/download/v0.12.2/Context-0.12.2-source.zip) for the exact prerelease source. From the project root:

```bash
cd app
bash build.sh install
open ~/Applications/Context.app
```

The script runs the Mac self-test and installs to your user Applications folder. To run the fictional-data regression suite, use `node tests/run.js` from the project root (Node 18+). See [release notes](https://github.com/zakat9/context-macos/releases/tag/v0.12.2) and [remaining live checks](LIVE-CHECKS.md) for the tested scope. GitHub's **Code → Download ZIP** gives repository files, not an installable app.

## Help and removal

- **Permission denied?** Review **System Settings → Privacy & Security → Automation**. Select one saved item and try again. Do not disable Gatekeeper.
- **Shortcut or insertion not working?** Check the shortcut in Settings, or use the tag icon and Copy. [Report an issue](https://github.com/zakat9/context-macos/issues) with the app version, macOS version and fictional reproduction steps. Do not include personal files or mail.
- **Uninstall:** disable Insert context in Settings if enabled and remove its Chrome extension. Quit the app and delete Context.app. Keep `~/WorkIndex/` to retain your local tags.

## 한국어 빠른 시작

**[Apple Silicon용 앱 ZIP 다운로드](https://github.com/zakat9/context-macos/releases/download/v0.12.2/Context-0.12.2-macOS-arm64-adhoc.zip)** · [화면으로 보는 사용법 (0.12.0 예시)](https://zakat9.github.io/context-macos/#ko)

Context의 새 이름은 contexta입니다. 현재 배포 중인 0.12.2 버전은 기존 이름인 **Context.app**으로 설치됩니다. 압축을 풀고 Context.app을 응용 프로그램 폴더로 옮기세요. 메뉴 막대의 태그 아이콘에서 Notes 접근을 허용한 뒤, 메모와 관련 메일에 같은 태그를 붙이세요. **Find context → Copy**로 필요한 자료만 출처와 함께 복사할 수 있습니다. 전송은 사용자가 직접 합니다. 이 버전은 Apple 공증 전 프리릴리스입니다.

Finder에서 선택한 동기화 파일은 Mac에 저장된 경우에만 지원 형식의 내용을 읽습니다. 온라인 전용 파일은 이름과 날짜로만 태그하며 내려받지 않습니다. 실제 클라우드 폴더나 온라인 전용 파일로는 테스트하지 않았습니다. 앱 아이콘은 청록색 태그로 바뀌었고, 메뉴 막대의 태그 기호는 그대로입니다. 메뉴 창 높이는 내용에 맞춰 바뀌며 긴 목록은 스크롤할 수 있습니다.

## License

All rights reserved. No open-source license has been granted.
