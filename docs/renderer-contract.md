# Renderer boundaries

`runtime.js` owns analytic spring integration, the shared animation-frame
scheduler and conditional SVG attribute writes. Every simulation callback for a
frame runs before keyed paints. Paint priority is body (10), attached detail
surface (20), notification slivers (30), log ink (35), rim geometry (40), rim light (45) and
hit regions (50). A later mutation of an already painted surface is deferred to
the next frame. Work stops at rest. CSS/WAAPI activity rotation remains owned by
the compositor and pauses when hidden. Springs preserve velocity on reversal
and clamp resumed elapsed time to 100 ms; reduced motion jumps to the target.

`localization.js` owns the catalog and translation helpers. `notch.js` owns
accounts, gauges, card content and controls; it exposes `availableProviders()` and the viewport subset `providers()` directly.
`shape.js` owns body/handle/sprout geometry. `details.js` owns attached panel
geometry. `notify.js` owns slivers; `notification-rim.js` caches the union contour
before writing its clones and changes only sweep progress at rest.
`motion.js` owns perimeter following and display-transfer acknowledgments.
`session-tools.js` owns keyed Sessions rows, keyboard selection, history refresh
and account-focus layout. `notch-base.css` contains the extracted base component
styles; `agent-usage.css` contains the product's later component overrides.
Script order in `notch.html` declares these dependencies. No global DOM prototype
patches or runtime replacement of `providers()` are used.

State concerns stay independent:

| Concern | Owner and contract |
| --- | --- |
| Visibility | Main `visible/phase`, renderer `shown/openness`; hide closes panels and pauses activity |
| Display transfer | Main placement token/stage, renderer placement revision; only matching stow/paint acknowledgments unmask the destination |
| Active panel | `hoverId`, `cardHeld`, detail target; Sessions is searchable immediately while its silhouette moves |
| Interaction | Main held/carrying flags, renderer tracking/hover; pointer targets cannot bypass transfer masks |
| Notifications | Sliver map, queued alerts and rim; interruption clears owned jobs independently of panel state |
| Account identity | Stable collector ID; optional aliases affect displayed names only |

Geometry and hot regions use CSS pixels in the renderer. Main multiplies hot
regions by Electron zoom for DIP hit testing. The native mouse hook sends
physical coordinates with monotonic timestamps, coalesced to the latest sample
at a maximum 250 Hz while held/pressed. Main converts through
[`screenToDipPoint`](https://www.electronjs.org/docs/latest/api/screen#screenscreentodippointpoint-windows-linux)
and follows without running click-through/topmost work. The 16 ms tick remains
the visibility watchdog and pointer fallback after 32 ms without native input.
The low-level hook never waits on pipe output. Old child generations and old
pointer timestamps are ignored.

Session opening bypasses history only for a feed snapshot less than 20 seconds
old in the current collector scope, for a known account with verified terminal
ancestry. This route is focus-only and cannot create a duplicate terminal.
History/resume remains the fallback, with scope revalidation after asynchronous
metadata/helper work and receipt-based confirmation in VS Code.

Arm material timing is defined by `ARM_MOTION` in shape.js. Hover targets change
immediately and analytic springs retain their velocity. Strand geometry depends
on the current position rather than the direction of its target, making hover
reversal continuous. The root's CSS stow delay matches the arm absorption time;
native pointer following and hit rectangles do not wait for the visual morph.
This follows [velocity-continuous spring guidance](https://developer.android.com/develop/ui/compose/animation/customize#spring)
and preserves [reduced-motion support](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
