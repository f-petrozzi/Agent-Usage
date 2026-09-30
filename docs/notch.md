# Windows notch - Electron 3.0.0

This build adopts CodeNotch's actual Windows HTML/SVG notch, rings, hover cards,
and settings layout. Chromium draws text at the monitor's native resolution;
it no longer scales the C# prototype's bitmap. The notch stays solid black.

Run **AgentUsage-Setup-3.0.0.exe** once to migrate the ZIP install in place.
Settings and collector configuration are retained. The installer is per-user
and does not request administrator access. Future published releases appear
in Settings as **Update**, followed by **Restart** after download. A small dot
on Settings indicates an available update when the notch is visible. No updates
are downloaded or installed without those actions.

Every launch starts invisible, without a taskbar button or tray icon by default.
Hold **Ctrl+Shift+Space** to reveal and follow the closest monitor edge. Motion
travels around the perimeter; changing monitors retracts then reveals the notch.
Release to stop tracking, then hover within 1.8 seconds to inspect. Hover keeps
it open. Leaving dismisses it after a short grace period. **Escape** hides it.
Right-click for **Pin here**, Refresh, Settings, Hide, or Quit. Pinning lasts for
this session. Reopening Agent Usage from Start reveals the existing instance.

Hover an agent for usage, reset times, banked resets and their expirations,
credits, and collector errors. Wheel over the card to scroll; wheel over the
notch to browse accounts when they do not all fit. Rings show **usage consumed**.
Settings controls which accounts appear, size, weekly-ring placement, color
transition, monitor, edge, sign-in startup, optional tray icon, and collector.
Theme affects Settings; the notch retains its black cutout appearance.

## G815

First verify holding the physical Ctrl+Shift+Space keys. In Logitech G HUB,
assign the chosen G-key to a held shortcut. F13/F14/F15 are available in
**Settings → General → Held shortcut** if your G HUB assignment supports them.
For Ctrl+Shift+Space, use a sequence with Ctrl down, Shift down, Space down on
press; Space up, Shift up, Ctrl up on release. Leave the holding section empty.
The intended result is one continuous hold, not repeated taps. G HUB labels
vary; the actual keyboard behavior and appearance are for your Windows trial.

## Collector and settings

Install `scripts/install-agent-usage.sh` on the machine running your agents.
Choose WSL or SSH in Settings → General. SSH uses the Windows OpenSSH client
and key authentication. No provider credentials enter the renderer. The app
keeps the last successful snapshot when a refresh fails and backs off retries.
Settings live at `%APPDATA%\Agent Usage\settings.json`; the migrated app stays at
`%LOCALAPPDATA%\AgentUsage`. Sign-in startup can be changed in Settings. Uninstall
using Windows Installed apps; collector data and settings are retained.

Session arcs (3.0.2) come from one long-lived `agent-usage --watch-sessions`
over the same WSL or SSH route. A white arc spins while an agent works; a
yellow ring pulses while Claude waits on you, and the card lists each session.
Claude state is Claude Code's own `~/.claude/sessions/<pid>.json`, so no hooks
are installed. Codex state is the open turn in each profile's rollout; Codex
does not record approval waits, so it only ever shows working. A collector older
than 3.0.2 leaves the arcs off until you reinstall it.

## Build and review scope

Dependencies are pinned in `desktop/package-lock.json`. Compile
`desktop/InputMonitor.cs` with the .NET Framework C# compiler to
`desktop/resources/InputMonitor.exe`, run `npm ci` and `npm run pack:windows`
in `desktop/`, then `python3 scripts/package-release.py`. The GitHub Windows
workflow performs compilation, installer parsing, and packaging.

The small helper polls only the configured shortcut, Escape, and left mouse
button; it does not record text. The renderer is sandboxed with context
isolation, no Node integration, a restrictive content policy, no network access,
and validated IPC. Local authentication, hooks, screen capture, and upstream
provider updaters are not included. No upstream build/install scripts were executed.

Frontend source: `vinzdg/codenotch`, commit
`00833690311067354c77951fcaaf6ffca774916e`; licenses and glyph notices are in
`desktop/vendor/`. The preliminary injection scan and targeted review found no
obvious malicious instructions. This is not a guarantee that all dependencies
are vulnerability-free. Validation is limited to syntax/compile/package checks;
Windows behavior, G815 input, mixed-DPI monitors, and visual polish await your trial.
The C# prototype in `windows/Notch*.cs` is retained but not shipped as the app.

## Preview 0.2.1 refinements

The sliders button opens Settings. Hold the four-arrow move button and drag to
reposition, then release to drop. Both controls have full square hit regions
and a Windows input-helper fallback for overlays that do not receive clicks.

