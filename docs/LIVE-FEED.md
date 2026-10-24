# Live usage feed

The Agent Usage collector owns provider reads. Windows and Orbit read the same
schema-2 atomic `shared.json`; existing fields and units remain compatible.
`agent-usage --shared --compact` is the public snapshot. Orbit exposes that cache
through its existing usage endpoint (no provider request on refresh).

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
Orbit, statuslines, Windows refreshes, or session watchers.

Claude polling has a five-minute minimum gap. Fresh native samples defer it;
429 uses persistent exponential backoff (at least five minutes, up to one hour,
and longer Retry-After). A completed Claude turn schedules one fallback check
three seconds later, only if no newer native reading arrived, subject to the
same minimum gap and backoff. Duplicate session watchers cannot multiply polls.
Idle checks use the same gap. Reset times never imply a zero reading.

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
