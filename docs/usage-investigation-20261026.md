# Usage freshness and closing contour investigation

Candidate branch: `orbit/helper-d14c6908-02dc-5a6a-b3c1-a25a04683ad4`.
Base: `a84d746`. This is an Agent-Usage-only candidate for coordinator integration,
not an independently versioned release. No Orbit source or personal session was edited.

## Findings and limits

- Public latest release observed October 26: `v5.1.7`, published October 18 at
  00:34:09 UTC (`gh release view --repo f-petrozzi/Agent-Usage --json tagName,publishedAt`).
  That tag has neither the desktop `SessionFeed` usage event nor its main-process
  consumer. Those first appear in `901684b` after the latest tag. Thus the latest
  published Windows code waits 60–180 seconds despite the shared collector being
  current. The owner's installed Windows version and SSH/WSL host are not known;
  this is a supported release explanation, not proof of installed parity.
- Current source streams cached usage over the existing session connection every
  1.5 seconds when changed, with 15-second heartbeats and a 45-second watchdog.
  `desktop/main.cjs` sends accepted snapshots to renderer account consumers.
  The installed Linux collector contains that stream implementation. A passive
  stream/cache comparison at Unix time `1793063492.9000084` matched every account's
  window label, percentage, duration, reset, original sample time, source and
  origin. No provider calls were launched by this comparison. This verifies this
  Linux host only; it does not inspect Windows or the container's cache mount.
- Both public paths use `limits[].usedPercent` from the same schema-2 cache.
  Codex `_percent` rounds to whole points; desktop divides by 100 for the renderer,
  which rounds the displayed percent. Orbit's compatibility adapter carries those
  public limits unchanged. Its internal `_native` preserves extra precision for
  guards, not a different public measurement. There is no evidence of intentional
  3-point sampling or interpolation. Like-account/window/timestamp comparison is
  required before attributing the owner's visual gap to precision.
- Desktop normalization dropped individual window provenance and treated any
  refresh warning as stale. Candidate preserves original per-window timestamps,
  source and origin, and leaves an otherwise fresh measurement current when a
  refresh failed. Stale/error/unavailable flags and local expiry still apply.
- The installed Claude CLI is 2.1.311. Its `--help` states that
  `--no-session-persistence` prevents saving resumable sessions and works with
  print mode. The installed collector passes that flag with `-p /usage`.
  No model turn or fresh usage fallback was invoked in this assignment. Existing
  synthetic history tests distinguish SDK `/usage`-only records from real chats
  and cover the exact nonpersistent command. These facts do not identify the
  owner's recurring picker entry or establish whether an older process made it.
  Smallest remaining check: take that entry's native ID and stat its exact JSONL
  file now and when it reappears. Same ID/unchanged file means rediscovery; a new
  file requires checking only its metadata and the bounded usage-only recognizer.
  Never filter by a title or archive/delete a personal session to diagnose this.
- Before, hide translated a full-depth SVG 96 px through the viewport boundary
  after absorbing handles. At ~370 ms in the top-edge fixture, openness was still
  1 and root translation was `0px -9.17846px`: the original flares were clipped.
  Candidate retracts the actual contour, including corner parts, into its edge:
  260 ms absorption plus 200 ms contraction, inside the hosts' 500 ms grace.
  Reopening retains drawn contour/arm positions. Reduced motion settles directly.

## Bounded usage rendering and memory observations

The owner reported a Chrome tab-hover peak of 3.6 GB settling near 1.2 GB; A owns
that investigation. No usage evidence attributes that peak to the collector.
Desktop previously rebroadcast unchanged usage on every session/activity line,
rebuilding account renderers. The candidate deduplicates equal normalized quotas;
a fixture sends 100 unchanged heartbeats and observes one initial broadcast while
stale/recovery transitions still broadcast. This reduces desktop work; it does not
change Orbit's host adapter or establish a Chrome memory fix.

Static ownership checks found one account subscription in `motion.js`, keyed
paint jobs consumed by the runtime scheduler, removal of absent focus-cell keys,
120 rendered Sessions rows, 40 retained alerts, and 120 quota-warning keys.
No growing history or duplicate-subscription cause was established. Browser
motion checks verify settling/reversal, not Chrome tab memory attribution.

## Validation and evidence

