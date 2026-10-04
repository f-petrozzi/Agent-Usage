# Shared platform architecture

The 5.0.2 preparation pass keeps one Electron frontend. It strengthens Windows
behavior and creates seams for a personal Mac build; it does not ship a Mac app.

## Where a feature belongs

| Responsibility | Shared implementation | Native boundary |
| --- | --- | --- |
| Gauges, Sessions, Accounts, effects and notification geometry | `desktop/ui` and `desktop/perimeter.cjs` | None for ordinary UI features |
| Alerts, retained log, pins and collector data | `desktop/alerts.cjs`, `session-library.cjs`, `collector.cjs` | Collector executable selection in `platform-runtime.cjs` |
| Session identity, account selection and acknowledgments | `session-routing.cjs`, `session-open.cjs`, `vscode-link/extension.js` | Code discovery and CLI layout in `platform-vscode.cjs` |
| Reveal, drag, focus and display transfer state | `desktop/main.cjs` | Window policy in `platform-window.cjs`, native input ownership in `platform-input.cjs` |
| Update states, verified progress and signed push notices | `desktop/updates.cjs`, `update-push.cjs` | Installer capability in `platform-runtime.cjs` |

History, Working rows, Sessions and notification clicks resolve identity against
the configured collector and use the same `/resume` helper route. They preserve
account homes and validated SSH/WSL routing, wait for a VS Code receipt, and use
fresh terminal ancestry. Live-only entries without saved resume metadata can
focus their terminal; they cannot launch a duplicate. Notifications record their
collector scope. Legacy URL parsers remain for compatibility, but current app
buttons do not use the old unscoped provider-chat route.

The native input owner requires helper readiness, clears held and drag state on
failure, and retries five times with capped backoff. Old child events cannot
reset a replacement. Explicitly choosing the held shortcut again resets the
retry budget. Display transfers wait for clearing and paint acknowledgments,
retry missing acknowledgments twice, then park safely and allow another reveal.

## Validation

The Windows workflow gates packaging on Linux checks for shared modules,
collector fixtures and every browser suite. Windows then verifies native key
presses, focus, all desktop tests and installation of the packaged VS Code helper
into real Code. Browser artifacts use fictional accounts and are retained by CI.

Run shared checks from the repository root:

```bash
npm ci --prefix desktop
node scripts/test-desktop.cjs
python3 scripts/test-collector.py
npm ci --prefix tests/browser
npm exec --prefix tests/browser -- playwright install chromium
node scripts/test-browser.cjs
```

An existing Playwright installation can be selected with `PLAYWRIGHT_MODULE`.
Browser suites run sequentially to avoid competing compositor workloads. They
check interaction, continuous animation, compositor promotion, phase retention,
reduced motion and cleanup. Frame counts and intervals are reported as
measurements. Set `AGENT_USAGE_PERF_CHECK=1` to enforce the activity cadence
benchmark on an otherwise idle machine. Headless CI is not evidence of Mac
hardware performance or high-refresh-rate smoothness.

## Remaining Mac work

1. Implement the native window policy for menu-bar/camera-notch safe areas,
   Spaces/full-screen windows, mixed monitor scaling and click-through.
2. Add a Mac input backend for held reveal/following and Sessions focus. Keep
   the same shared events, readiness and cleanup contract; choose a usable Mac
   shortcut rather than assuming a Scroll Lock key is available.
3. Configure SSH-first settings, bundle resources and arm64/x64 packaging.
   Discovery of the standard VS Code app bundle is ready, but needs an actual
   Mac launch/install/focus smoke test.
4. Use unsigned local distribution and manual updates initially. No Apple
   Developer enrollment or notarization is required for this personal setup.
   Validate installation and first launch on the user's Mac before distributing it.
5. Add actual macOS checks for native behavior, including returning to a terminal
   in an already-open Remote SSH workspace. Keep ordinary features in the shared
   code and require platform checks only when a native boundary changes.

Mac implementation should extend these boundaries rather than copy the UI or
its effects. Normal interface changes should need one implementation and checks
on both platforms; window, keyboard, installation and platform integration
changes will still require separate native work and real-device validation.
