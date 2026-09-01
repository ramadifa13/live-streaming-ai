"""Loader untuk deploy/assets/avatar_actions.json — single source of truth
gestur avatar, dipakai bersama oleh live_worker.py dan broadcaster.py.

Menjaga agar alias klip, kategori (idle/talk/gesture), dan durasi crossfade
per aksi tidak lagi hardcode terpisah di banyak file.
"""

import json
import os

_CONFIG_CACHE = None


def _config_path():
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "assets", "avatar_actions.json"
    )


def load_action_config():
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE
    path = _config_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            _CONFIG_CACHE = json.load(f)
    except Exception as e:
        print(f"[ACTION CONFIG] Gagal load {path}: {e} — pakai default minimal.")
        _CONFIG_CACHE = {"actions": [], "defaults": {"crossfadeSeconds": 0.5, "fadeSeconds": 0.4}}
    return _CONFIG_CACHE


def get_action_entry(action_key):
    """Cari entry config berdasarkan key/clip/alias (case-insensitive)."""
    action_key = (action_key or "").lower().strip()
    for entry in load_action_config().get("actions", []):
        key = str(entry.get("key", "")).lower()
        clip = str(entry.get("clip", "")).lower()
        aliases = [str(a).lower() for a in entry.get("aliases", [])]
        if action_key == key or action_key == clip or action_key in aliases:
            return entry
    return None


def get_action_aliases(action_key):
    """Daftar nama file kandidat (tanpa prefix host) untuk suatu action tag."""
    entry = get_action_entry(action_key)
    if not entry:
        return [action_key]
    variants = [entry.get("clip", action_key)] + list(entry.get("aliases", []))
    seen = set()
    out = []
    for v in variants:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def get_action_category(action_key):
    entry = get_action_entry(action_key)
    return (entry or {}).get("category", "gesture")


def get_crossfade_seconds(action_key, default=None):
    cfg = load_action_config()
    entry = get_action_entry(action_key)
    if entry and "crossfadeSeconds" in entry:
        return float(entry["crossfadeSeconds"])
    fallback = default if default is not None else cfg.get("defaults", {}).get("crossfadeSeconds", 0.5)
    return float(fallback)
