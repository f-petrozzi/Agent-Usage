# Live usage verification

2026-10-24. Fixtures and disposable state only; no provider requests or model
turns. The benchmark uses mock initial polls, real atomic cache/socket code,
local response-file appends, the statusline executable, the actual Orbit gateway
bound to ephemeral localhost, and the collector's session-stream subprocess.
Its paths name this session's worktrees; change AU/ORBIT to rerun elsewhere.

| Input | Shared cache | Orbit HTTP response | SSH/WSL stream payload |
| --- | ---: | ---: | ---: |
| Synthetic Codex rollout token_count | 0.874 s | 0.906 s | 1.502 s |
| Synthetic Claude terminal statusline | 0.405 s | 0.409 s | 1.502 s |
| Synthetic Claude SDK socket publication | 0.003 s | 0.007 s | 1.502 s |

These measure transport after a quota event is available, not model/provider
latency. A separate read-only real-profile discovery scan took 0.056 s, seeing
Codex B's newest event 0.391 s after its recorded timestamp (A's last event was
20.281 s old). No request was made to get these real samples. Terminal versus
VS Code Codex origins are not distinguished by quota events; both use the same
profile rollout files. Physical desktop/phone rendering is owned by the sibling
UI session and was not measured here.

Focused tests cover multi-account recorded Codex field names, irrelevant premium
buckets, malformed input, old/future samples, resumed old rollouts, partial
appends, huge tool records, truncation, per-window Claude age, missing fields,
statusline preservation/idempotence/redraw deduplication, timestamp races,
heartbeat/reset expiry, poll minimum gaps, persistent retry deadlines, socket
ownership, cache-only reads, bounded fallback, additive Windows stream data and
local consumer expiry. Orbit tests cover provenance, a real disposable HTTP
route, publication from allowed/rejected Claude events, malformed SDK events,
Codex native precision and guards, and rejecting estimates for admission.

The current Windows release cannot consume the new quota stream until a future
release; its existing 60–180-second refresh remains. No Windows release, version
bump, tag or push was performed. Claude native VS Code panel statusline invocation
and a real Claude turn remain unverified. Terminal/SDK timings above are fixtures.
No reliable quota/token calibration exists, so no transcript estimates are made.
