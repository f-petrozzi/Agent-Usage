# OR-210 / OR-212 checked source candidate

Implementation: `ec78473b60e70661561422966e43289cdf507c5a`, branch
`codex/or210-212-usage-20261107`. The prepared OR-203 renderer (`164455a`)
includes working-arc recovery (`25cdf90`). Committed main `e25bfe5` was merged
into this isolated branch as `1c7e099`. The owner’s dirty main worktree and index
were untouched. No push, release, main integration, collector installation,
provider experiment or service change occurred.

## Causes and resulting behavior

- Standalone releases did not include the separate OR-203 working-session row
  renderer. This candidate includes its single-line accessible rows and arcs.
- `renderCard` replaced the card on every usage/activity update, destroying
  working marks and restarting their 1.2-second CSS rotation. Existing marks now
  move by stable account/session identity. Native `moveBefore` preserves state;
  native animation clocks are restored if a webview recreates a pseudo-element
  animation or needs `insertBefore`. No stream-driven angle or new timer is used.
- Desktop expiry checked only the account sample while Orbit checked each
  window. The renderer also had an unrelated 15-minute fallback. Desktop
  normalization, shared-cache reads and the common notch/Settings policy now
  apply Codex’s 120-second and Claude/Agy’s 600-second freshness to every
  represented sample. Resets and collector health also invalidate freshness.
  A fresh session sample cannot refresh a retained weekly sample. The existing
  expiry timer marks a silent collector unavailable after 45 seconds without
  rebroadcasting identical quota heartbeats.
- An expired measured zero still claimed `0%` and `100% left`. It now shows a
  pending percentage, `Waiting for usage update`, and `Last reading 0%`.
  Measurements stay intact. A real new window restores current usage/headroom.

Released main already has active Claude minute polling, successful-cache reset
expiry and delayed old-window retries without an hour-long parse pause. Those
fixes were inspected and incorporated, not reimplemented. This change adds no
provider requests, polling cadence or model calls. Minimum gaps, Retry-After and
failure cooldowns remain. Synthetic evidence establishes safe pending display
and minute reset recovery; it cannot establish every historical discrepancy
with claude.ai.

## Reproduction and checks

All fixtures use synthetic records, temporary state and local browser files.
Every command was bounded and completed. Browser commands used:

```sh
export PLAYWRIGHT_MODULE=/mnt/ssd/homelab/tools/agent-toolkit/node_modules/playwright
export PLAYWRIGHT_BROWSERS_PATH=/home/fab/.cache/ms-playwright
```

| Command / observation | Result |
| --- | --- |
| Baseline: `timeout 30 node --test tests/test-collector.cjs` with the new regression | Exit 1: old weekly sample was `ok`, expected `stale`. |
| Baseline: `timeout 60 node tests/browser/working-session-rows.cjs` with the new regression | Exit 1: first snapshot replaced the working mark. |
| Baseline: `timeout 45 node tests/browser/refresh-truth.cjs /tmp/or210-212-repro-refresh` | Exit 1: expired zero remained `0%`, expected pending. |
| `timeout 180 node scripts/test-desktop.cjs` | Initial exit 1: 117 passed; three files could not find existing `vscode-uri` in the fresh worktree. |
| Same desktop command after linking this worktree’s `desktop/node_modules` to the already installed main checkout dependencies | Exit 0: **155 tests passed**. No install/main dependency mutation. Temporary symlink removed afterwards. Log `/tmp/or210-212-desktop-with-installed-deps.log`. |
| `PYTHONDONTWRITEBYTECODE=1 timeout 180 python3 scripts/test-collector.py` | Exit 0: **15/15 collector suites passed**, including resets, cooldowns, manual refresh, shared-cache/window freshness. Log `/tmp/or210-212-collector.log`. |
| `ORBIT_ROWS_OUTPUT=/tmp/or210-212-after timeout 75 node tests/browser/working-session-rows.cjs` | Exit 0: 1280/390px, normal/reduced motion. Eight quota/activity updates over more than two rotations retain mark identity and clock rate; native and legacy move paths, hidden/offscreen pause, accessible titles and finite completion exits pass. |
| `timeout 60 node tests/browser/refresh-truth.cjs /tmp/or210-212-after-refresh` | Exit 0: desktop/phone expired 73%, pending zero, then measured 2% / 98% left. |
| `timeout 75 node tests/browser/reading-availability.cjs /tmp/or210-212-reading` | Exit 0: desktop/phone ink, availability, reset and metadata behavior retained. |
| `timeout 75 node tests/browser/settings-alerts.cjs /tmp/or210-212-settings` | Exit 0: Settings policy dependency and existing interactions pass. |
| `timeout 90 node tests/browser/activity-spin.cjs /tmp/or210-212-activity` | Exit 0: 61 unique transforms in 61 frames, phase retained, hidden pause/reduced motion pass. |
| `git diff --check` | Exit 0. |

Screenshots were opened and inspected. [Interactive comparison](preview.html):
[working rows](working-sessions.png), [pending expired zero](reset-pending.png),
[measured 2%](reset-measured.png).

## Owner return checks and integration hold

OR-212’s explicit owner decision is still required before Agent-Usage main
integration and a Windows patch release. The parent owns the pinned Orbit
renderer update. Include updated `availability.js` in notch and Settings pages.

After approved installation, compare a natural Claude five-hour reset against
claude.ai: real new-window usage should arrive within about a minute while
active, or remain explicitly pending/last-reading while the provider or cooldown
prevents a current measurement. Confirm Windows shows arcs on first open,
constant rotation through live updates, and the same stale state as Orbit for
the same shared sample. Natural-reset accuracy, packaged Windows verification
and owner acceptance remain outstanding.
