"""Exclude collector-owned Claude checks from activity, using local process ownership.

Claude may replace its argv with a process title, so inspect its collector ancestor
instead. Match exact collector script paths, never session names, durations, SDK
entrypoints or arbitrary arguments containing a path. Uncertain identity stays visible.
"""
from pathlib import Path
import os
import re


def collector_owned(pids, collector_paths, proc_root=Path('/proc')):
    paths = {Path(path).resolve() for path in collector_paths}
    for pid in pids:
        if type(pid) is not int or pid <= 0:
            continue
        process = proc_root / str(pid)
        try:
            with (process / 'cmdline').open('rb') as source:
                raw = source.read(32769)
            if len(raw) > 32768:
                continue
            args = [os.fsdecode(arg) for arg in raw.split(b'\0') if arg]
            if not args:
                continue
            script = args[0]
            if re.fullmatch(r'python(?:\d+(?:\.\d+)*)?', Path(script).name):
                args = args[1:]
                while args and args[0] in ('-B', '-I', '-E', '-s', '-S', '-u', '-O', '-OO'):
                    args = args[1:]
                if args and args[0] == '--':
                    args = args[1:]
                if not args or args[0].startswith('-'):
                    continue
                script = args[0]
            candidate = Path(script)
            if not candidate.is_absolute():
                candidate = (process / 'cwd').resolve(strict=True) / candidate
            if candidate.resolve() in paths:
                return True
        except (OSError, ValueError):
            continue
    return False
