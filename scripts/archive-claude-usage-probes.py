#!/usr/bin/env python3
"""Back up completed SDK /usage-only transcripts outside Claude's resume history."""
import argparse
import datetime
import hashlib
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import re
import shutil
import time

loader = importlib.machinery.SourceFileLoader('probe_collector', str(Path(__file__).with_name('agent-usage')))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


def archive_probes(config_dir, backup_dir, apply=False, now=None):
    config_dir, backup_dir = Path(config_dir), Path(backup_dir)
    now = time.time() if now is None else now
    active = {s.get('sessionId') for s in usage.claude_sessions(config_dir, True)}
    result = []
    for path in sorted((config_dir / 'projects').glob('*/*.jsonl')):
        if path.is_symlink() or not path.resolve().is_relative_to((config_dir / 'projects').resolve()):
            continue
        if not re.fullmatch(r'[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}', path.stem) or path.stem in active:
            continue
        try:
            before = path.stat()
            if before.st_size > 65536 or now - before.st_mtime < 300:
                continue
            raw = path.read_bytes()
            records = [json.loads(line) for line in raw.splitlines() if line.strip()]
            if not all(isinstance(record, dict) for record in records) or not usage._claude_usage_probe(records):
                continue
            current = path.stat()
            if (current.st_ino, current.st_size, current.st_mtime_ns) != (before.st_ino, before.st_size, before.st_mtime_ns):
                continue
            destination = backup_dir / path.parent.name / path.name
            if destination.exists():
                continue
            entry = {'original':str(path.absolute()), 'backup':str(destination.absolute()), 'sha256':hashlib.sha256(raw).hexdigest(), 'bytes':len(raw)}
            if apply:
                backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                # Record the recovery path before moving; partial runs remain recoverable.
                with (backup_dir / 'manifest.jsonl').open('a', encoding='utf-8') as manifest:
                    manifest.write(json.dumps(entry) + '\n')
                shutil.move(str(path), str(destination))
            result.append(entry)
        except (OSError, ValueError, UnicodeDecodeError):
            continue
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Move confirmed inactive probes into a recoverable backup; otherwise preview only.')
    parser.add_argument('--config-dir', type=Path, default=usage.claude_config_dir())
    parser.add_argument('--backup-dir', type=Path, default=Path.home() / '.local/state/agent-usage/claude-usage-probes' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    args = parser.parse_args()
    rows = archive_probes(args.config_dir, args.backup_dir, args.apply)
    print(f"{'Archived' if args.apply else 'Found'} {len(rows)} completed usage-only probes.")
    if rows:
        print(f"Backup location: {args.backup_dir}")
