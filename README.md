# Agent Usage

A borderless Windows overlay showing how much Codex and Claude capacity is left
across every account, when each window resets, and whether your current burn
rate will empty a window before it does.

![The frame in expanded and compact modes](docs/preview.png)

It is built to sit on a second monitor while something else is full screen, so
it never takes focus and never disturbs the foreground app.

```
Windows                     Linux, WSL, or any box reachable over SSH
AgentUsageFrame.exe  --->   ~/.local/bin/agent-usage
  (draws)                     |-- codex app-server  (once per profile)
                              '-- claude usage      (endpoint, CLI fallback)
```

The Windows app never opens a credential file. It runs one read-only collector
and draws the answer.

## Reading the frame

Every meter shows **what is left**, not what is spent, and drains as you work.

- **Colour** is headroom: seafoam above 40%, brass down to 15%, coral below.
- **The notch** on each ring and bar marks how much of that window's *clock* is
  left. Fill past the notch means you are ahead of the window; fill short of it
  means you will run dry before the reset.
- **The two rings** are the two windows: outer is the 5-hour window, inner is
  the weekly one. The number in the middle is whichever has less left.
- **"At this pace, empty by 4:14pm"** appears only when the average burn rate
  so far would exhaust a window before it resets.
- **"Out until 12:51am"** replaces it once a window is spent.
- Banked rate-limit resets and credit balances show on the right, so you know
  what you can fall back on.
- A dot beside a Codex account marks the profile that is currently selected.

Double-click, or use the chevron, to fold down to the gauge cluster. Drag
anywhere to move it; position and mode are remembered between runs.

## Requirements

- Windows 10 or 11 (the .NET Framework 4 compiler ships with Windows; nothing
  is downloaded to build the app).
- Python 3.9+ wherever the collector runs.
- The `codex` and/or `claude` CLI, signed in, on that same machine.

Either provider may be missing. A provider that cannot be read shows an error
on its own row and leaves the others working.

## Install the collector

