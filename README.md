# Agent Usage

A hidden-at-startup Windows edge notch for Codex, Claude, and Antigravity usage, reset times,
and banked resets. Hold **Scroll Lock** to reveal it and follow your cursor
around either monitor's edges. Release, then hover an agent for scrollable details.
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
an agent waits for input or finishes working, a five-second notch reveal for agent
alerts, and notification sound. Usage warnings are enabled by default; waiting,
completion and sound are off. Windows notification settings control toast delivery.

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

Claude extras show available free limit resets and their expiry instead of the subscription name. The collector requests the `cedar_ember` grant block with the installed Claude CLI version, counts usable unpaused grants, and never forwards redemption handles. Unsupported or ineligible responses leave the count unknown. Redeem resets in Claude itself.
