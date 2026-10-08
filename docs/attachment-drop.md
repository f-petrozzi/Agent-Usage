# Drop files into an agent

![Codex B turning into a violet gravity well during a file drag](images/attachment-gravity.png)

Drop up to five files (8 MB each) onto a Codex, Claude or AGY logo. The
entire notch contracts toward a dark gravity well in that agent's identity color.
The ink and neighboring symbols flow inward while the physical drop targets stay
fixed. Leaving or cancelling restores the notch. Reduced motion uses a static well.

The notch unfolds its existing session lobe with previews, an optional message,
and only that agent's sessions. Select a session before sending; the app never
guesses which VS Code chat is active. No files leave the computer until you choose
**Send to Codex** or **Copy context & open**.

While the notch is visible, hover a logo and press **Ctrl+V**, or right-click it
and choose **Paste screenshot into…**. Screenshot pixels and copied local files are
supported. Windows bitmap clipboard formats have a native fallback. The shortcut
is released when the pointer leaves the logo or the session picker takes focus.
The expanded review also accepts pasted images and dropped files, replacing the draft.

**Send to Codex** transfers the files into a private, uniquely named directory in
the selected session's workspace, then invokes native `codex queue --thread UUID
--message TEXT --image PATH` with that account's `CODEX_HOME`. This does not type
into a shell, create a second terminal or change model permission settings. The
host must have a Codex version supporting `queue`; its help is checked before
transfer. PNG, JPEG and WebP files are sent as native image attachments. Other
files are referenced by their workspace paths. Successful delivery means Codex
confirmed queuing, not that the agent finished reading or responding.

**Copy context & open** works with all three agents: it transfers files, copies
the message and remote paths to the clipboard, and opens the chosen session.
Paste into the agent's composer and send. This is a manual handoff, not a native
image-composer insertion. A failed session opening leaves copied context
available and reports the opening failure separately.

The session picker does not claim to detect the currently active extension chat.
VS Code's public API provides an `activeTerminal` and its process ID, so a future
helper can match it against collector-verified ancestry. An extension-owned chat
panel does not expose its thread through that API. Selecting a known session is
the dependable route across multiple accounts and windows today.

## Implementation and validation

- Immutable, bounded local reads; no folder expansion or filename-derived shell commands.
- Main resolves account/session identity against fresh collector metadata and
  checks the SSH/WSL scope again after the asynchronous history lookup.
- A fixed Python transport program receives JSON through stdin. Files receive
  mode `0600` in a `0700` temporary directory inside the selected workspace.
- Native queue receives exact UUID, account home, workspace and argv. There are
  no permission-bypass flags or terminal keystrokes. Concurrent submission is
  blocked, and an attempted queue cannot be retried from the same draft because
  a failed connection could have lost its delivery receipt.
- Each transfer directory carries its own ignore rule, so attachments do not
  appear as untracked project changes.
- Drafts expire after 15 minutes and are released when the session lobe closes. Transferred
  files remain in the workspace so a queued turn can read them; remove the
  `.agent-usage-drop-*` directories after the agent is done.
- The notch animation uses the existing shared analytic spring scheduler. It
  stops at rest; only its drag-active streams use compositor animation.
- Backend tests execute the remote program against a temporary mock Codex CLI.
  They check exact account, session and image argv, immutable file staging,
  permissions, hostile filenames, unavailable commands and manual handoff.
- Browser tests check all four edges, target switching, cancellation, reduced
  motion, explicit selection for every attachment and reviewed submission.
- A native Electron test checks actual disk-backed File paths across the
  sandboxed preload, screenshot clipboard data, previews and main-process
  delivery routing. Windows CI also exercises native bitmap/file clipboard data,
  physical hover paste, a real OLE file drag and interaction after dropping.

Research used [Electron's file-drop guidance](https://www.electronjs.org/docs/latest/api/web-utils),
its [current asynchronous clipboard API](https://www.electronjs.org/docs/latest/api/clipboard),
the [VS Code extension API](https://code.visualstudio.com/api/references/vscode-api#window.activeTerminal),
and [official OpenAI CLI image documentation](https://learn.chatgpt.com/docs/codex/cli).
`codex queue` was verified through the installed CLI's help; runtime capability
detection is retained because that command is not established by the cited CLI
overview. The design follows Claude Code's local frontend design skill: retain
the existing black material and Segoe UI type, use the blue/violet/orange agent
colors, spend the visual emphasis on the user-triggered gravity well, and keep
the review form quiet, legible and explicit.
