# Performance validation

Settings → General → Performance recording → Record 10 seconds saves a local
Chromium trace after an explicit click and file selection. The trace stops after
10 seconds and uses a 16 MiB buffer. Event arguments use Chromium's privacy filter. Open folder reveals the saved file; Record
10 seconds starts another capture. Nothing is uploaded. Custom metrics never
contain chat titles, workspace names, messages or account identities.

Open the JSON in Chrome DevTools' Performance panel or Perfetto. It includes
main/renderer tasks, compositor/GPU scheduling, input and latency categories.
These use [Electron contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing).
Capture at the display's native 60, 120 or 144 Hz, with the notch at the actual
Windows scaling and mixed-DPI monitor arrangement. Compare idle, overlapping
handle reversals, usage/Sessions while typing, notification motion, search/feed
refresh, corner travel and monitor transfer. Repeat on integrated graphics and
4K at 150–200% scaling. Record missed/partial presentation, frame intervals,
renderer/main/GPU work and input latency separately. Frame budgets are 16.67,
8.33 and 6.94 ms; JavaScript must leave room for composition and presentation.

The collector history metadata index avoids restatting archived rollouts on a
warm request. It always checks up to 256 selected files, detects new/deleted
files through directory metadata, and reconciles every archived timestamp once
per minute. It contains filenames and times, never message bodies. Quota polling
frequency is unchanged. Synchronous settings saves remain atomic because no
measured disk stall justified changing their save/exit/update contract.

`node scripts/test-browser.cjs` includes structural performance checks on every
edge at DPR 1 and 2: at most one keyed geometry paint per scheduler frame, no
stationary rim contour writes, and no recurring layout during the sweep. These
checks use fictional accounts and do not certify Windows FPS or input latency.
Analytic spring trajectories are checked at 60/120/144 Hz, including reversals
and a long frame. Native Windows CI checks helper compilation and registration;
physical pointer/shortcut injection runs when the runner has an interactive desktop.
