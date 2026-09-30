# Agent Usage

<p><img src="docs/agent-usage.png" width="80" alt="Agent Usage blue ribbon logo"></p>

A hidden-at-startup Windows edge notch for Codex, Claude, and Antigravity usage, reset times,
and banked resets. Hold **Scroll Lock** to reveal it and follow your cursor
around either monitor's edges. Release, then rest the pointer on an agent to peek at its
usage; click it to hold the card open until you click elsewhere (refresh is the card's
own button).
Colored rings show usage consumed; right-click to switch between 5-hour and weekly
readings or change the shortcut.

[Notch controls, G815 setup, and validation](docs/notch.md). Opening Agent Usage
again from Start reveals the existing instance.

<p><img src="docs/expanded.png" width="420" alt="Expanded design"><br><img src="docs/compact.png" width="192" alt="Compact design"></p>
<sub>Previous panel previews; the default interface is now the edge notch.</sub>

## Install

Install the collector on the machine running your agents:

```bash
git clone https://github.com/f-petrozzi/Agent-Usage.git
cd Agent-Usage
scripts/install-agent-usage.sh --force
```

Download **AgentUsage-Setup-&lt;version&gt;.exe** from the
[latest release](https://github.com/f-petrozzi/Agent-Usage/releases/latest) and run it.
It installs per-user without administrator access and migrates a ZIP install in
place. Choose local WSL or an SSH host in Settings → General.

Needs Windows 10/11 and signed-in provider CLIs on the collector machine.
The installer is unsigned, so SmartScreen may ask you to confirm it.

## Update

A dot on the Settings button marks a new release. Choose **Update** in
Settings → General, then **Restart**. On the collector machine, run
`git pull --ff-only && scripts/install-agent-usage.sh --force`.

Claude reads are cached, and HTTP 429 responses trigger a shared cooldown.
The app never opens credentials on Windows. [MIT license](LICENSE).

Codex stream reads frame raw pipe bytes so coalesced notifications and replies do
not cause false timeouts. Regression: `python3 tests/test-codex-stream.py`.

The working arc rotates smoothly on its own small compositor layer. It pauses
when the notch is hidden or that account is collapsed, preserves its phase across
collector updates, and stays still when Windows reduced motion is enabled.

## Alerts and account order (3.1)

Settings → General now offers usage warnings at 80% and 100%, optional alerts when
an agent waits for input or finishes working, and a notification sound. Usage warnings
and finished-working alerts are on by default (3.2.0); waiting and sound are off.

Finished alerts come from each tool's own record of a turn: Claude Code's per-session
status file (busy, waiting, idle), the task_started / task_complete events in a Codex
session rollout, and Antigravity's conversation status while its CLI holds the session.
A turn has to run at least 30 seconds (a quick reply was watched as it happened), a
canceled turn never counts, and the alert says how long it worked.

Alerts appear in the notch, not as Windows toasts. Since 3.2.1 each one grows out of its
account's ring as a sliver of the notch sized to its text (side-edge slivers give it more breathing room): a word in the
colour of what it reports (the usage level, yellow for an agent waiting on you) and the
reading or session, such as "Finished homelab · 14 min". Alerts for several accounts come
out of their own rings together on side edges; top/bottom lifts show accounts in order to keep text from overlapping. A sliver stays about six seconds, longer while the
pointer rests on it; pointing at it counts it as seen, and a click opens the linked Claude or Codex conversation in VS Code. Alerts without a session link open that account's usage, held. An open card comes first: alerts wait for it. The sound is a short chime
made by the app.

The notch keeps them too (3.1.8): the pin's pocket holds more than one control. Point
at the pin and scroll, and it flows back into the notch while a bell buds out of the
same flare; scroll again for the pin. A yellow dot inside a notch corner means an alert you
have not seen yet: one that came and went without being pointed at. Press the bell and the last week of alerts (up to 40)
grows out of that end of the notch, newest first, with the alert switches (Usage,
Waiting, Finished, Sound) along the top. A row opens its linked VS Code conversation, or that account's usage when no link is available; Clear empties the log. The log fits the notch's width on top/bottom edges where readable and stays centered beneath/above it. Side edges retain a compact, top-aligned log. Settings → Appearance → Controls chooses what the pocket holds.
The notch's expansions, alerts included, are liquid while they grow and sharp at rest.

Warnings track each reported quota window, retain their threshold across app
restarts, and rearm when a later reset boundary confirms a new window. The initial
reading establishes a baseline, so starting the app does not send old warnings.
Mute individual accounts with the bell under Settings → Accounts. Drag an account
(or focus it and press Alt+↑/↓) to reorder the notch and tray; the small notch at
the top of the page follows along. Visibility stays independent.

Enable the tray icon under Appearance for account usage, every reported window,
reset countdowns, and stale status, plus a Refresh action.

Completion requires an observed working → explicit idle/turn-ended transition.
Canceled turns, vanished processes, stream failures, initial readings, and
reconnections do not announce completion. “Finished working” means the turn ended,
not that its result was successful. Waiting → idle does not announce completion.
Codex does not expose approval waits in its rollout. Update the collector alongside
the desktop app to enable the new terminal states; older collectors still provide
usage and active/waiting indicators.

## Antigravity

Sign into `agy` with your Google AI Pro account on the collector machine.
The collector automatically adds Antigravity when `agy` is on PATH or installed in `~/.local/bin`, using
`agy -p /usage --output-format json` (requires agy 1.1.11 or later).
It shows measured weekly and five-hour Gemini usage with reset times. Hover the
Antigravity usage title on top/bottom edges to reveal Claude/GPT quotas in the separate extras frame. Side edges show extras and account metadata inside the usage view by default and extend the frame when needed. It does not infer quota from model availability
or label CLI reports with account identity or a plan the CLI does not provide.
Use `--no-antigravity` to skip it. Update the collector alongside the Windows app.

While reading one account, the other gauges become small account glyphs. Hover
a glyph or focus it with the keyboard to switch; leaving restores all gauges.

AGY CLI activity uses its live presence lock and local conversation status database. Active work spins the inner arc; explicit pending questions and reported waiting steps pulse yellow. Idle, canceled, killed, and disconnected conversations clear the indicator. Approval waits that AGY does not expose in its transcript cannot be distinguished from active work.

Claude shows available free limit resets and the soonest expiry instead of the subscription name, as a row of the usage card on every edge (Codex banked resets use the same row). Point at the row and it opens to each reset against its own date and time and how long is left, soonest first, so you can see which to use by when. The collector requests the `cedar_ember` grant block with the newest Claude CLI on the host as its version, since the endpoint only returns resets to a current CLI: over non-interactive SSH, PATH alone found an old npm global in `/usr/bin` and the resets never arrived. It counts usable unpaused grants and never forwards redemption handles. Unsupported or ineligible responses leave the count unknown. Redeem resets in Claude itself.

## Alert refinements (3.2.4)

Claude completion timing retains the beginning of a continuous busy stretch, even when Claude Code rewrites its status timestamp during tool activity. The explicit idle timestamp ends the duration. The 30-second minimum and cancellation/disconnection rules remain.

Waiting/completion notifications and alert rows link to VS Code. Working/Waiting session text in account details is clickable too. Version 3.2.5 launches the installed Code executable directly and installs the bundled Agent Usage Link helper on the first terminal-linked click. The collector supplies process ancestry from `/proc` metadata, without reading process environments or terminal contents. In the focused matching workspace, the helper matches those ids against VS Code's existing terminals and focuses the right tab without sending text or starting a terminal. Remote SSH/WSL workspaces must expose the collector's Linux shell ids; a local Windows terminal launching WSL may expose only a Windows wrapper pid.

If the terminal has closed, Claude's session URI focuses/resumes its conversation and Codex opens its conversation view; no prompt is submitted. The renderer supplies only a logged alert id or account/session id, and the desktop resolves it against stored/current sessions. Older completion rows try a bounded metadata-only history query: provider/account/name and one recorded turn end within 15 seconds of the alert. Missing/ambiguous historical links, including old waiting rows that cannot be reconstructed, and launch failures display an explanation. Usage alerts and unsupported providers still open account usage. Windows focus, first-click helper installation and remote terminal PID correspondence need a device check.

Side-edge slivers are thicker; top/bottom notifications make a smooth, text-sized lift rooted at their gauge and clamped to the notch width, with status and detail on two lines. The Alerts panel follows the notch width on top/bottom edges (a measured minimum for all four switches on one row), centered on it; side edges use a panel at least 228px wide and keep its top alignment. Rows stack status and details below the account/time to fit the compact width. The unread dot sits in an existing bezel corner and shrinks away during a pocket swap, then appears on the revealed bell; the pin never carries a badge. All native hover tooltips are removed from the notch and Settings; accessible control labels remain.

Validation: 31 desktop regression checks, 13 collector session checks, notification and bell browser checks including session clicks, all four edges, reduced motion, sound and alert holding. Browser screenshots use synthetic snapshots. Update the installed collector as well as the Windows app to carry session links.

## Session links and alert controls (3.2.5)

Notification corners share the notch's 20px radius. Top/bottom lifts reserve curved shoulders inside the notch's rounded ends, including for corner accounts, with two centered text lines.

Side notifications stop growing at the default 228px notch length. Overflowing detail text scrolls slowly after a pause while its status remains still, including on top/bottom edges. The alert stays long enough for one pass. Reduced motion keeps the text stationary.

The four alert switches never wrap. Account details retain session ids and render Working/Waiting rows as keyboard-accessible buttons. `vscode-link/` is a small UI extension using `Terminal.processId` and `Terminal.show(false)`; `scripts/package-vscode-link.py` produces the dependency-free VSIX bundled with the installer. `desktop/session-open.cjs` installs it through Code's CLI, then launches a fixed URI built from validated session/process identities. Standard user/system Code install locations are checked before a registered-protocol fallback. Keep the matching workspace open in the focused window; the helper does not switch workspaces automatically.

Validation: 36 desktop regression checks, 15 collector checks, notification and bell browser checks on every edge including single-row controls, old-link errors and Working clicks. Helper/launcher tests cover terminal selection, installation, direct Code launch, fallback and invalid targets. Update the collector alongside the Windows app. Actual Windows focus and first-click installation need a device check.

## Notification testing and history (3.2.6)

Settings → Accounts has a Test notification button for each account. One sample stays visible until turned off, replaced by another account's test, or Settings closes. Hidden accounts receive a temporary gauge without changing their saved visibility. Samples use the normal notification shape and scrolling, without sound, history entries or session links.

The bell history scrolls within a 228px list while the heading and switches remain visible. All 40 retained alerts are reachable; refreshes preserve the list's scroll position. Helper installation follows the installed Code CLI wrapper, clears its development flag and allows 60 seconds. Failures include the underlying installer reason. The Windows workflow installs the packaged VSIX through real Code from Electron using isolated settings/extensions before publishing. SSH terminal focus still requires the matching remote workspace to be open.

Validation: 37 desktop checks; browser checks cover history wheel scrolling on every edge, preserved scroll position, per-account testing, hidden-account restoration and reduced motion.
