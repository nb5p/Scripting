"""Shared utilities for yt-dlp Python runners.

This module is prepended to each runner script (quick_download.py, advanced_download.py)
by the TypeScript layer. It provides common functions that both runners need.

Globals expected to be set by the runner script before calling functions:
  MARKER            — result marker string for emit()
  progress_path     — path to atomic progress JSON file (or None)
  cookie_file_path  — path to cookies.txt file (or None)
  cancel_token_path — path to cancel token file (or None)
"""
import json
import os
import shutil
import sys


def emit(payload):
    """Print a JSON result line prefixed with the marker."""
    print(MARKER + json.dumps(payload, ensure_ascii=False))


def number(value):
    """Return value if it's a real number, else None."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def check_cancelled():
    """Raise RuntimeError if the cancel token file exists."""
    if cancel_token_path and os.path.isfile(cancel_token_path):
        raise RuntimeError("__USER_CANCELLED__")


def first_media(info):
    """Drill into playlist entries to find the first actual media item."""
    if not isinstance(info, dict):
        return info
    entries = info.get("entries")
    if entries:
        for entry in entries:
            if entry:
                return first_media(entry)
    return info


def existing_file(info, ydl):
    """Find an existing non-empty downloaded file from yt-dlp info dict."""
    if not isinstance(info, dict):
        return None
    requested = info.get("requested_downloads") or []
    for item in requested:
        if isinstance(item, dict):
            path = item.get("filepath")
            if path and os.path.isfile(path) and os.path.getsize(path) > 0:
                return os.path.abspath(path)
    path = info.get("filepath")
    if path and os.path.isfile(path) and os.path.getsize(path) > 0:
        return os.path.abspath(path)
    entries = info.get("entries") or []
    for entry in entries:
        path = existing_file(entry, ydl)
        if path:
            return path
    try:
        path = ydl.prepare_filename(info)
    except Exception:
        path = None
    if path and os.path.isfile(path) and os.path.getsize(path) > 0:
        return os.path.abspath(path)
    return None


def common_options():
    """Base yt-dlp options shared by all download modes."""
    options = {
        "continuedl": True,
        "overwrites": False,
        "retries": 8,
        "fragment_retries": 8,
        "socket_timeout": 30,
        "fixup": "never",
        "windowsfilenames": True,
        "postprocessors": [],
        "writesubtitles": False,
        "writeautomaticsub": False,
        "quiet": True,
        "no_warnings": False,
    }
    if cookie_file_path and os.path.isfile(cookie_file_path):
        options["cookiefile"] = cookie_file_path
    return options


def atomic_write_json(path, data):
    """Atomically write JSON to a file via temp-file + rename."""
    if not path:
        return
    temp_path = path + "." + str(os.getpid()) + ".tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
