# Windows notch - Electron 3.0.0

This build adopts CodeNotch's actual Windows HTML/SVG notch, rings, hover cards,
and settings layout. Chromium draws text at the monitor's native resolution;
it no longer scales the C# prototype's bitmap. The notch stays solid black.

Run **AgentUsage-Setup-3.0.0.exe** once to migrate the ZIP install in place.
Settings and collector configuration are retained. The installer is per-user
and does not request administrator access. Future published releases appear
in Settings as **Update**, followed by **Restart** after download. A pulsing blue dot
on the notch indicates an available update; hover it to reveal Download or Restart. No updates
are downloaded or installed without those actions.

Every launch starts invisible, without a taskbar button or tray icon by default.
Hold **Ctrl+Shift+Space** to reveal and follow the closest monitor edge. Motion
travels around the perimeter; changing monitors retracts then reveals the notch.
Release to stop tracking, then hover within 1.8 seconds to inspect. Hover keeps
it open. Leaving dismisses it after a short grace period. **Escape** hides it.
Right-click for **Pin here**, Refresh, Settings, Hide, or Quit. Pinning lasts for
this session. Reopening Agent Usage from Start reveals the existing instance.

Rest on an agent to peek at its usage (3.1.11): rings crossed on the way are passed by,
and a peek closes 0.3 s after the pointer leaves. Click the ring, the card or the bell to
hold it: held cards ignore rings passed over and close on a click outside, on their
own trigger again, or 1.5 s after the pointer leaves (never, with the notch kept on
screen). Refresh is a button on the card's title row. The notch retracts only once its
card has closed. The card shows usage, reset times, banked resets and their expirations,
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
feed for `f-petrozzi/Agent-Usage`. A check runs after 30 seconds at startup. Afterwards, a persistent HTTPS
JSON stream from ntfy.sh receives signed release notices and triggers a check
of that same trusted feed. Reconnection catches missed releases, throttled to
one catch-up check per 15 minutes when a connection flaps; there is no recurring
release-feed polling. Prereleases, downgrades, web installers, automatic downloads, and automatic
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
visible. The release job then signs its repository, stable version, tag and timestamp
with the Ed25519 key stored in `AGENT_USAGE_RELEASE_PUSH_KEY` and posts them to
ntfy.sh. The app embeds only the public verification key; unsigned, modified,
other-repository, duplicate and older notices cannot trigger a release check.
The relay receives release metadata only, never sessions, accounts or credentials.
Notice URLs cannot override the updater feed. Keep the existing verification key
when changing the publisher; replacing it requires a planned app migration.
Branch builds only create workflow artifacts. All update metadata must
come from the same build as the installer. Release files belong in GitHub Releases,
not the source repository. The version starts at 3.0.0 to supersede the existing
2.1.x public releases and the 0.2.x local Electron previews.

## 3.1 alerts and tray

General contains global usage, waiting, completion and sound switches. Alerts open
out of the notch itself, from the account's ring, instead of as Windows toasts.
Scroll over the pin to reach the bell, which keeps a week of them with the same switches.
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

## Alert layout and links (3.2.4)

In 3.2.5, notification corners use the notch's 20px radius. Top/bottom joins keep both curved shoulders inside the notch's rounded ends, so end accounts do not protrude from the corner.

Notification length is capped at the default 228px notch length. Long details pan at 24px/second with pauses at each end; status words remain still, and the alert stays for at least one pass. Top/bottom details pan within their two-line lift too. Reduced motion disables panning.

The alert log follows the notch width on top/bottom edges with a measured minimum for four controls, centered above/below the notch. On side edges it is at least 228px wide and starts at the notch's top. Side-edge notification slivers are 54px thick before the text inset. Top/bottom notifications lift a text-sized, rounded area from their gauge with two centered lines. Its body and root flares stay within the notch width even for end accounts. Flat-edge alerts show accounts in order so their text never overlaps. Native tooltips are disabled throughout the notch and Settings; ARIA labels remain.

Claude busy-state timestamp rewrites no longer shorten the measured turn. Session UUIDs accompany Claude and Codex waiting/completion alerts and survive log reloads. In 3.2.5, a sliver/log-row click or pressing Working/Waiting session text launches VS Code directly through its installed executable where available. The card measures the total control width so Usage, Waiting, Finished and Sound remain on one row.

