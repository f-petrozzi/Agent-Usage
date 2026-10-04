#!/usr/bin/env python3
"""Run the collector fixtures explicitly; hyphenated test files evade discovery."""
import pathlib
import subprocess
import sys
root = pathlib.Path(__file__).resolve().parents[1]
tests = sorted((root / 'tests').glob('test-*.py'))
failed = []
for test in tests:
    print(f'Running {test.name}', flush=True)
    if subprocess.run([sys.executable, str(test)], cwd=root).returncode:
        failed.append(test.name)
print(f'{len(tests) - len(failed)}/{len(tests)} collector suites passed.', flush=True)
sys.exit(bool(failed))
