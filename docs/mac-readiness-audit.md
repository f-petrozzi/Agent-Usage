# Mac readiness audit

Audited 2026-10-04 against Agent Usage 5.0.1, commit
`f8f96588df2085b4d75fc398ae2ed782b05b7af7`.

The Windows interface is a useful baseline for a shared Mac app. A focused
preparation pass is warranted before implementing Mac behavior: unify session
opening, make input-helper failure recoverable, isolate operating-system policy,
and automate the browser regression checks. Notification visuals and the fluid
geometry do not need another redesign before starting.

This is an assessment, not a port or an application release. The source findings
below distinguish reproduced behavior from gaps inferred through code inspection.
Runtime checks used synthetic fixtures. No real agent sessions were launched.

## Readiness by area

| Area | Current state | Recommended action |
| --- | --- | --- |
| Windows shortcuts and Sessions focus | Normal operation has real Windows integration coverage. Failure recovery is incomplete. | Preserve current behavior; fix helper lifecycle and extract the input implementation. |
| History and Sessions routing | Strong host/account validation, terminal reuse and acknowledgments. Older entry points behave differently. | Give history, Working and notification clicks one resolver and acknowledgment path. |
| Notifications and update slivers | Placement, priority, countdown contours and cleanup pass browser checks. | Keep the shared implementation. |
| Dragging and monitor transitions | Geometry and stale-placement protection have substantial coverage. Window placement remains Windows-specific. | Keep geometry; isolate native window policy and bound placement recovery. |
| Shared feature development | UI, collector data normalization and alert logic are already separable from native APIs. Main-process policy remains intertwined. | Introduce a few platform modules rather than a second frontend. |
| Continuous validation | Windows native/package checks are automated. Browser and Python checks are not in the existing Windows workflow. | Add a portable validation job; separate timing measurements from functional assertions. |

## 1. Unify session opening before the port

Priority: high. Confirmed with synthetic VS Code windows, not an on-device failure
in the user's current session.

`desktop/main.cjs:566` resolves history from the collector, preserves account and
host metadata, and uses the `/resume` helper route. `vscode-link/extension.js:141`
checks the effective SSH connection before matching terminal process IDs. It also
avoids starting another copy of a session known to be running. The desktop waits
for the helper's receipt and reports its errors.

`desktop/main.cjs:614` still opens Working rows through `sessionUrl`. Some stored
notification targets use the same older route (`desktop/main.cjs:591`). Its
payload does not carry the SSH/WSL host or account home. The `/open` handler at
`vscode-link/extension.js:52` matches terminal PIDs before considering workspace
location and never validates the target host. When no terminal is found, it can
fall back to the provider's graphical extension chat.

Reproductions with a fictional Codex session and terminal PID 80:

- A window on `ssh-remote+other-host` with terminal PID 80 was focused by `/open`,
  even though the session target was `homelab`.
- The same target through `/resume` rejected the wrong-host terminal and did not
  start another copy of the running conversation.
- With no matching terminal and a matching workspace path, `/open` issued
  `vscode://openai.chatgpt/local/<session UUID>` instead of identifying the missing
  CLI terminal.

These findings do not mean that normal history terminal reuse is broken. They
show that different buttons have different guarantees. Process IDs can repeat
across hosts, so a shared workspace path is insufficient to resolve that gap.

There are two related inconsistencies:

- `desktop/session-open.cjs:110` creates an acknowledgment receipt only for resume
  targets. Older opens return success after the VS Code process starts, without
  knowing whether the intended session was focused.
- AGY is supported by history resume, but excluded from Working links in
  `desktop/ui/notch.js:1033` and `desktop/alerts.cjs:82`. Its Working row is a
  display row rather than a clickable session.

Recommended implementation: resolve every click to a validated session identity
including provider, account home, transport/host, workspace and fresh live-process
information. Focus an existing terminal on the verified host; resume a closed
session; report a useful error for an unmatched live session. Use the same helper
receipt for all entry points. Preserve legacy URLs for compatibility without
using them as the preferred route for new clicks.

Acceptance checks: the same session behaves consistently from history, Sessions,
Working, Waiting and Finished; different hosts with the same PID never match;
same-host SSH aliases work; repeated clicks reuse the terminal; active unmatched
sessions do not create duplicates; AGY has the same applicable behavior; helper
failure remains visible to the user.

