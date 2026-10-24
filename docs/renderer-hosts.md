# Renderer hosts

`desktop/ui` is the single renderer source for Windows and Orbit. A host supplies
`window.agentUsage.invoke(command, args)` and `on(event, callback)` before
`bridge.js`; see `desktop/preload.cjs` for the native boundary. The desktop
entry points and Windows behavior are unchanged.

Export an exact copy, licenses and SHA-256 manifest with:

```sh
python3 scripts/export-renderer.py /path/to/destination
```

Orbit pins that export in its public assets and generates separate entry
documents that load its browser adapter first. This keeps Orbit deployments
self-contained: the web image cannot depend on a neighboring host checkout.
Orbit's `scripts/sync_agent_usage.py` runs the export explicitly; deployments
never silently sync a moving branch. Shapes, cards, alerts, account settings
and motion stay in these renderer files. Browser key/touch/viewport behavior
belongs to Orbit's host; collector and Windows window/input code stay here.

No Windows version bump, tag or release is needed for export tooling alone.
