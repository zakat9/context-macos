# Context for Mac: tag Apple Notes, Mail and files for AI drafts

[한국어 빠른 시작](#한국어-빠른-시작)

**Bring the right sources to your AI conversation.** Tag a note, an email, or a saved file while it’s in front of you. Later, look up that tag and copy the sources you choose, with their dates and citations. Context reads the current saved version. It doesn’t edit the original or send a message for you.

**[Download for Apple silicon](https://github.com/zakat9/context-macos/releases/download/v0.12.0/Context-0.12.0-macOS-arm64-adhoc.zip)** · [Build from source](https://github.com/zakat9/context-macos/releases/download/v0.12.0/Context-0.12.0-source.zip) · [Release notes](https://github.com/zakat9/context-macos/releases/tag/v0.12.0)

**0.12.0 prerelease.** The prebuilt app is not notarized. See [Install](#install) before opening it.

## A quick tour

Suppose a supplier emails a revised quote and confirms the lead time on a call. The price is in Mail; the call notes are in Notes. Give both the tag **Quote** and you can bring them back together without searching two apps.

| 1. Tag the note you’re looking at | 2. Choose the sources for your draft |
| :--- | :--- |
| <img src="https://github.com/user-attachments/assets/d67ba7c3-f79f-4987-8e06-f01dfa3110da" width="352" alt="Selected item shows the supplier call note with its Quote tag and an Add another tag field."> | <img src="https://github.com/user-attachments/assets/0024dd1b-b9ad-4401-a4f7-037672a931a0" width="352" alt="Find context shows the revised quote email and the supplier call note checked, with a Copy 2 sources button."> |
| **Selected item** tells you exactly what you’re tagging. The tag lives in Context, not in the note. | **Find context** lists sources by their own dates, oldest first. Open a row to preview it; untick anything you don’t want to share. |

*The two screens show the 0.12 interface rendered in a browser with fictional sources, not a live Mail or Notes session.*

## Install

- **Apple silicon:** Download the app ZIP above, unzip it, move **Context.app** to your Applications folder, and open it. Look for the **tag icon in the macOS menu bar**. This build is ad-hoc signed: Gatekeeper may block it. Building from source is recommended; [release notes and checksums](https://github.com/zakat9/context-macos/releases/tag/v0.12.0) are available before you install.
- **Build it yourself:** Download the **versioned source ZIP** above (not GitHub’s automatic “Source code” archive). With Apple’s Command Line Tools installed, open Terminal in the extracted project folder and run:

```bash
cd app
bash build.sh install
open ~/Applications/Context.app
```

## Try it with one note

1. **Connect Notes.** Open a sample note. Click the menu bar tag icon → **App access**, select **Notes**, then **Request selected**. macOS asks separately for each selected app.
2. **Tag it.** With the note in front, click the tag icon again. Check the title under **Selected item**, type `Quote` in **Add a tag**, and press **Return**. If the tag is already under **Tag as**, just click it. You can add up to two tags per item.
3. **Use it.** Under **Find context**, select `Quote`. Click a source row to see exactly what will be copied. Leave the sources you want checked, press **Copy**, and paste into your AI draft. No extension is needed for this path.

Try asking: *“What price did the supplier quote, what lead time did they confirm, and was the quote approved? Cite the email or note for each answer.”* If a source changed since the list was shown, look it up again before copying.

## Three useful controls

| When you want to… | Where to go | What happens |
| :--- | :--- | :--- |
| Tag a file or note without reaching for the menu bar | **Settings → Shortcuts → Tag current item** | Choose **Use ⌃⌥T** (Control–Option–T) or record your own. With one supported item selected, the shortcut opens its tag editor. Off by default. |
| Rename a tag everywhere | **Manage tags → select a tag** | Enter the new name and review the source count. Choose **Rename**, or **Merge** if that tag already exists. An item with both keeps one; no original file changes. |
| Skip manual copy and paste in a ChatGPT draft | **Settings → Insert context → Set up for Google Chrome** | The optional extension inserts at the caret. You still review the draft and press Send yourself. Setup below. |

<details><summary><strong>Set up Insert context in Chrome</strong></summary>

1. In Context, choose **Set up for Google Chrome**, then **Show extension**.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder Context showed you.
3. In `chrome://extensions/shortcuts`, assign a key to **Insert context at the caret**. This is separate from the Mac tagging shortcut.
4. At `chatgpt.com`, click in the draft, press that key, choose a tag, review the selected sources, and press **Insert**. If you changed chats, moved the caret, or edited the draft, Context refuses to insert. Use **Copy instead** if needed.

Tested in Chromium against a fictional chat page, not the live ChatGPT editor. For other AI apps, use **Copy** and paste.

</details>

## What you can bring into a draft

| Source | What Context can include |
| :--- | :--- |
| Apple Notes, Apple Mail, saved `.eml` messages | Text plus source details. Notes and Mail need Automation access. |
| Excel `.xlsx` / `.xlsm`, CSV, Markdown and plain-text files | Saved sheet and cell values, or file text, with a source reference. |
| PDF, Word, PowerPoint and iWork documents | Taggable by name and date. Their document text is **not** extracted. |

Files over 40 MB are listed but not read. Web pages cannot be tagged. Looking up a tag in the popover can open Notes or Mail and trigger a macOS permission prompt; the menu bar label and tagging shortcut do not.

**Privacy:** Context keeps a local index of tags and source references, not a library of document copies or past versions. It makes no network requests. When you copy or insert text into another app, review that draft before sending it.

**Release status:** The Apple silicon build passed 45/45 Mac self-checks. Hands-on menu bar, permission, and live ChatGPT workflows are still unverified. See the [prerelease notes](https://github.com/zakat9/context-macos/releases/tag/v0.12.0) for test coverage and limitations.

## 한국어 빠른 시작

맥에서 **애플 메모, 메일, 엑셀 파일을 ChatGPT 질문에 참고 자료로 넣고 싶을 때** 쓰는 메뉴 막대 앱이야. 예를 들어 견적 메일과 공급사 통화 메모에 같은 태그를 붙여 두면, 나중에 두 앱을 따로 검색하지 않고 견적 금액과 납기 근거를 함께 찾을 수 있어.

1. 샘플 메모를 열고 메뉴 막대의 태그 아이콘을 눌러. **App access**에서 Notes를 선택하고 **Request selected**로 접근을 허용해.
2. 메모 제목을 확인한 뒤 **Add a tag**에 `견적`을 입력하고 Return을 눌러. 관련 메일이나 저장된 파일에도 같은 태그를 붙여.
3. **Find context**에서 `견적`을 찾아 필요한 자료만 체크하고 **Copy**를 눌러. ChatGPT 또는 다른 AI 초안에 붙여넣으면 출처와 날짜가 함께 들어가. 전송은 직접 해.

태그는 원본이 아닌 Mac의 로컬 색인에만 저장돼. PDF·Word는 이름과 날짜만 제공해. 선택형 Chrome 확장의 직접 삽입은 실제 ChatGPT에서 아직 검증되지 않았고, 현재 배포본은 Apple 공증 전 프리릴리스야.
