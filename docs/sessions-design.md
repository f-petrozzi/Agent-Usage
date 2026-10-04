# Attached Sessions

Usage stays quiet: gauges, reset times, credits and the current Working/Waiting
rows. Saved chats live behind a history icon in the account header. Clicking it
opens Sessions for that account, in the same attached frame. Back restores usage.
The global Sessions shortcut opens All agents.

## Design choices

- Black `#000` remains the material; `#181818` defines interactive surfaces.
  Text uses `#fff` and `#aaa`; keyboard focus uses the existing `#8bafff` blue.
- Keep the existing Segoe UI/system typography: Sessions heading 17px, chat
  titles/search 14px, supporting text 12px. Preserve physical text size at Small.
- Keep content left aligned and the frame centered on its existing notch anchor.
  The saved-history disclosure is removed from usage rather than duplicated.
- Spend the distinctive motion on one visible droplet. A bead pulls out of the
  frame's exposed edge, remains joined by a liquid neck, then merges home over
  420ms. The outline changes size without closing and reopening the notch.
- Search receives focus in the click turn. Cached rows stay available while
  refreshing; the animation never gates typing, filtering or opening a chat.

```
Usage                              Sessions for this account
┌──── attached to notch ────┐       ┌──── attached to notch ──────────┐
│ Agent          history ↻ │       │ ← Sessions                     │
│ Usage windows            │  →    │ Search                         │
│ Resets / credits         │       │ Account filter                 │
│ Working / Waiting        │       │ Pinned / recent chats (scroll) │
└──────────────────────────┘       └───────────────────────┬────────┘
                                                          ●
```

The detached panel proposal required two simultaneously visible frames. The
accepted direction replaces usage in place, so it preserves the quiet surface
and one point of attention. The bead is large enough to see outside the actual
outline; it is not a tiny ripple hidden inside the frame.

## Motion and validation

The existing detail spring retains its open state and anchor. During the morph,
geometry follows its new dimensions faster; readable HTML is never scaled or
goo filtered. Only a small SVG band around the bead receives the liquid filter.
The bead follows the live edge and limits its excursion to available screen room.
Hide, drag, monitor transfer, resize, another account and reduced-motion changes
cancel it. No timer can bring it back after closing.

The history browser suite checks all four edges, physical attachment, a visible
bead outside the main outline, immediate search, account identity, Back, keyboard
resume, bounded scrolling, global search, AGY Working, interruption, small
viewports and reduced motion. The existing Sessions suite covers pins, automatic
refresh, resume acknowledgments, filters and focus behavior.

[Actual animation](images/sessions-motion.gif), [droplet snapshot](images/droplet.png)
and [settled account Sessions](images/account-sessions.png) use fictional accounts
and chats rendered by `scripts/render-readme.cjs`. Its `--motion` option records
the real frontend to `/tmp/agent-usage-session-motion` for GIF/video export.
