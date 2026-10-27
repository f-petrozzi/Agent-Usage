# Account B: usage investigation

Branch `orbit/agent-usage-overnight-b`, base snapshot `107b93e` over `be0f982`. The base snapshots five dirty main paths, including the staged deletion. Main was not modified. No install, release, push, restart or merge.

## AG-51: transient network error recovered

Read only the allowlisted fields of `~/.local/state/agent-usage/refresh.jsonl`, filtering `account == codex:b`. One network failure appears at 2026-10-27 04:11:02.728539 UTC (00:11:02 EDT), source poll, no HTTP status and no Retry-After. Next poll succeeds at 04:12:10.087745 UTC, 67.359 seconds later. Later poll/live samples succeed. The first Codex network retry is 60 seconds; repeat failure delays are 120 then 300 seconds. Nothing indicates authentication failure or a 429. Journal diagnostics cannot identify a DNS/socket/TLS subclass; raw exceptions deliberately are not logged. No provider request, credential access or cache mutation was performed.

`python3 tests/test-shared-usage.py SharedTests.test_failure_preserves_reading_time_and_backs_off SharedTests.test_live_recovers_freshness_without_bypassing_poll_backoff SharedTests.test_live_during_failed_poll_survives_and_endpoint_still_backs_off -q`: 3 synthetic tests pass (0.352s). Accepted samples clear refresh warnings/failure count while preserving any source cooldown. No code correction is justified by this recovered event.

## AG-50: not reproduced; capture needed

Synthetic busy parent + idle helper accounts remain independent across these layers:

- `scripts/agent-usage`: rollout caches key by path and retain each profile's account. Incremental parent writes do not change the helper state. Native subagent metadata is excluded from independent account activity.
- `desktop/collector.cjs`: parseSessions carries each row's account through its stable hash. SessionFeed filters active states per row; idle helpers do not inherit parent state.
- `desktop/ui/notch.js`: workState filters by exact account ID; no parent inheritance. Actual renderer checks passed at 1280px and 390px, including helper start/finish, phone account paging, clearing all activity and reduced motion.
- Orbit host inspection: `preview/usage/collector.js` maps account snapshots to their tagged account, `preview/chat/working-feed.js` emits each account separately, and `bridge/session_activity.py` suppresses delegate-to-parent completion/activity propagation. Logical handoff anchors can expose the same continued chat in original/current account snapshots; that differs from blanket child inheritance and needs the symptom's account IDs to evaluate.

Tests:

- `python3 tests/test-session-account-isolation.py -q`: 2 pass (0.012s).
- `node --test tests/test-session-feed.cjs`: 10 pass.
- `PLAYWRIGHT_MODULE=/mnt/ssd/homelab/tools/agent-toolkit/node_modules/playwright node tests/browser/activity-account-isolation.cjs artifacts/overnight-b-20261027/activity`: desktop/phone pass. Screenshots and result.json are in `activity/`.

The first browser draft expected three simultaneously visible phone accounts; the renderer correctly pages only two at 390px. The corrected check exercises the hidden helper through the normal account offset. An early screenshot preceded the opening animation; final screenshots wait for it and were visually inspected.

No product fix claimed. Capture only account IDs, session IDs, busy/state/status and parent IDs at the host-to-renderer boundary while the symptom occurs, plus which arcs spin and which account actually runs. Omit names, paths, transcripts and usage values. Compare producer, Orbit adapter and renderer input before changing ownership behavior. This needs the owner's affected session/device; AG-50 remains blocked on its linked capture card.

## Checks and scope

The required agent-check command was attempted before the base commit: this repository has no `agent-check.json`, so it reports that configuration error. Focused Node/Python/browser checks above are used here; no package install or broad test matrix. No product renderer or pinned Orbit copy changed, so no release/version/export update is needed.
