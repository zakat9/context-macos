# Checks that need a Mac and a person

Steps A.1 and A.2 have been run on one Mac for this release (see the release notes). Everything else needs a person at a
Mac and is unverified. Use fictional notes, messages and files. Tick each line as you see it; anything that
does not happen as written is a defect to report with the line's letter and number.

## A. Build

1. `cd app && ./build.sh` finishes without a compiler error (Swift 5 mode, macOS 12 or later).
2. The self-test prints every check as PASS, including the lines that start "label rules:", "Insert context rules:" and "hot key:", and ends with `== N/N self-test checks passed ==`. One line starts NOTE (macOS's answer to a trial hot key registration; 0 means it accepted it). A line that starts `NOT RUN` means the hot key part could not run, which happens when the build runs without a login session (over ssh or from a background service): run it again from Terminal.
3. Starting a second copy while one is running leaves one tag icon in the menu bar, not two.

## B. The menu-bar label

1. With a browser in front the tag icon is dimmed. Hovering says there is nothing to tag in this app.
2. Select one tagged note in Notes: within a moment the icon is filled and the tag names follow it. Hover shows the full names and the note's title.
3. Select an untagged note: the icon is outlined, no text. Is it clearly different from the dimmed icon in step 1?
4. Select two notes: dimmed, and the tooltip says to select exactly one.
5. Move quickly between notes: does the label keep up (expected: within about half a second while you are moving, up to about 2 s after a quiet minute)?
6. Switch between Notes, Mail and Finder with Command-Tab, quickly: no wrong tag is left standing in the bar.
7. Tag an item in the popover: the label changes while the popover is still open.
8. Rename a tagged file in Finder: its tags stop showing. Rename it back: they return.
9. Save an untitled TextEdit document that you then tag; "Save As" to a new name: the new file shows no tags.
10. An app that was never requested in App access: bringing it to the front causes **no macOS prompt**, however long it stays in front. The icon is dimmed and the tooltip points to App access.
11. Quit Notes while it is in front: Notes does not reopen by itself.
12. Clicking the dimmed icon still opens the popover.
13. Typing in any app is unaffected; Context never takes the keyboard unless you click it.
14. Activity Monitor with Notes in front and nothing changing: Context's CPU and energy impact (expected: one small question every 2 s). Note the numbers.
15. With many items in the menu bar, or on a notched display: is the label hidden by the system? (Expected: possible; the item is then reachable only when there is room.)
16. VoiceOver on the item reads "Context", the tags, and what is selected.

## C. App access

1. First start with no `~/WorkIndex/index.json` and nothing allowed: the window appears, 360 × 338, open apps ticked.
2. "Request selected": one macOS prompt per ticked app, one at a time, each naming Context and the app. The window names the app being asked.
3. "Don't Allow" on one: its row reads "Not allowed" with a "Settings…" button, which opens Privacy & Security › Automation.
4. Switch that app on in Settings and click the window: the row reads "Allowed" without a new prompt.
5. Tick a closed app and request: it opens **behind** the window, then its prompt appears.
6. Stop during a prompt: after you answer it, no further prompt appears.
7. Return presses "Request selected"; Escape closes; arrow keys move along the rows; Space ticks.
8. Start Context again later: the window does not appear. "App access" at the bottom of the popover opens it.
9. Does the page look right in the window (fonts, tick boxes, no scroll bar with six apps)?

## D. Tagging in the popover

1. Click the icon with one note selected: the popover names the note, the app and its date, and the keyboard is in the tag field.
2. Type a name, Return: tagged at once. Escape: the popover closes and the keyboard is back in Notes.
3. Press a recent tag: tagged with one click. × removes with one click.
4. With the Korean input method, type a name and press Return while the last syllable is still open: the whole word is tagged once and nothing stays in the field. (If the first Return only closes the syllable and the second tags, that is acceptable; a half word, a doubled syllable or two tags is a defect.)
5. Select another note while the popover is open (it normally closes; if you can keep it open, press a recent tag): nothing is tagged.
6. An app that is not allowed: the popover says so and "Open Automation settings" opens the pane.
7. A long Korean subject takes two lines at most.

## E. Looking up and copying

1. Look a tag up: the tagging block folds to one line and the list shows four sources and the top of a fifth.
2. Tagged notes and messages are listed with their current text and their own dates; a deleted file is listed as unavailable.
3. Arrow keys, Space, → and ← work in the list; Command-Return copies.
4. Save a listed workbook again, then Copy: nothing is copied; the row is marked Changed.
5. Paste into a text editor: only the ticked sources are there.

## F. Clients (live)

1. Paste the copied text into an AI chat of your choice with a question; compare the answer with the sources.
2. No AI chat looks a tag up directly; Copy context (or Insert context, part G) is the route.

## G. Insert context (0.12; needs Google Chrome; fictional sources only)

1. Settings › Insert context reads "Off". "Set up for Google Chrome": it reads "On for Google Chrome" and shows three steps. `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/local.workindex.composer.json` exists and names Context's executable; `~/WorkIndex/composer/extension` exists.
2. `chrome://extensions`, Developer mode, Load unpacked, that folder: "Context: Insert context" appears with the ID `oendmnmglkecffebbhkecfhobmphjapb` and no error. Its permissions: chatgpt.com, and talking to a local application.
3. `chrome://extensions/shortcuts`: no key is set for it. Set one.
4. On any other site the key opens the picker, which says there is no ChatGPT message box here; Insert is off.
5. On chatgpt.com, in a new chat (do not press Send): type a few words, press the key. The picker says "Into the ChatGPT message box, at the caret". Choose a tag: its sources are listed by title. Insert: the text arrives once, at the caret, your words unchanged; nothing is sent. Paste elsewhere: the clipboard still holds what it held before.
6. Caret in the middle of a draft with Korean and an emoji: the text before and after is unchanged.
7. Open the picker, switch to another chat in the sidebar, press Insert: nothing is inserted; it says the chat changed. "Copy instead" copies only when pressed.
8. Quit Context, open the picker: it says the Context Mac app is not running.
9. With that picker still open, start Context: it starts and stays (one tag icon). Open the picker again: tags are listed.
10. Notes closed, or Mail never allowed: their sources are listed as unavailable with that reason. Notes does not open. No macOS prompt appears.
11. Activity Monitor while the picker is open: a second `WorkIndex` process (the helper) with no Dock icon and no menu-bar item; it ends when the picker closes.
12. `lsof -nP -iTCP -sTCP:LISTEN | grep -i workindex` prints nothing: no port is open.
13. Settings › Turn off: the registration file is gone; the picker says Context is not connected.
14. Other… with Edge, Brave, Chromium or another Chromium-family browser: does setup find the folder, does the extension load, does the picker reach Context? Report per browser. None of this has been tried.

## H. Tag current item (0.12)

1. Settings › Shortcuts reads "Not set". ⌃⌥T in Notes does nothing.
2. "Use ⌃⌥T": it reads ⌃⌥T. Also try Set… and press a chord yourself: do the keys reach the window, and is the chord shown correctly?
3. In Notes with one note selected, press the chord: the popover opens under the menu-bar icon with that note's title and tags, the caret in the tag field.
4. Type a name, Return: tagged; the menu-bar label follows.
5. The same with a Korean name (see D4).
6. Escape: the popover closes and the keyboard is back in Notes.
7. With a browser in front, the chord does nothing from Context and keeps whatever meaning it has there.
8. With Context's Settings window or popover in front, the chord does nothing.
9. An unsaved TextEdit document in front: the editor says to save first; nothing can be tagged.
10. Two notes selected: it says to select exactly one.
11. An app never requested in App access: pressing the chord causes **no macOS prompt**; the editor says Context has not been allowed to ask it yet and offers App access.
12. Change… to another chord: the old one is dead, the new one works. Try one that macOS uses itself (for example your input-source or Spotlight shortcut, if it has Control or Option): refused, and the old chord still works.
13. If another app of yours has a global hot key, try that chord: note what the window says and which app reacts.
14. Clear: the chord does nothing. Quit and start Context: the setting is as you left it.
15. Context does not appear under Privacy & Security › Input Monitoring or Accessibility and never asks for either.

## I. Manage tags › Rename everywhere (0.12; use made-up tags, or copy `~/WorkIndex/index.json` first)

1. Manage tags lists each tag with its number of sources; typing narrows the list.
2. Rename to a new name: the numbers are shown first; after Rename, a selected source's menu-bar label shows the new name.
3. Merge into an existing tag: a source that had both shows it once.
4. Cancel: `index.json` keeps its date.
5. Quit and start Context: the rename is still there.
6. The notes, messages and files themselves keep their dates.

