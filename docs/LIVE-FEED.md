# Live usage feed

The Agent Usage collector owns provider reads. Windows and Orbit read the same
schema-2 atomic `shared.json`; existing fields and units remain compatible.
`agent-usage --shared --compact` is the public snapshot. Orbit exposes that cache
through its existing usage endpoint (no provider request on cache reads).

Each account keeps `id` (`codex:a`, `codex:b`, `claude`), `provider`, `label`,
`limits` (`label`, `usedPercent` 0–100, `windowMins`, `resetsAt` Unix seconds),
`available`, `stale`, `sampledAt` (Unix seconds), and optional quota metadata.
Additive fields:

- `source`: `live`, `poll`, or `estimate` (reserved; no uncalibrated estimates).
- `origin`: `codex-session`, `codex-runtime`, `claude-statusline`,
  `claude-runtime`, or `provider-poll`.
- `receivedAt`: collector receipt time, distinct from the provider sample time.
- Each limit carries its own `sampledAt`, `source`, and `origin`, because Claude
  SDK events can update just one window. Account `sampledAt` is the oldest
  represented window; the collector never stamps retained windows as new.
- `refresh`: an additive object separating measurement freshness from the last
  refresh attempt. `state` is `ok`, `rate_limited`, `auth`, `network`, `parse`,
  `process`, or `unknown` (also used before the first reading). `attemptAt` is the
  latest fallback attempt time, `successAt` the receipt time of the latest
  accepted reading from any source, and `retryAt` the planned failed-refresh
  retry time. Times are Unix seconds or null when not applicable/known. Accepted
  readings clear the refresh error and failure count, even if another source's
  persisted 429 cooldown still defers polling. A failure preserves `limits`,
  `sampledAt`, `source` and `origin`, with a specific short `warning` such as
  `Refresh rate-limited; next try 14:32`. A warning does not itself imply stale;
  `error` remains null when a last reading exists.

Orbit's compatibility response keeps `fetched_at` and adds `sampledAt`, `source`,
`origin`, `receivedAt`, `provider`, `warning`, and `error` per account. A refreshed
HTTP response does not refresh its usage. Render stale values with their sample
time; keep the last known percentage when the collector/provider is unavailable.
Recompute age in the consumer: Codex 120 seconds, Claude/Agy 600 seconds; passed
resets and a collector heartbeat older than 45 seconds also mean stale. An
estimate never authorizes a guarded turn.

Native Codex `account/rateLimits/updated` messages and rollout `event_msg` /
`token_count` / `payload.rate_limits` readings are authoritative, in timestamp
order. The verified rollout fields are `limit_id`, `primary`/`secondary` with
`used_percent`, `window_minutes`, `resets_at`, plus `plan_type` and `credits`.
Ignore non-Codex buckets and events with no measured windows. Poll only while
native samples are stale. Local rollout discovery runs every second, including
both CLI profiles. Native Orbit publications use the private UID-checked socket.

Claude's statusline command writes only rate-limit fields plus sample time to
`claude-live.json` in the state directory, then prints the previous statusline
(or a minimal quota line). Missing fields retain the previous reading and time.
SDK events update their named window using `utilization` × 100 and `resets_at`.
One-window events cannot freshen another window. No usage endpoint is called by
Orbit, statuslines or session watchers. An explicit Windows refresh uses
`agent-usage --refresh --compact` to request the earliest permitted check through
the UID-checked collector socket, then reads the cache. It retains minimum gaps,
in-flight deduplication and persisted Retry-After deadlines; acceptance is a
scheduling receipt, never proof of a new sample. An expired reset timestamp says
Waiting for usage update until measured data arrives, retaining the last value.

Claude polling normally has a five-minute minimum gap. Successful cached readings
expire 15 seconds after a quota reset, subject to a 60-second request gap, so
the collector’s reset check reaches the provider. Failure cooldowns remain authoritative. Fresh native samples defer it;
429 retries use five, ten, then fifteen minutes, with small positive jitter
within that cap. Positive Retry-After values override the cap; zero or missing
values use the schedule. Network failures retry in five minutes, auth failures
pause thirty minutes or until credentials mtime changes, and parse failures pause
an hour or until the CLI version changes. Attempt times and 429 cooldowns persist
across restarts. A completed Claude turn schedules one fallback check
ten seconds later, only if no newer native reading arrived, subject to the
same minimum gap and backoff. Duplicate session watchers cannot multiply polls.
Idle checks use the same gap. Reset times never imply a zero reading.
Agy fallback always uses a five-minute minimum, including near a limit. Codex
network retries use one, two, then five minutes (Agy uses its five-minute floor);
Codex/Agy rate limits use five then fifteen minutes, and parse failures one hour.

The owner-local `refresh.jsonl` journal rotates at 512 KiB with one previous file.
Events contain `time`, `account`, `source` (`poll`, `live`, `rollout`, `statusline`),
`outcome` (`ok`, `ignored`, an error class, or Claude `publication`/`unmeasured`),
`httpStatus`, and `retryAfter` (parsed seconds, null when absent). Claude live
publication events include `five_hour` and `seven_day` booleans indicating
utilization presence in the publication, including SDK events without a meter.
No raw payloads, bodies, credentials, headers, transcripts or paths are retained.
`stoppedAt` is an optional top-level timestamp marking a stopped collector;
consumers should also keep the existing heartbeat check.

The existing schema-1 `--watch-sessions` lines add a `usage` member containing
the public schema-2 snapshot (no `_native`). It changes when quota or stale state
changes, with the existing 15-second heartbeat. Discovery cadence is 1.5 seconds
for stream readers and one second for the collector's local sources. Orbit's
compatibility `retry_after` is two seconds. These are local cache reads only.

The new Windows stream consumer is implemented in `desktop/collector.cjs` and
wired in `desktop/main.cjs`; the currently released Windows app ignores the
additive field and retains its existing 60–180-second refresh. No Windows release
is part of this collector/Orbit change. Native Claude VS Code panel statusline
invocation remains unverified; see [shared usage](shared-usage.md).