The bundled Agent Usage Link helper is installed on the first terminal-linked click when Code does not already list its version (3.3.2). In the focused matching workspace, it matches collector process ancestry to `Terminal.processId` and focuses the existing tab through `Terminal.show(false)`. It never sends text or starts a terminal/turn. A closed terminal falls back to the provider's conversation URI. Remote SSH/WSL workspace shell ids must correspond to the collector; a local Windows terminal running WSL can expose only a wrapper pid. See [VS Code terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal), [Claude's session URI contract](https://code.claude.com/docs/en/vs-code#launch-a-vs-code-tab-from-other-tools), and [Codex URI limitations](https://github.com/openai/codex/issues/35694).

Old completion rows try a bounded `--session-links` query, matching account, name and one recorded turn end within 15 seconds of the alert. The query exports no message bodies. Missing/ambiguous links and launch failures display an explanation. Update the collector for historical recovery and terminal identities. Actual Windows focus and first-click VSIX installation require a device check.

The unread dot rests in the notch's leading front corner (see 3.3.1). During a pocket swap it shrinks there, then appears on the revealed bell. Returning to the pin restores the corner dot; the pin never carries it. Reduced motion makes these changes immediate.

## History scrolling and notification tests (3.2.6)

The history list is capped at 228px and scrolls below the fixed title/switches. All 40 retained alerts appear, and refreshes preserve the scroll position. Wheel events over a card never swap the bell/pin pocket.

Settings → Accounts includes a Test notification toggle for each account. A single persistent completion sample uses the regular sliver; choosing another account replaces it. Tests do not chime, write history or link to a real session. Hidden accounts appear temporarily during their test. Turning it off or closing Settings removes the preview and restores saved visibility.

The helper installer resolves the Code CLI entrypoint from `bin/code.cmd`, clears `VSCODE_DEV` as the official wrapper does, verifies the bundled file exists, and waits up to 60 seconds. Errors retain the actual installer reason. The Windows release workflow now installs the packaged helper into isolated Code data/extensions through Electron before publishing.

## Account-shaped lifts and monitor relocation (3.2.8)

Side-edge bands are at least 76px tall and centered on the entire gauge/percentage cell. Flat-edge roots follow physical account-section boundaries; the outside accounts taper from the full left/right flank, while middle accounts inflate from a centered neck. Their 128–160px bodies retain two text lines and 20px corners. Curves meet the notch front on a horizontal tangent, and the whole lift stays within its width.

The bell history, main card and extras card use custom 6px scrollbars: transparent track/corner, dark rounded thumb, brighter hover and no arrow buttons. The notch always uses its dark surface colors.

`switchMonitor` makes the native window transparent and disables hit testing before changing bounds. Layout events carry a placement serial. The renderer hides the old layout, snaps synchronously, waits for its CSS viewport to match display dimensions divided by app scale and two animation frames, then sends `monitor_placed`. Main accepts only the latest serial from the notch renderer and reveals it at the destination. Settings, hotkey transfers and display removal/metrics changes use this path. The ordinary edge motion remains animated.

Regression checks: `tests/test-monitor.cjs` covers native mask/move/reveal ordering, stale and Settings acknowledgments, pointer placement and hidden relocations. Browser notification, bell and motion suites cover physical account roots, theme/scroll behavior, resized and same-sized destination viewports and superseded placement. Multi-monitor Windows composition and mixed DPI need an on-device trial.

## Equal account sections and rectangular popouts (3.2.9)

Notifications use one rounded-rectangle SVG path with the notch's 20px corner radius and a 20px overlap into its front. Side-edge geometry divides the full notch height by the number of displayed cells, assigns each rectangle its physical top-to-bottom section, and keeps that height throughout growth. No root flares extend beyond the partition. Left-edge reversed account order is handled by sorting physical coordinates.

Top/bottom bodies are 128–160px wide, bounded by the notch width. The physical first/last accounts align exactly to the left/right notch edges. Interior centers interpolate 65% of the distance from the notch center to their account center, so they stay on the appropriate side while sitting closer to the middle. Text retains two lines and overflow panning.

Hidden `reveal` now uses `switchMonitor`, selecting the monitor and pointer edge before a single destination layout is sent. Opacity is zero before changing native bounds and remains zero until the placement acknowledgment. A changed edge during resize gets a fresh placement serial/layout before unmasking. This covers hidden hotkey spawns as well as visible monitor transfers.

Regression checks: 42 desktop checks including hidden-spawn mask/layout ordering and edge changes during resize. Notification browser checks exercise one through four side accounts, flush end boundaries, both account orders, all four top/bottom positions and long-detail scrolling. Motion browser checks include right-to-left hidden respawning. Actual Windows multi-monitor/DPI composition remains an on-device check.

## Clear before moving settled arms (3.2.10)

Monitor placement uses two acknowledgments. `switchMonitor` masks native opacity and input, clears hit regions and sends `monitor_stow` without changing native bounds. The renderer masks the entire root subtree, cancels perimeter/open/arm/pocket tweens, clears details and waits two animation-frame boundaries before `monitor_stowed`. Only then does main select the latest cursor destination and move the native window. Layout events are suppressed during the clearing stage.

The placement layout resets the old geometry, waits for the correct viewport, opens at the destination while native opacity remains zero, and paints it over two further frame boundaries before `monitor_placed` permits native unmasking. It needs no subsequent `appear` event. Old appear/cursor events are ignored during the transaction. A new pointer monitor during painting begins another cleared transfer; stale tokens and Settings acknowledgments cannot move or reveal the window. Visible pointer transfers use the same process immediately, removing the previous 170ms disappearance timer.

Validation: 44 desktop checks and the motion browser suite. Browser transfers begin only after openness and arms reach 1, including a hovered disc. Cleared screenshots equal the blank background, all animation handles are reset, and sampled destination frames never use the previous edge or along-edge location. Tests repeat right/left returns and top/bottom transfers; existing corner transport, interrupted opening and reduced-motion checks remain. Native Windows/DPI composition still needs an on-device check.

## Liquid alert log (3.3.0)

The log's switches are drawn by `drawInk` (notify.js) in an SVG under the buttons: a dark well per switch and a white drop whose size follows its own spring (on: period 0.5 s, damping 0.5, swelling a little past the well; off: 0.94 s, 0.9, slow enough to watch the neck give). Adjacent drops are joined by a liquid bridge (`bridge`): two arcs, each touching both facing end circles, so the neck is always a concave hourglass with one waist. `neckBetween` thins that waist from its rest value as the drops part (over 1.15 of a switch's height of stretch) and solves the arcs' radius to give it, bounded at 0.95 of the height so a long neck still pinches instead of straightening; it parts once the waist would fall below 0.2 of the height, so never as a thread, and only ever narrows on the way. Each half then springs home as a rounded finger from where it broke (0.42 s, a little past, staying round until it is inside); the half on the draining drop is fat and short so that drop stays round. The neck path is wound like the drops and sits inside their goo group, so the junctions melt together while anything moves; at rest nothing is blurred. Labels are white with `mix-blend-mode: difference` inside an isolated group, so they invert where the ink is; their opacity follows the drop. Sound is a fourth drop in the title row.

