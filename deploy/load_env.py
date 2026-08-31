"""Load KEY=VALUE env files without overriding existing process env."""

from __future__ import annotations

import os
from typing import Iterable, List


def load_env_files(paths: Iterable[str], *, override: bool = False) -> List[str]:
    loaded = []
    for path in paths:
        if not path or not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for raw in fh:
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("export "):
                        line = line[7:].strip()
                    if "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if not key:
                        continue
                    if override or key not in os.environ:
                        os.environ[key] = value
            loaded.append(path)
        except Exception as err:
            print(f"[env] gagal load {path}: {err}")
    return loaded
