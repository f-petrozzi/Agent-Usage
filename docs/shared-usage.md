# Shared usage collector

One Linux user service owns Codex, Claude and Agy usage reads. Orbit, its guarded
worker queue and the Windows app consume the same versioned cache. Credentials
stay with the providers' existing local CLI profiles.

Install or upgrade on the host running the agents:

```sh
scripts/install-agent-usage.sh --force --shared-service
systemctl --user status agent-usage
agent-usage --shared --compact
```

Existing shared installations restart the service on a normal `--force` upgrade
as well. On Linux without a user systemd manager, supervise `agent-usage --serve`
with your existing process manager. Keep that process alive independently of a
browser, SSH session or desktop app. The service discovers Codex profiles at
startup; restart it after adding or removing an account.

The Windows app keeps its existing SSH/WSL command. On a shared installation,
plain `agent-usage` reads the cache and never calls a provider. Installed Orbit
code reads the same file for display, admission, active guards and naming.
Orbit's Codex rate-limit notifications are published asynchronously to the
service. The worker queue continues through Orbit's existing endpoint and its
unchanged hash-pinned 95% validator. Claude/Agy failures do not invalidate a
healthy Codex account's quota.

Codex uses one persistent, read-only app-server per account, disabling hooks,
plugins and apps. Normal checks run every 60–90 seconds (30 seconds near a
limit). Pushes never defer a poll or renew its sample timestamp. Reader disconnects reconnect with
backoff; a reader recycles after an hour and discovers new CLI installations
every five minutes. Codex uses its matching Node even with SSH's limited PATH.
Claude retains its credential-scoped five-minute cache and Retry-After
cooldown. Agy uses its structured `/usage` report every five minutes, or every
minute near a limit. Failures back off independently from one minute to fifteen
minutes; a provider's longer Retry-After takes precedence. Polls are scheduled
before reported resets, and never assume a reset makes usage zero.

The state directory is `${XDG_STATE_HOME:-~/.local/state}/agent-usage` (0700),
overridable with `AGENT_USAGE_STATE_DIR`. `shared.json` is replaced atomically
(0600), with quota data only. The service holds an exclusive file lock to
prevent duplicate readers. `updates.sock` (0600, matching peer UID required)
accepts bounded Codex quota publications; it offers no commands, profile-path
arguments, session access or execution RPCs.

Socket publications are conservative hints, even from the same UID: they can
only raise percentages for the exact already-polled window/reset or set a
blocking flag. They cannot lower usage, clear a block, alter reset times or
credits, seed an unmeasured account, clear provider failures, or make a reading
fresh. Lower values and changed windows request an early provider check, limited
to one attempt per 15 seconds and subject to existing backoff. A publication
arriving during a poll cannot suppress that poll's success/failure; only a
successful provider poll can lower the cached reading or restore freshness.

Codex readings still expire at 120 seconds, matching the worker guard. With
60–90-second normal polls, a delayed/missed check can briefly produce
`waiting_for_usage`. This pause is intentional: the service never extends a
reading's lifetime to keep the queue moving.

Schema 2 is preserved. Every account has its own `sampledAt`, `available`,
`stale`, provider, limits and optional warning. Stale accounts retain their
last successful percentage and timestamp. A ten-second heartbeat detects a
dead service after 45 seconds. Codex readings expire after two minutes;
Claude/Agy after ten minutes, or at a reported reset. Consumers also recompute
freshness when reading, so stopping the daemon cannot leave a fresh-looking
snapshot. Internal Codex quota fields retain full credit precision for Orbit's
existing spending guard; they are omitted from the public CLI snapshot.

The enabled marker and retained cache prevent a stopped/missing service from
falling back to independent polling. `--direct` is an explicit diagnostic
bypass. Unconfigured installations without a shared marker/cache retain the
portable one-shot collector. Session/history streaming is separate from quota
collection and retains the existing CLI flags.

For code rollback, stop the service, restore the previous collector executable
and Orbit service pins, then remove `shared.enabled` and `shared.json` only if
returning to independent collection. Preserve provider profiles, credentials,
session histories and the existing Claude cooldown cache. Provider failures or
an expired reading do not authorize work in a protected Orbit turn or worker.
