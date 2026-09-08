# Browser preview

Homelab: http://petro.ink:4444/agent-usage/ (also linked from Homepage on port 3000).
The existing homelab preview container serves this directory read-only. Edit and
refresh; no build, account access, collector polling, or model calls are needed.

Standalone: `python3 -m http.server 4444 --bind 127.0.0.1 --directory preview`
from the repository root, then open http://localhost:4444.

The page represents `windows/AgentUsageFrame.cs` using sample data. Controls cover
expanded/compact views, zoom, normal, low, exhausted, error, loading, full, stale, and unavailable-expiry states.
The 5-hour/Weekly selector controls the large gauge values and is remembered
along with compact mode. Hover or focus the banked-reset count to tween open sample expiration dates inline.
Compact mode is a 192 × 64 strip with controls tweened into view on hover or keyboard focus. Account hover reveals a
small reset-time row.
Accepted visual changes must also be applied to the Windows source. Browser fonts
may differ; native focus, pinning, dragging, and fullscreen behavior need Windows
testing. Keep this preview and the Windows UI in sync when changing the design.

Hosting lives in the homelab repository: docker-compose.yml,
portfolio-preview/nginx.conf, and homepage/config/services.yaml.