Run this on the machine that actually runs your agents -- see
[Where to read from](#where-to-read-from).

```bash
git clone https://github.com/f-petrozzi/Agent-Usage.git
cd Agent-Usage
scripts/install-agent-usage.sh
```

It self-tests before installing to `~/.local/bin/agent-usage`. Check it:

```bash
agent-usage --timeout 25
```

You should get a JSON document with one entry per account.

### Codex accounts

Two layouts are supported, with no configuration:

- **One account** -- `~/.codex`, or wherever `CODEX_HOME` points.
- **Several accounts** -- a directory of profiles, each its own `CODEX_HOME`,
  under `~/.local/share/codex-accounts/profiles/` or `$CODEX_ACCOUNTS_DIR`.
  Every profile found is shown.

### Claude account

Whichever account `claude` itself is signed in to, read from
`$CLAUDE_CONFIG_DIR` or `~/.claude`.

### Options

```bash
agent-usage --codex-accounts a b   # only these profiles
agent-usage --codex-accounts       # skip Codex entirely
agent-usage --no-claude            # skip Claude
agent-usage --compact              # one-line JSON
agent-usage --self-test            # check the parsers, print nothing
```

## Install the frame

Copy the `windows` directory to the PC, then from PowerShell:

```powershell
powershell.exe -NoProfile -File .\windows\install.ps1 -Ssh user@host
```

Drop `-Ssh user@host` to read from the local WSL distribution instead. Add
`-Autostart` to launch it at sign-in, and `-Force` when updating an existing
install.

The installer compiles the source, runs the executable's `--self-test`, and
only then installs to `%LOCALAPPDATA%\AgentUsageFrame`. Uninstall with
`.\windows\uninstall.ps1`, which removes the Windows app only.

## Where to read from

Both providers report usage server-side, so the percentages are identical no
matter which machine asks -- work done on a server, in WSL, or on a phone all
lands in the same numbers. What is *not* shared is the knowledge that a prompt
just ran, and that is what decides how eagerly the frame polls.

So point it at the machine that runs your agents. SSH mode needs key-based auth
that completes with no password prompt, the Windows OpenSSH client, and the
collector already installed on the far side. `install.ps1` checks all three
before it installs anything.

The target is validated as `host` or `user@host` and stored in `state.json`. A
hand-edited value that does not match is ignored, and the frame falls back to
WSL rather than passing it to a shell.

The trade is a dependency: if that machine is unreachable the frame shows
`Can't read limits` and backs off. It is not running your agents in that state
either, so the numbers would not be moving anyway.

## Full-screen games

The old version of this tool tabbed you out of a full-screen game every five
minutes. The cause was calling `ClientSize = ...` on each refresh: resizing a
top-most window re-asserts z-order, and the compositor answers by dropping an
exclusive-fullscreen game to the desktop. Four things prevent it now:

- The window carries `WS_EX_NOACTIVATE` and `WS_EX_TOOLWINDOW` and answers
  `WM_MOUSEACTIVATE` with `MA_NOACTIVATE`, so it cannot take focus even when
  clicked, and never appears in Alt-Tab or the taskbar. Dragging moves it with
  `SetWindowPos` rather than a modal move loop.
- Refreshing repaints one canvas. No control is created, destroyed, or resized,
  so a refresh cannot change z-order at all.
- When a full-screen app is detected the frame drops top-most by itself and the
  header reads `pin paused for full screen`. It stays visible on your other
  monitor, just no longer above everything, and top-most returns afterwards.
- The redraw rate drops from 1 s to 5 s while a full-screen app is foreground,
  and the collector call runs hidden with no console window.

The pin button turns top-most off permanently if you would rather it never
floated at all.

## Refresh cadence

Neither provider charges model tokens for these reads -- Codex answers from a
local app-server and Claude from a usage endpoint -- but polling on a fixed
timer is still wasteful, so the frame polls on change instead:

| Situation | Next read |
| --- | --- |
| A prompt ran in either CLI on the read machine in the last 6 minutes | 60 s |
| Numbers unchanged since the last read | 90 s, then 150 s, 300 s, 600 s |
| A window resets before that | just after the reset |
| A full-screen app is foreground and nothing is running | 300 s floor |
| The last read failed | 30 s, doubling to a 300 s cap |

The floor is 45 seconds and the ceiling is 15 minutes. Knowing whether anything
is running comes free: the collector reports the newest mtime across
`~/.claude/history.jsonl` and each Codex home's `history.jsonl`, so no extra
network call is needed. Those files only move on the machine running the
collector, which is the reason to put it where the work happens. Read the wrong
box and the frame still catches every change, just up to 10 minutes later,
because a moved percentage also resets the backoff.

## Security model

- The executable is compiled locally from the C# source in this repository. It
  is unsigned, because it is a personal tool you build yourself.
- Windows never opens or copies a Codex or Claude credential file.
- Codex is read through the documented app-server `account/rateLimits/read`
  method, started once per profile with that profile's `CODEX_HOME`.
- Claude is read through `GET /api/oauth/usage`, the endpoint Claude Code's own
  `/usage` command calls, using the access token Claude Code already cached. If
  that token is expired or the endpoint moves, the collector runs
  `claude -p /usage` -- which refreshes the token -- and parses its output. The
  endpoint is not a published API, so treat the fallback as the guarantee.
- No login, logout, or account change is ever performed.
- The command passed to WSL or SSH is fixed, and an SSH target that is not a
  bare `host` or `user@host` is refused; collector output cannot inject
  commands.
- JSON input is capped at 1 MiB, error text is truncated, and the subprocess has
  a 90-second timeout.

## Tests

```bash
tests/test-agent-usage.sh
```

Covers the collector's parsers, multiple Codex profiles against a stub
app-server, a single-account install with no profiles directory, the Claude
endpoint path, the CLI fallback path, and one provider failing without taking
the others down.

The Windows executable's `--self-test` covers snapshot parsing, the headroom
thresholds, countdown formatting, and SSH target validation. `install.ps1` runs
it and refuses to install on failure.

## Reference

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