Rows are two lines (status word and time; account and detail). One `.a-bead` under the hovered or focused row runs on two springs, the leading edge stiffer, keeping roughly a drop's volume. Opening waits for the lobe to reach 82% before the rows pour out on a spring easing (`linear()` generated from a damped spring); a live alert uses FLIP with the same family; Clear drains rows up into the title row for 0.26 s before `clear_alert_log`. The lobe is gooed while the log changes size. A scroll-edge mask fades the history into the black.

Pocket swaps (shape.js): `morphHandles` leaves a swapping handle's hover spring alone and is called again when the swap settles, so leaving mid-swap finishes the swap with its glyph (`.handle.swapping .h-glyph` keeps the hover glyph style) and then retracts through `drawArm`'s return path.

## Unread dot sprout (3.3.1)

The dot sits on the bisector of the leading front corner's 20px rounding, 10px from its centre (a 6.5px gap inside the curve), clear of the first gauge on every edge. `drawSprout` (shape.js) draws its bell in the notch's own SVG: a band of the notch clipped round that corner, a strand and a drop, gooed while moving. A spring (out: period 0.78 s, damping 0.6, popping a little past; back: 0.56 s, 0.9) drives it. The drop (full radius 0.4 of a handle's disc) starts at 28% of that size and leaves along the bisector, the strand thins until it parts at 0.72 of the way, and the bell's glyph sharpens and swings from the snap. `placeUnreadDot` (notify.js) moves the dot out to the drop and over to the bell's shoulder, stretched by its speed and ringed in black once over the glyph. When the screen's corner leaves too little room, the way out turns toward the notch's front.

`sproutHit` is the dot alone at rest, then the path from the dot to the bell while it is out, and it wins over the pin's reach. While out, the bell's rectangle is hot and reported as the `alerts` control, with the pin pocket's control left out so main's helper cannot press the pin under it. A capture-phase pointerdown opens the log before a ring under the dot can take the press. The open log replaces the dot, and the bell retracts into its lobe. The button is focusable only while the dot shows; keyboard focus brings the bell out and Enter opens the log.

Regression checks: `PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/notch-sprout.cjs`.

## Links on first use (3.3.2)

`installHelper` lists Code's extensions (`--list-extensions --show-versions`) and installs the bundled VSIX only when `f-petrozzi.agent-usage-link@<HELPER.version>` is missing. Earlier builds force-reinstalled it on the first terminal-linked click of every launch. That replaced the helper under a running VS Code window, which then dropped that link until a new window was opened. The first click after a launch is usually an alert sliver, so slivers looked unlinked while later log rows and Working text worked. A failed listing installs as before; the version is pinned in `session-open.cjs` and tested against `vscode-link/package.json`.

Helper 0.1.1 notes when it woke. For 15 seconds after that, a link with no matching terminal re-checks on each `onDidOpenTerminal`, and at least every second, before falling back to the conversation URI. Each `processId` is given one second. This covers a link that launched VS Code before its remote workspace had reconnected its terminals.

While an alert sliver is out, the unread dot's bell is not offered: the first account's sliver leaves beside that corner, and a press there belongs to the alert.

Regression checks: `node --test tests/test-session-open.cjs` (list-then-install, no reinstall of the same version, update of an older one, startup wait and fallback) and the sliver case in `tests/browser/notch-sprout.cjs`. Real VS Code window behaviour needs a Windows trial.

## Clicks on first open and a liquid pinch (3.3.3)

Main's hit test (`overNotch`) and the input helper's control test (`controlHit`) measure from the window's real bounds (`win.getBounds()`), not the monitor it was asked to cover. On `monitor_placed`, a window whose native bounds differ from its monitor by more than a pixel is placed again from the screen it is now on and repainted before it is unmasked, at most twice. This targets a first reveal that crossed from the parked position (sized for the leftmost screen) to a screen at another scale: the notch drew and hovered, but every press missed until it was moved to another screen and back. Each placement, and each press that missed every hot rectangle within a minute of one, writes a line of geometry to `notch-diagnostics.log` beside `settings.json` (capped at 64 KB, then rotated once). The cause is inferred, not reproduced: a real main/page replay in a browser places correctly, so confirm with that log on the device.

Regression checks: `tests/test-monitor.cjs` (re-placement before unmasking, the retry bound, the log, and hit/control tests from an offset window) and the switch checks in `tests/browser/notch-bell.cjs` (necks stretch before parting, part once, and never below their least waist).

## Relayed presses, smooth goo edges and legible small mode (3.3.4)

3.3.3 did not fix the first-open dead clicks: hover still worked, presses did not, until the notch was moved to another screen and back. The input helper already caught presses on the pin and gear for overlays that do not receive clicks; `physicalPress` now covers the rest of the notch. A press over a hot rectangle that is no control waits `RELAY_MS` (140 ms). The page reports every `pointerdown` as `page_pressed`, and a report within 150 ms of the press is spent on it. Without one, main sends `mouseMove` + `mouseDown` into the page at the same window-relative spot with `webContents.sendInputEvent`, and `mouseUp` when the button is released (at once for a click shorter than the wait). Controls and presses off the notch behave as before. Each press within a minute of a placement is logged with whether the page got it.

`setGooBlur` (shape.js) sets every goo filter's blur and cut-back together: alpha slope `k = clamp(2.6σ, 1, 24)` with offset `0.5 − k/2`, keeping the half-alpha line (so shapes meet and part where they did) with about a pixel of soft edge. The fixed 24× cut left a fraction of a pixel at the switches' small blurs, so moving edges stepped like pixels.

Small mode is a 0.8 page zoom. Text on cards, the log and alerts uses `calc(Npx * var(--tz,1))`; motion.js sets `--tz` to `max(1, 0.96 / scale)` (1.2 in small), and the card's width scales with it (`placeCard` divides the log's measured minimum back by `--tz`). The notch's own glyphs and percentages keep the small size. CSS `zoom` on the card was tried and rejected: the card's positioning reads unzoomed offsets and put it over the pill.

Regression checks: the relay case in `tests/test-monitor.cjs`, and `PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/notch-small.cjs` (medium unchanged, small text near medium with no cut-off text, the notch still small, the smooth cut-back while switches move).

## Notification shimmer (4.0.0)

`desktop/ui/notification-rim.js` adds a brief travelling glow when an alert opens, or when a release becomes available/ready. It copies the current notch body and notification paths into a clipped SVG silhouette. Dilated alpha minus eroded alpha produces the outside border of their union, so overlapping paths have no internal seams. Three directly rendered gradient layers supply the bright rim and two soft halo widths; filter regions stay bounded to the notch area. The copied paths retain their screen transforms and update while the notification springs out. Floating handles remain separate from the notch perimeter.

A single 3.2-second circuit starts at one side and fades. Bursts update the colour without restarting the circuit, and progress events cannot retrigger it. Reduced motion uses a stationary 1.1-second highlight. The overlay is hidden from accessibility and pointer hit testing. Disappearance and native monitor stowing discard its frames and geometry; pending release announcements start after the destination notch appears.

Run `tests/browser/notch-rim.cjs` with Playwright for rendered glow, movement, cleanup, release colour and input checks on all four edges. Run the existing alert, updater and motion browser checks for regression coverage.
