#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTOR="$REPO_ROOT/scripts/agent-usage"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
export CODEX_ACCOUNTS_DIR="$TEST_ROOT/accounts"
export CODEX_BIN="$TEST_ROOT/fake-codex"
export CLAUDE_BIN="$TEST_ROOT/fake-claude"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
mkdir -p "$CODEX_ACCOUNTS_DIR/profiles/a" "$CODEX_ACCOUNTS_DIR/profiles/b" "$CLAUDE_CONFIG_DIR"
printf 'a\n' > "$CODEX_ACCOUNTS_DIR/active"

"$COLLECTOR" --self-test
printf 'PASS: parser self-test\n'

cat > "$CODEX_BIN" <<'EOF'
#!/usr/bin/env bash
while IFS= read -r line; do
    case "$line" in
        *'"method":"initialize"'*)
            printf '%s\n' '{"id":0,"result":{"userAgent":"test"}}'
            ;;
        *'"method":"account/rateLimits/read"'*)
            printf '%s\n' '{"id":1,"result":{"rateLimits":{"limitId":"codex","planType":"pro","primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":1893456000},"secondary":{"usedPercent":40,"windowDurationMins":10080,"resetsAt":1893888000},"credits":{"hasCredits":true,"unlimited":false,"balance":"1294.1415"},"rateLimitReachedType":null},"rateLimitsByLimitId":null,"rateLimitResetCredits":{"availableCount":2}}}'
            ;;
    esac
done
EOF
chmod 755 "$CODEX_BIN"

# The token has to look unexpired or the collector goes straight to the CLI.
future_ms=$(python3 -c 'import time; print(int((time.time() + 3600) * 1000))')
cat > "$CLAUDE_CONFIG_DIR/.credentials.json" <<EOF
{"claudeAiOauth":{"accessToken":"test-token","expiresAt":$future_ms,"subscriptionType":"pro"}}
EOF

cat > "$TEST_ROOT/usage.json" <<'EOF'
{"limits":[
  {"kind":"session","group":"session","percent":6,"resets_at":"2026-09-08T08:00:00+00:00"},
  {"kind":"weekly_all","group":"weekly","percent":20,"resets_at":"2026-09-08T04:00:00+00:00"}],
 "extra_usage":{"is_enabled":true,"disabled_reason":null},
 "spend":{"used":{"amount_minor":8385,"currency":"USD","exponent":2}}}
EOF

# --- the endpoint path, with both providers answering -----------------------
output="$(AGENT_USAGE_CLAUDE_URL="file://$TEST_ROOT/usage.json" \
    "$COLLECTOR" --codex-accounts a b --timeout 5)"
python3 -c '
import json, sys
doc = json.load(sys.stdin)
assert doc["schema"] == 2, doc["schema"]
accounts = {row["id"]: row for row in doc["accounts"]}
assert set(accounts) == {"codex:a", "codex:b", "claude"}, sorted(accounts)

a = accounts["codex:a"]
assert a["provider"] == "codex" and a["plan"] == "pro", a
assert a["active"] is True and accounts["codex:b"]["active"] is False
assert a["resetCredits"] == 2 and a["creditBalance"] == 1294.14, a
assert [(l["label"], l["usedPercent"], l["windowMins"]) for l in a["limits"]] == [
    ("5 hours", 25, 300), ("Weekly", 40, 10080)], a["limits"]
assert a["limits"][0]["resetsAt"] == 1893456000

c = accounts["claude"]
assert c["plan"] == "pro" and c["error"] is None, c
assert [(l["label"], l["usedPercent"], l["windowMins"]) for l in c["limits"]] == [
    ("5 hours", 6, 300), ("Weekly", 20, 10080)], c["limits"]
assert c["limits"][0]["resetsAt"] == 1788854400, c["limits"][0]
assert c["extraUsage"] == {"enabled": True, "usedDollars": 83.85, "reason": None}, c["extraUsage"]
assert c["blocked"] is False
' <<< "$output"
printf 'PASS: codex profiles and the Claude usage endpoint\n'

# --- the fallback path, when the endpoint is unreachable --------------------
cat > "$CLAUDE_BIN" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"result":"Current session: 5% used · resets Sep 8, 4am (America/New_York)\nCurrent week (all models): 100% used · resets Sep 8, 12:30am (America/New_York)\n"}'
EOF
chmod 755 "$CLAUDE_BIN"

output="$(AGENT_USAGE_CLAUDE_URL="file://$TEST_ROOT/absent.json" \
    "$COLLECTOR" --codex-accounts --timeout 5)"
python3 -c '
import json, sys
doc = json.load(sys.stdin)
assert [row["id"] for row in doc["accounts"]] == ["claude"], doc["accounts"]
claude = doc["accounts"][0]
assert claude["error"] is None, claude["error"]
assert [(l["label"], l["usedPercent"]) for l in claude["limits"]] == [
    ("5 hours", 5), ("Weekly", 100)], claude["limits"]
assert all(isinstance(l["resetsAt"], int) for l in claude["limits"]), claude["limits"]
assert claude["blocked"] is True, claude
' <<< "$output"
printf 'PASS: Claude falls back to the CLI when the endpoint is unreachable\n'

# --- a signed-out provider must not take the others down --------------------
output="$(CLAUDE_BIN="$TEST_ROOT/missing-claude" \
    AGENT_USAGE_CLAUDE_URL="file://$TEST_ROOT/absent.json" \
    "$COLLECTOR" --codex-accounts a --timeout 5)"
python3 -c '
import json, sys
doc = json.load(sys.stdin)
accounts = {row["id"]: row for row in doc["accounts"]}
assert accounts["codex:a"]["error"] is None, accounts["codex:a"]
assert accounts["claude"]["error"], accounts["claude"]
assert accounts["claude"]["limits"] == []
' <<< "$output"
printf 'PASS: one broken provider leaves the others readable\n'

# --- a plain single-account install, with no profiles directory -------------
mkdir -p "$TEST_ROOT/solo/.codex"
output="$(HOME="$TEST_ROOT/solo" CODEX_ACCOUNTS_DIR="$TEST_ROOT/solo/none" \
    CLAUDE_CONFIG_DIR="$TEST_ROOT/solo/.claude" \
    AGENT_USAGE_CLAUDE_URL="file://$TEST_ROOT/absent.json" \
    CLAUDE_BIN="$TEST_ROOT/missing-claude" \
    "$COLLECTOR" --timeout 5)"
python3 -c '
import json, sys
doc = json.load(sys.stdin)
ids = [row["id"] for row in doc["accounts"]]
assert "codex:codex" in ids, ids
codex = [row for row in doc["accounts"] if row["id"] == "codex:codex"][0]
assert codex["error"] is None, codex
assert codex["limits"], codex
' <<< "$output"
printf 'PASS: a bare ~/.codex install is read without a profiles directory\n'

printf '\nPASS: agent usage collector\n'
