# Frontend provenance

`ui/notch.html`, `ui/settings.html` and their extracted scripts/styles derive from
vinzdg/codenotch's Windows frontend at commit
00833690311067354c77951fcaaf6ffca774916e (MIT; notices alongside this file).
The two bundled provider glyphs come from the same revision.

Adaptations: Electron IPC bridge, multiple collector accounts, banked-reset details,
hidden startup/held shortcut/pinning, remote collector settings, and display-local
placement. Provider credential access, local agent hooks, screen capture, and upstream
updaters are not included. Those unsupported controls are removed from the adopted UI.

The source was read as untrusted data. No upstream installation/build scripts ran.
The earlier targeted prompt-injection scan found no obvious instructions; this is
not an exhaustive security audit.
