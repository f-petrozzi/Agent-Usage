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

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=true ;;
        -h|--help)
            printf 'Usage: %s [--force]\n' "${0##*/}"
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
install -m 755 "$SOURCE" "$TARGET"
printf 'Installed %s\n' "$TARGET"

missing=()
command -v codex >/dev/null 2>&1 || missing+=('codex')
command -v claude >/dev/null 2>&1 || missing+=('claude')
if [[ ${#missing[@]} -gt 0 ]]; then
    printf '\nNot on PATH yet: %s\n' "${missing[*]}" >&2
    printf 'Those accounts will show an error until the CLI is installed and signed in.\n' >&2
fi

printf '\nCheck it with:\n'
printf '  agent-usage --timeout 25 | head -40\n'
