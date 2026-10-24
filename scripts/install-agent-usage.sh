#!/usr/bin/env bash

# Install the Codex + Claude usage collector into ~/.local/bin. Run this inside
# the WSL distribution the Windows frame talks to, or on any Linux box where
# both CLIs are signed in.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/agent-usage"
BIN_DIR="$HOME/.local/bin"
TARGET="$BIN_DIR/agent-usage"
FORCE=false
SHARED=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=true ;;
        --shared-service) SHARED=true ;;
        -h|--help)
            printf 'Usage: %s [--force] [--shared-service]\n' "${0##*/}"
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            exit 1
            ;;
    esac
    shift
done

[[ -f "$SOURCE" ]] || {
    printf 'Missing collector: %s\n' "$SOURCE" >&2
    exit 1
}

if [[ -e "$TARGET" && "$FORCE" != true ]]; then
    printf 'Refusing to replace existing file: %s\n' "$TARGET" >&2
    printf 'Re-run with --force to update it.\n' >&2
    exit 1
fi

python3 "$SOURCE" --self-test || {
    printf 'The collector failed its own parser self-test. Nothing was installed.\n' >&2
    exit 1
}

mkdir -p "$BIN_DIR"
install -m 644 "$SCRIPT_DIR/agent_usage_live.py" "$BIN_DIR/agent_usage_live.py"
install -m 755 "$SCRIPT_DIR/agent-usage-claude-statusline" "$BIN_DIR/agent-usage-claude-statusline"
install -m 644 "$SCRIPT_DIR/agent_usage_service.py" "$BIN_DIR/agent_usage_service.py"
install -m 755 "$SOURCE" "$TARGET"
printf 'Installed %s\n' "$TARGET"

STATE_DIR="${AGENT_USAGE_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-usage}"
[[ ! -f "$STATE_DIR/shared.enabled" ]] || SHARED=true
if [[ "$SHARED" == true ]]; then
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR" "$STATE_DIR"
    chmod 700 "$STATE_DIR"
    install -m 644 "$SCRIPT_DIR/agent-usage.service" "$UNIT_DIR/agent-usage.service"
    # Quote systemd environment values; do not interpret shell syntax in paths.
    python3 - "$UNIT_DIR/agent-usage.service" "$STATE_DIR" <<'PY'
import json, pathlib, sys
unit = pathlib.Path(sys.argv[1])
unit.write_text(unit.read_text().replace('Environment=PYTHONDONTWRITEBYTECODE=1',
    'Environment=PYTHONDONTWRITEBYTECODE=1\nEnvironment=' + json.dumps('AGENT_USAGE_STATE_DIR=' + sys.argv[2])))
PY
    touch "$STATE_DIR/shared.enabled"
    systemctl --user daemon-reload
    systemctl --user enable agent-usage.service
    systemctl --user restart agent-usage.service
    printf 'Shared Codex, Claude and Agy service enabled. Check: systemctl --user status agent-usage\n'
fi

missing=()
command -v codex >/dev/null 2>&1 || missing+=('codex')
command -v claude >/dev/null 2>&1 || missing+=('claude')
if [[ ${#missing[@]} -gt 0 ]]; then
    printf '\nNot on PATH yet: %s\n' "${missing[*]}" >&2
    printf 'Those accounts will show an error until the CLI is installed and signed in.\n' >&2
fi

printf '\nCheck it with:\n'
printf '  agent-usage --timeout 25 | head -40\n'
