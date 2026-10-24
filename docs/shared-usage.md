# Shared usage collector

One Linux user service owns provider usage requests. Orbit and the Windows app
consume its schema-2 atomic cache. Credentials stay in existing CLI profiles.
The additive [live feed contract](LIVE-FEED.md) owns fields, source names and ages.

```sh
scripts/install-agent-usage.sh --force --shared-service
systemctl --user status agent-usage
agent-usage --shared --compact
```

A normal `--force` upgrade also restarts an existing shared installation. Without
a user systemd manager, supervise `agent-usage --serve` independently of the app
or SSH session. Restart after adding or removing Codex profiles.

## Native readings first

The service reads quota events from recently modified Codex rollouts, including
old sessions resumed today and both account profiles. It only parses quota
records, skips oversized tool output, and retains complete-line offsets. Orbit
publishes native app-server notifications on a bounded background queue; Claude
publishes measured SDK rate-limit events, including allowed states. Each window
retains its own source and sample time. Out-of-order readings cannot replace
newer windows. Partial events retain omitted windows without refreshing them.

For Claude terminal responses, install the optional statusline capture:

```sh
~/.local/bin/agent-usage-claude-statusline --install
```

This atomically edits `~/.claude/settings.json`, preserves other settings, and
wraps an existing statusLine command with the same stdin. Its former setting is
retained at `statusline-previous.json` in the collector state directory. Missing
`rate_limits` leaves the last reading alone. Repeated footer redraws with the
same response counters and quotas do not renew the sample. The cache stores only
quota fields, timestamps and hashes; no transcript, workspace or credentials.
The command prints the original statusline, or a minimal reading from the shared
cache. To undo, restore the saved `statusLine` value in Claude settings.

[Claude documents](https://code.claude.com/docs/en/statusline) the subscription
`rate_limits` payload after an API response. The terminal inside VS Code uses the
same CLI statusline. Native VS Code panel invocation is **unverified**: the
installed 2.1.308 extension/webview has no apparent configured-statusline output
handler, and earlier [provider issue reports](https://github.com/anthropics/claude-code/issues/68811)
report it missing. Do not count on that panel producing this feed; its activity
still uses the shared fallback. No paid test turn was launched to settle this.

## Fallback and freshness

Codex fallback uses one persistent read-only app-server per account; it polls
only when native samples expire (120 seconds), with a 60-second minimum gap.
It disables hooks, plugins and apps for the read-only reader, reconnects with
backoff, recycles after one hour, and discovers CLI upgrades every five minutes.

Claude fallback uses only `/api/oauth/usage`, at least five minutes apart. Fresh
native samples defer it until their 600-second freshness expires. Completed
Claude turns, detected from the same local activity as `--watch-sessions`,
schedule one coalesced fallback three seconds later if no native reading arrived.
The minimum gap and persistent Retry-After/backoff apply to these checks too.
The shared service never starts `claude -p /usage`; expired credentials require
normal CLI sign-in. Its credential-scoped cache retains exponential 429 backoff
from five minutes up to one hour, or longer Retry-After. Restarting the service
preserves attempt times and cooldowns. Agy retains its five-minute polling (one
minute near a limit). Resets never imply zero usage.

Stale values keep their last sample times and percentages. Consumers recompute
age and reset expiry on read; a heartbeat older than 45 seconds means the service
is unavailable. A recent response can recover displayed freshness during a
provider polling failure without bypassing its endpoint cooldown. No transcript
estimates are fabricated: account-level percentages cannot be reliably inferred
from token counts without calibration. `estimate` is reserved and cannot admit
a guarded Orbit turn.

## Consumers and local storage

Plain `agent-usage` on a shared installation only reads the cache. The enabled
marker prevents a stopped/missing daemon from falling back to independent
polling. `--direct` is an explicit diagnostic bypass. Unconfigured portable
installations retain one-shot collection.

`--watch-sessions` adds `usage` to its existing schema-1 session lines. New app
code consumes those snapshots over its existing SSH/WSL connection every 1.5
seconds or on change. Older Windows versions ignore the additive field and keep
their 60–180-second quota refresh. This backend change publishes no Windows
release; the Windows stream consumer requires a subsequent release.

`${XDG_STATE_HOME:-~/.local/state}/agent-usage` is mode 0700, overridable with
`AGENT_USAGE_STATE_DIR`. `shared.json` and `updates.sock` are 0600. The service
holds an exclusive lock. The socket requires a matching peer UID, accepts only
bounded known-account quota objects, and exposes no execution or credentials.
Native response publications are authoritative within this same-user boundary.
`_native` preserves full precision for Orbit guards and is omitted from public
CLI/stream output. A ten-second heartbeat is independent of sample time.

For rollback, stop the service and restore the earlier collector plus companion
modules. Restore the statusline setting before removing its script. Preserve
profiles, credentials, histories and the Claude cooldown cache. Remove the
shared marker/cache only when deliberately returning to independent collection.

Fixture transport timings and focused checks are in the [verification record](../artifacts/live-feed-20261024/VERIFICATION.md).
