"""Explicit refresh requests share the collector scheduler and provider cooldowns."""
import json
import socket
import time


def schedule(service, ident):
    if ident in service.inflight:
        return False
    row = service.rows[ident]
    from agent_usage_service import MIN_GAP
    earliest = max(time.time(), row.get('pollRetryAt') or 0,
                   (row.get('pollAttemptedAt') or 0) + MIN_GAP[row['provider']])
    service.due[ident] = min(service.due[ident], time.monotonic() + earliest - time.time())
    return True


def handle(service):
    with service.lock:
        requested = [ident for ident in service.queries if schedule(service, ident)]
    return {'accepted': True, 'checkRequested': requested}


def request(path):
    """Request a check, never query a provider or bypass retry deadlines."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(str(path))
        client.sendall(b'{"operation":"refresh"}\n')
        with client.makefile('rb') as source:
            raw = source.readline(65537)
        if len(raw) > 65536 or not raw.endswith(b'\n'):
            raise ValueError('Invalid refresh receipt')
        receipt = json.loads(raw)
        if receipt.get('accepted') is not True:
            raise ValueError('Collector rejected refresh request')
        return receipt
