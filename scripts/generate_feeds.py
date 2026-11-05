#!/usr/bin/env python3
"""Generate the plain-text wallpaper URL feeds from data/wallpapers.json.

The manifest stays the single source of truth. Feeds are derived from its
entries, manual order, and orientation. Four stable files are written:

    feeds/all.txt
    feeds/landscape.txt
    feeds/portrait.txt
    feeds/square.txt

Each file holds one absolute wallpaper URL per line, with no other formatting.
The files are generated during deployment and are not committed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sync_wallpapers import (  # noqa: E402
    load_manifest,
    normalize_image_key,
    numeric_order,
    orientation_for,
)

ROOT = SCRIPT_DIR.parent
FEEDS_DIR = ROOT / "feeds"
SITE_URL = "https://speyll.github.io/moire/"
FEED_NAMES = ("all", "landscape", "portrait", "square")
ORIENTATIONS = {"portrait", "landscape", "square"}


def positive_dimension(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def entry_orientation(entry: dict[str, object]) -> str:
    """Return the entry's orientation, matching how the gallery derives it."""
    width = positive_dimension(entry.get("width"))
    height = positive_dimension(entry.get("height"))
    if width and height:
        return orientation_for(width, height)

    stored = entry.get("orientation")
    if isinstance(stored, str):
        stored = stored.strip().lower()
        if stored in ORIENTATIONS:
            return stored
    return ""


def manual_order(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    """Sort like the gallery: numeric order first, manifest order for ties."""

    def sort_key(indexed: tuple[int, dict[str, object]]):
        index, entry = indexed
        order = numeric_order(entry.get("order"))
        if order is None:
            return (1, 0.0, index)
        return (0, float(order), index)

    return [entry for _, entry in sorted(enumerate(entries), key=sort_key)]


def feed_url(value: object) -> str | None:
    """Turn a manifest image path into an absolute direct wallpaper URL."""
    if not isinstance(value, str):
        return None

    raw = value.strip()
    if not raw:
        return None

    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        # Absolute paths are only accepted when they point at this site.
        if not raw.lower().startswith(SITE_URL.lower()):
            return None

    key = normalize_image_key(raw)
    if not key or key == "." or key.startswith("../"):
        return None

    return f"{SITE_URL}{quote(key, safe='/')}"


def build_feeds(entries: list[object]):
    """Group absolute URLs by feed, preserving the manifest's manual order."""
    wallpaper_entries = [entry for entry in entries if isinstance(entry, dict)]
    feeds: dict[str, list[str]] = {name: [] for name in FEED_NAMES}
    seen: set[str] = set()
    duplicates = 0
    skipped = 0

    for entry in manual_order(wallpaper_entries):
        url = feed_url(entry.get("image"))
        if url is None:
            skipped += 1
            continue
        if url in seen:
            duplicates += 1
            continue

        seen.add(url)
        feeds["all"].append(url)
        orientation = entry_orientation(entry)
        if orientation:
            feeds[orientation].append(url)

    return feeds, skipped, duplicates


def write_feeds(feeds: dict[str, list[str]]) -> None:
    try:
        FEEDS_DIR.mkdir(parents=True, exist_ok=True)

        for name in FEED_NAMES:
            urls = feeds[name]
            content = "".join(f"{url}\n" for url in urls)
            path = FEEDS_DIR / f"{name}.txt"
            temporary_path = path.with_name(f".{path.name}.tmp")

            with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
            os.replace(temporary_path, path)

            count = len(urls)
            print(
                f"{path.relative_to(ROOT)}: {count} "
                f"URL{'s' if count != 1 else ''}."
            )
    except OSError as error:
        raise SystemExit(f"error: could not write the feeds: {error}") from error


def main() -> int:
    entries = load_manifest()
    feeds, skipped, duplicates = build_feeds(entries)
    write_feeds(feeds)

    if duplicates:
        print(
            f"warning: ignored {duplicates} duplicate wallpaper URL"
            f"{'s' if duplicates != 1 else ''}.",
            file=sys.stderr,
        )
    if skipped:
        print(
            f"warning: skipped {skipped} manifest "
            f"entr{'ies' if skipped != 1 else 'y'} without a usable image path.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