## 2. Make input-helper failure recoverable

Priority: medium. Confirmed by emitting an unexpected helper exit into the real
main-process logic with mocked native input.

Normal Windows behavior is well covered: native registration, message handling,
hidden reveal, first-press replacement of an account card, search focus, toggle
close, repeat suppression, both Ctrl keys and Scroll Lock follow-after-close.

The lifecycle is weaker. `desktop/main.cjs:340` clears `sessionKeyHeld` on helper
exit, but leaves `held`, `mouseDown`, `carrying` and the `input` reference intact.
The reproduction reported `held: true` and `inputPresent: true` after helper exit.
`registerSessionShortcut()` still returned true because it checks `!!input`, not
whether the helper is alive or registered. There is no automatic recovery from
that exit. Start failures display an error; unexpected exits are only diagnosed.

Recommended implementation: represent helper readiness explicitly; clear held
input and end dragging safely on failure; retire the failed helper reference;
retry with bounded backoff or provide a direct recovery action. Distinguish an
intentional shutdown/reconfiguration from failure so replacing the helper cannot
clear the new helper's state. Check its registration status rather than merely
the existence of a child object.

For Mac, define the shared events as reveal pressed/released, Sessions requested,
and pointer pressed/released. Keep Windows virtual-key codes and native hotkey
ownership in the Windows implementation. The non-Windows branch currently
registers a reveal callback and returns before creating input monitoring; it does
not provide equivalent held-key or outside-release behavior.

Acceptance checks: helper failure while idle, revealing, carrying or closing
Sessions leaves the app controllable; reconfiguration cannot race the replacement;
lost key release is recoverable; ordinary Windows shortcut behavior stays intact.

## 3. Preserve the visual implementation; extract window policy

Priority: required for the port, with an additional recovery improvement.

The separation worth retaining is already visible:

- `desktop/perimeter.cjs` maps the pointer continuously around the four edges.
- `desktop/ui/motion.js` controls shared travel and placement painting.
- `desktop/ui/notify.js:241` removes notification words, ink, countdowns and glow
  immediately when following or dragging starts.
- `notification-rim.js`, `update-progress.js` and `rim-geometry.js` share contour
  geometry rather than drawing unrelated pill outlines.
- `notch-effects.js` bounds and cancels transient accents and respects reduced
  motion.

Browser checks passed for all four corners in both directions, ring coverage,
interrupted motion, monitor resize, superseded placement, notification drag
cleanup, update priority, shimmer completion after hover-off, countdown pause and
expiry, and reduced motion. Reviewed screenshots showed intact alert placement
and readable Sessions content at the small setting.

The native window behavior in `desktop/main.cjs` should become platform policy:
the screen-sized overlay, off-screen parking, Windows stacking reassertion,
focus/taskbar changes and physical-click relaying are intertwined with shared
interaction state. In particular, blindly reusing Windows screen bounds on Mac
would encounter different top-edge behavior: Electron documents a macOS minimum
window Y coordinate tied to the menu bar. Electron also provides a Mac panel type
for non-activating/full-screen workspace behavior. These are implementation inputs,
not evidence that the current overlay already works on Mac. See
[Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window).

There is another recovery gap: the monitor transfer protocol waits for
`monitor_stowed` and `monitor_placed` without a bounded acknowledgment timeout.
`desktop/ui/motion.js:136` waits indefinitely for the expected viewport dimensions.
Main rejects stale acknowledgments and retries misplaced bounds, which is good,
but an absent acknowledgment or persistent size mismatch can leave the window
masked. This was identified by inspection; no real mixed-DPI failure was reproduced.
Add a bounded recovery path that resamples actual bounds and does not reveal a
stale surface. Handle renderer loss separately from slow painting.

Suggested boundaries: `platform/input`, `platform/window`,
`platform/collector-command`, `platform/vscode` and `platform/update-install`.
The exact file names are implementation choices. Keep renderer events, session
identity, alert rules, geometry and visual effects shared. Avoid a broad renderer
rewrite as a prerequisite.

## 4. Automate the checks that protect shared features

Priority: medium; complete before routine dual-platform releases.