- `node --test tests/test-collector.cjs tests/test-session-feed.cjs tests/test-usage-delivery.cjs`:
  21 tests, exit 0. Synthetic successive 23%/26% samples traverse a real child
  stdout stream and Collector event delivery in ~128 ms with zero quota polls.
- `python3 tests/test-history.py`: 13 tests, exit 0; temporary synthetic histories only.
- `python3 tests/test-live-usage.py`: 7 tests, exit 0.
- `python3 tests/test-shared-usage.py`: 17 tests, exit 0.
- `node --check` for modified JS/CJS and Python compile: exit 0.
- Existing `tests/browser/notch-motion.cjs`: exit 0; corner coverage, arm/disc
  alignment, absorption, interrupted reveal, reduced motion and monitor placement.
- New `tests/browser/notch-close.cjs`: four edges at 960×600 and 390×844,
  close/reveal reversals, rapid reversal, corner closure, reduced motion and
  measured exit timing (465.3–477.3 ms in the final eight edge samples), exit 0. See local `artifacts/usage-close-20261026/checks`.
- `node --test tests/test-motion-runtime.cjs tests/test-alerts.cjs`: 17 tests, exit 0.
- `git diff --check`: exit 0. Toolkit `agent-check` was attempted, exit 1 because
  Agent-Usage has no `agent-check.json`; Orbit's configured check applies there.
- One exploratory close invocation initially used a relative file URL and failed;
  corrected to an absolute path. One concurrent Chromium launch crashed under
  host resource pressure; serial rerun of the existing motion suite passed.

Build a standalone synthetic interactive preview with:

```sh
python3 scripts/preview-notch-close.py /tmp/usage-close.html
PLAYWRIGHT_MODULE=/mnt/ssd/homelab/tools/agent-toolkit/node_modules/playwright \
  node tests/browser/notch-close.cjs /tmp/usage-close-checks
```

Local before/after previews and PNGs are in
`artifacts/usage-close-20261026/{before,after}.{html,png}`. They are generated
artifacts, ignored by git; regenerate the after preview from the candidate.

## Coordinator integration and acceptance

Main had `M scripts/agent-usage`, staged deletion `tests/test-orbit-workers.py`,
and `M tests/test-session-feed.cjs`. The bounded diffs remove legacy Orbit workers
and their one test. Candidate does not modify those paths. Preserve them when
merging; the new delivery fixture is its own file.

1. Merge the candidate into Agent-Usage main and run the focused checks above.
2. From Orbit, select that committed Agent-Usage checkout explicitly:
   `python3 scripts/sync_agent_usage.py /path/to/Agent-Usage`. The export requires
   clean committed `desktop/ui` and writes its commit/hash manifest. Never edit
   Orbit's pinned renderer. Its previously pinned source was `223f7a5`.
3. Orbit adapter alignment belongs to the parent: stop treating refresh `warning`
   alone as stale in `bridge/usage_source.py` and the renderer adapter; retain
   explicit stale/error, age, reset and heartbeat checks, including `stoppedAt`.
   Preserve per-window sample times/provenance in normalized windows. Consider
   equality suppression for unchanged account snapshots if A measures redundant
   Orbit work; desktop deduplication does not reach that host.
4. The parent may reuse the strict `_claude_usage_probe` logic for catalog filtering
   only after identifying supported metadata. No cleanup or title-wide hiding is
   required. Navigation removal is owned by parent/Claude.
5. After integration, Agent-Usage AGENTS.md requires an automatic Windows patch
   release: in `desktop`, `npm version X.Y.Z --no-git-tag-version`; commit with one
   imperative subject and no trailers; push main and matching annotated `vX.Y.Z`;
   monitor `.github/workflows/windows.yml` through build/release publication;
   verify installer, blockmap and `latest.yml` on public latest. Then tell the
   owner Settings → General → Update → Restart. The helper does not publish a
   partial candidate; the coordinator owns this release.

Remaining physical acceptance: installed Windows version and collector host;
matching account/window sample times through SSH/WSL to the installed app; dead
stream/reconnect behavior on that Windows setup; native placement/input and
hide/reopen on Windows; iPhone safe-area, pull gesture, Safari reduced motion and
actual perceived closing contour. Synthetic Chromium checks do not replace them.
