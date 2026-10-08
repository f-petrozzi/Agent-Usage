# Account identity and feature review

## Design direction

Applied Claude Code's frontend-design skill to the existing notch. Keep its black
and graphite surfaces, system typography, and quota colors. Original open-center
Codex knots remain intact; identity comes from soft symbol lighting.

Palette: Codex A blue `#74a9ff`, Codex B violet `#be99ff`, Claude orange
`#d97757`. Codex colors are account accents, not claims about OpenAI branding.
AGY uses a restrained blue/green/yellow/red blend based on the full-color asset
in [Google's press kit](https://antigravity.google/press): `#3186ff`, `#00b95c`,
`#fbbc04`, `#fc413d`. The existing provider glyphs remain unchanged.

Keep light close to the symbol, using a low-opacity diffuse halo and a tight
colored shadow. It travels with existing notch movement; no independent pulse
or continuous gradient animation. Hover/focus raises the halo only slightly,
and reduced motion removes that transition. Settings uses a quieter version.
Quota and activity rings keep their established signals. Accessible names and
optional aliases remain available because glow alone is not a reliable identity
signal for everyone.

Explicit A/B identities and stable fallback account keys survive reordering and
renaming. Extra unnamed Codex accounts currently reuse the blue treatment;
additional distinct account colors would need a separate design choice.

Native tooltips remain removed. These symbol lights are included in the 5.0.8
Windows update. The feature shortlist below remains unapproved; the
owner expressed only tentative interest in usage trends.

## Proposed features, in priority order

1. **Quota runway:** estimate whether usage will reach the limit before reset,
   using recent consumption and showing uncertainty when data is sparse.
2. **Account capacity comparison:** compare both quota windows and suggest an
   account for a new chat; keep existing chats bound to their saved identity.
3. **Needs-you queue:** a dedicated view of waiting chats, oldest first, with
   keyboard navigation and direct return to the existing VS Code session.
4. **Usage trends:** seven- and thirty-day histories by account and project,
   with session cost estimates clearly separated from subscription quota.
5. **Targeted reminders:** opt-in reset alerts, personalized quota thresholds,
   and snoozing a waiting-chat reminder without losing the underlying request.
6. **Connection diagnostics:** distinguish expired sign-in, collector failures,
   and provider outages, with last-success time and a relevant recovery action.

These extend the current sessions, alerts, account controls and quota readings,
instead of duplicating them.

## Research sources

Reviewed October 7, 2026. Feature proposals above are recommendations for Agent
Usage, not claims that every compared product implements them.

- [CodexBar](https://github.com/steipete/CodexBar): quota windows, credits and
  spending, provider incident status and multiple accounts.
- [ccusage](https://ccusage.com/guide/all-reports): daily, weekly, monthly and
  session reports across supported local sources.
- [Claude Code Usage Monitor](https://github.com/KimJintak/claude-code-usage-monitor):
  burn-rate predictions and warnings.
- [Claude Usage Monitor](https://claudeusagemonitor.com/): historical quota
  charts, burn rate and projections in a desktop widget.