The current Windows workflow runs desktop tests, the compiled keyboard helper and
packaged VS Code helper installation. It does not run the 14 browser suites or
the Python collector suites. A Windows package can therefore pass while a shared
visual or collector regression remains undetected.

Two browser checks failed in the initial two-worker run: the activity arc's
minimum frame count and an alert geometry assertion measured after a fixed delay.
Both passed on follow-up runs without application changes; the unchanged alert
suite passed when run independently. The measured alert height and account section
were both 93 CSS pixels. The activity check reported 61 unique transforms across
61 frames in its follow-up run. This points to timing-sensitive test assumptions,
not a demonstrated persistent rendering defect.

Use state/geometry settlement checks rather than fixed delays where possible.
Run performance samples in isolation and retain their measurements without
treating a shared runner's frame budget as proof of device performance. Add the
functional browser suites and Python fixtures to a portable CI job, then add Mac
native checks during the port. Do not discard these failures or weaken geometry
requirements merely to make CI green.

## Validation performed

- All 107 desktop tests passed locally, with loopback sockets available for
  helper acknowledgment tests.
- Six Python scripts passed: 41 unittest cases plus the cooldown and reset
  scenario scripts.
- All 14 browser suites passed across the initial run and follow-up checks. The
  two timing-sensitive initial failures are documented above.
- The 5.0 combined animation sample had a 16.7 ms median frame interval, 16.8 ms
  p95 and no interval above 34 ms in that headless run. This is approximately a
  60 Hz sample, not a 120 Hz or real Mac performance guarantee.
- The latest [Windows CI run](https://github.com/f-petrozzi/Agent-Usage/actions/runs/37183428065)
  passed native physical-key checks for both Ctrl keys and the real packaged
  VS Code CLI helper install. It passed 105 desktop tests and skipped two
  Unix-shell execution checks; those checks passed in the local 107-test run.
- Targeted synthetic reproductions confirmed the older route's wrong-host PID
  match, graphical fallback, and the input helper's retained held state on exit.

No local Windows desktop or Mac runtime was available for this audit. Headless
Chromium and simulated native APIs cannot validate real mixed-DPI input, macOS
Spaces, full-screen apps, hardware camera-notch layout, permissions or display
sleep/wake behavior.

## What can wait until after the first Mac build

Start with Mac as an SSH client for the existing homelab collector. Port the
platform boundaries and validate on a real Mac before expanding scope.

Local Mac collector support can follow: `_process_matches`, `process_ancestry`
and `rollout_processes` in `scripts/agent-usage:844` depend on Linux `/proc`.
Local authentication behavior and CLI discovery also need Mac fixtures. This is
separate from connecting to Linux over SSH.

The personal Mac build can use manual installation and updates. Do not simply
enable the existing Windows updater-installed flag on an unsigned Mac build.
Keep shared release-notice UI separate from the platform's installation method.
If releases later contain both platforms, publish the corresponding artifacts
together before announcing a complete release.

Recommended order: repair the inconsistent session routes and helper lifecycle;
extract platform policy while preserving tested Windows behavior; establish
portable functional checks; build and test the SSH-based Mac version. The
existing visual feature set is mature enough to begin that preparation now.

## Preparation follow-up: 5.0.2

The audit above describes 5.0.1 at the recorded commit. The approved preparation
pass implements the proposed changes in 5.0.2:

- Current history, Working and notification buttons share a trusted metadata
  resolver, host validation and VS Code receipt path. AGY Working rows also link.
  Live-only focus requests do not create duplicate terminals. New notifications
  retain collector scope and reject opening on a different configured host.
- Input-helper readiness, stale-child isolation, held/drag cleanup and bounded
  reconnection now have regression coverage. Monitor acknowledgments have a
  bounded retry/parking fallback rather than waiting forever.
- Window policy, input ownership, native collector executable selection, updater
  installation capability and VS Code discovery have explicit module boundaries.
  Windows policy is preserved. Mac SSH/Code discovery decisions are unit-tested;
  Mac panel, input and packaging behavior remain to be implemented on a Mac.
- The release workflow gates packaging on shared Node checks, all six Python
  fixture suites and all fourteen browser suites. Browser tests run sequentially;
  timing measurements are separate from the optional cadence benchmark.

The remaining work and testing contract are documented in
[Shared platform architecture](platforms.md). This preparation is a Windows
patch, not a verified Mac port.