Since 3.0.7 the notch's black, its flares and its resting arms are drawn as SVG
(`desktop/ui/shape.js`), so they can move like liquid, using the Mac's "goo":
the black is blurred and cut back at half strength, so shapes close together
melt into one body. The notch wells out of the screen edge on the Mac's unfold
spring, and the arms then bud out of its flares as drops and let go. Closing,
the arms go back in and the notch slides away past the edge. Carried round a
corner while the shortcut is held, it is two parts, the one leaving shortening
and the one arriving growing, gooed into one round body in the bend, with the
rings carried round on a curve and passing through the bend inside the black.
Grabbing the six dots draws the arms and buttons back into the notch until you
let go. The notch window is shown once and parked off every screen when
closed, so opening only moves it: Windows zooms a window in from its middle
whenever it is shown, which made the notch float in to the edge. It is raised
above the taskbar when it opens and every two seconds while open. It is 70 px
deep and 228 long on every edge; lying flat, each reading sits under its ring,
set tight, with the side edges' spacing. The Settings and Move handles rest as
arms in the flare pockets and become a gear and six dots under the pointer. Pin
and Refresh sit at the end of the notch; Settings → Appearance → Controls hides
either, and the move handle. The card eases out of the notch, and a ring eases
to a new reading.

Cards keep usage and resets visible; hover Account details to expand credits,
banked resets, expiration dates, and plan information. Click also toggles it.
The gauge sweeps briefly on reveal and turns once when you request a refresh.
Text and provider glyphs remain still, and reduced-motion preferences disable
these animations. Movement uses transforms with pixel snapping when settled;
unchanged pointer positions and hit regions no longer trigger redundant IPC.

## Release workflow

`desktop/updates.cjs` uses pinned electron-updater with the public GitHub release
feed for `f-petrozzi/Agent-Usage`. Checks run after 30 seconds, then every six
hours. Prereleases, downgrades, web installers, automatic downloads, and automatic
installation on quit are disabled. The Electron updater uses a separate network
session; renderer network access remains blocked. The downloaded installer is
checked against the SHA-512 in the release metadata. This preview is unsigned;
checksums and HTTPS are not an Authenticode publisher signature.

The NSIS include migrates the ZIP install, removes obsolete launch shortcuts,
and preserves settings. `installer-managed` enables updates only after installer
setup. Unpacked builds cannot update themselves.

Build with `npm run pack:windows`, then `python3 scripts/package-release.py`.
This stages the setup EXE, blockmap, latest.yml, and checksums without publishing.
On Linux, NSIS needs system Wine: run `npm run pack:windows` inside the
`electronuserland/builder:wine` image as your own uid. electron-builder's
downloadable Wine 11 toolset ships without its PE DLLs and cannot start.
The Windows workflow builds the same artifacts. A pushed `v<package version>`
tag publishes the complete artifact set through a draft release, then makes it
visible. Branch builds only create workflow artifacts. All update metadata must
come from the same build as the installer. Release files belong in GitHub Releases,
not the source repository. The version starts at 3.0.0 to supersede the existing
2.1.x public releases and the 0.2.x local Electron previews.

## 3.1 alerts and tray

General contains global usage, waiting, completion and sound switches. Alerts open
out of the notch itself, from the account's ring, instead of as Windows toasts.
The bell at the end of the rings keeps a week of them, with the same switches.
Accounts contains per-account usage-warning bells and drag (or Alt+↑/↓) ordering.
The tray menu follows the visible account order and includes all quota windows,
reset countdowns, and stale/error labels.

The collector feed includes terminal states for alert evaluation; only working
and waiting states reach the animated activity UI. Stable session ids connect
transitions, and a broken feed discards the previous baseline. Codex completion
uses `task_complete`; `turn_aborted` is a separate canceled state. Claude idle
requires a matching live process; Antigravity idle requires a live presence lock
and excludes killed conversations. No hooks or screen capture are installed.

Regression checks: `node --test tests/test-alerts.cjs tests/test-session-feed.cjs`
and `python3 tests/test-sessions.py`. Browser settings interactions:
`PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/settings-alerts.cjs`.

## Smooth activity arc (3.1.1)

The white arc rotates a 44 px HTML layer with a continuous linear CSS transform
(one revolution per 1.2 seconds). Its SVG geometry stays fixed; `will-change` lets
Chromium composite the small rasterized layer rather than repaint a rotating SVG
group across the transparent overlay. Hidden and collapsed accounts pause it,
and reduced motion removes the animation. Collector updates retain the activity
node while its state is unchanged, preserving the rotation phase.

`PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/activity-spin.cjs` checks
frame-by-frame rotation, Chromium layer promotion, phase continuity, hidden and
compact pauses, waiting/idle transitions, and reduced motion. A headless Chromium
run measured 61 frames/second; Windows compositor and mixed-refresh behavior still
need an on-device check.
