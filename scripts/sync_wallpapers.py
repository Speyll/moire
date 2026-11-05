#!/usr/bin/env python3
"""Synchronise images/wallpapers/ with data/wallpapers.json.

The script uses only the Python standard library. It adds images that are not
already listed, refreshes their dimensions and orientation, and leaves all
other metadata and manual ordering untouched.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = ROOT / "images" / "wallpapers"
MANIFEST_PATH = ROOT / "data" / "wallpapers.json"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
ORIENTATIONS = {"portrait", "landscape", "square"}

RESOLUTION_RE = re.compile(r"\b\d{3,5}\s*[x\u00d7]\s*\d{3,5}\b", re.IGNORECASE)
FORMAT_TOKEN_RE = re.compile(r"\b(?:jpe?g|png|webp|avif)\b", re.IGNORECASE)
FORMAT_DUPLICATE_RE = re.compile(
    r"[-_](?:jpe?g|png|webp|avif)[-_]\d{1,3}$", re.IGNORECASE
)

SOF_MARKERS = {
    0xC0,
    0xC1,
    0xC2,
    0xC3,
    0xC5,
    0xC6,
    0xC7,
    0xC9,
    0xCA,
    0xCB,
    0xCD,
    0xCE,
    0xCF,
}


class ImageReadError(Exception):
    """Raised when dimensions cannot be read from an image."""


def _uint_be(data: bytes, start: int, length: int) -> int:
    end = start + length
    if start < 0 or end > len(data):
        raise ImageReadError("unexpected end of file")
    return int.from_bytes(data[start:end], "big")


def _uint_le(data: bytes, start: int, length: int) -> int:
    end = start + length
    if start < 0 or end > len(data):
        raise ImageReadError("unexpected end of file")
    return int.from_bytes(data[start:end], "little")


def _jpeg_size(data: bytes) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ImageReadError("not a JPEG file")

    offset = 2
    while offset < len(data):
        while offset < len(data) and data[offset] != 0xFF:
            offset += 1
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break

        marker = data[offset]
        offset += 1

        if marker in (0x01, 0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            break

        segment_length = _uint_be(data, offset, 2)
        if segment_length < 2:
            raise ImageReadError("invalid JPEG segment")
        payload = offset + 2
        segment_end = offset + segment_length
        if segment_end > len(data):
            raise ImageReadError("truncated JPEG segment")

        if marker in SOF_MARKERS:
            if payload + 5 > segment_end:
                raise ImageReadError("truncated JPEG frame header")
            height = _uint_be(data, payload + 1, 2)
            width = _uint_be(data, payload + 3, 2)
            if width and height:
                return width, height
            raise ImageReadError("JPEG has zero dimensions")

        offset = segment_end

    raise ImageReadError("JPEG dimensions not found")


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ImageReadError("not a PNG file")
    if data[12:16] != b"IHDR":
        raise ImageReadError("PNG IHDR chunk not found")
    width = _uint_be(data, 16, 4)
    height = _uint_be(data, 20, 4)
    if width and height:
        return width, height
    raise ImageReadError("PNG has zero dimensions")


def _webp_size(data: bytes) -> tuple[int, int]:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ImageReadError("not a WebP file")

    offset = 12
    while offset + 8 <= len(data):
        chunk_type = data[offset : offset + 4]
        chunk_size = _uint_le(data, offset + 4, 4)
        payload = offset + 8
        chunk_end = payload + chunk_size
        if chunk_end > len(data):
            raise ImageReadError("truncated WebP chunk")

        if chunk_type == b"VP8X" and chunk_size >= 10:
            width = _uint_le(data, payload + 4, 3) + 1
            height = _uint_le(data, payload + 7, 3) + 1
            if width and height:
                return width, height

        if chunk_type == b"VP8 " and chunk_size >= 10:
            if data[payload + 3 : payload + 6] != b"\x9d\x01\x2a":
                raise ImageReadError("invalid WebP frame header")
            width = _uint_le(data, payload + 6, 2) & 0x3FFF
            height = _uint_le(data, payload + 8, 2) & 0x3FFF
            if width and height:
                return width, height

        if chunk_type == b"VP8L" and chunk_size >= 5:
            if data[payload] != 0x2F:
                raise ImageReadError("invalid WebP lossless header")
            bits = int.from_bytes(data[payload + 1 : payload + 5], "little")
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
            if width and height:
                return width, height

        offset = chunk_end + (chunk_size & 1)

    raise ImageReadError("WebP dimensions not found")


def _iso_boxes(data: bytes, start: int, end: int):
    """Yield (type, payload_start, box_end) for ISO base media boxes."""
    offset = start
    while offset + 8 <= end:
        size = _uint_be(data, offset, 4)
        box_type = data[offset + 4 : offset + 8]
        header_size = 8

        if size == 1:
            if offset + 16 > end:
                return
            size = _uint_be(data, offset + 8, 8)
            header_size = 16
        elif size == 0:
            size = end - offset

        if size < header_size or offset + size > end:
            return

        yield box_type, offset + header_size, offset + size
        offset += size


def _avif_size(data: bytes) -> tuple[int, int]:
    if len(data) < 16 or data[4:8] != b"ftyp":
        raise ImageReadError("not an AVIF file")

    dimensions: list[tuple[int, int]] = []

    def walk(start: int, end: int) -> None:
        for box_type, payload, box_end in _iso_boxes(data, start, end):
            if box_type == b"ispe":
                if payload + 12 <= box_end:
                    width = _uint_be(data, payload + 4, 4)
                    height = _uint_be(data, payload + 8, 4)
                    if width and height:
                        dimensions.append((width, height))
            elif box_type == b"meta":
                # The meta box is a FullBox, so its children start after a
                # four-byte version/flags field.
                walk(payload + 4, box_end)
            elif box_type in {b"iprp", b"ipco"}:
                walk(payload, box_end)

    walk(0, len(data))
    if not dimensions:
        raise ImageReadError("AVIF dimensions not found")

    # Grid images and thumbnails can contain several ispe boxes. The primary
    # wallpaper is the largest one.
    return max(dimensions, key=lambda size: size[0] * size[1])


def image_dimensions(path: Path) -> tuple[int, int]:
    """Read the encoded pixel dimensions of a supported image."""
    data = path.read_bytes()
    suffix = path.suffix.lower()

    if suffix in {".jpg", ".jpeg"}:
        return _jpeg_size(data)
    if suffix == ".png":
        return _png_size(data)
    if suffix == ".webp":
        return _webp_size(data)
    if suffix == ".avif":
        return _avif_size(data)

    raise ImageReadError(f"unsupported image format: {suffix}")


def orientation_for(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    if width < height:
        return "portrait"
    return "square"


def title_from_filename(filename: str) -> str:
    """Create a readable default title without storing filename noise."""
    stem = Path(filename).stem
    stem = FORMAT_DUPLICATE_RE.sub("", stem)
    title = stem.replace("_", " ").replace("-", " ")
    title = RESOLUTION_RE.sub(" ", title)
    title = FORMAT_TOKEN_RE.sub(" ", title)
    title = re.sub(r"\s+", " ", title).strip(" ._")
    if not title:
        title = stem
    return title[:1].upper() + title[1:]


def stable_id(image_path: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://speyll.github.io/moire/{image_path}"))


def normalize_image_key(value: object) -> str | None:
    """Normalise a manifest image path for matching, without rewriting it."""
    if not isinstance(value, str):
        return None

    path = value.strip().replace("\\", "/")
    if not path:
        return None

    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc:
        path = parsed.path

    path = path.split("#", 1)[0].split("?", 1)[0]
    path = posixpath.normpath(path.lstrip("/"))

    # Accept project-site paths such as /moire/images/... as well as paths
    # relative to the repository root.
    if path.startswith("moire/"):
        path = path[len("moire/") :]

    return path


def numeric_order(value: object) -> int | float | None:
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not number == number or number in (float("inf"), float("-inf")):
        return None
    return int(number) if number.is_integer() else number


def format_order(value: int | float) -> int | float:
    return int(value) if float(value).is_integer() else value


def load_manifest() -> list[object]:
    if not MANIFEST_PATH.exists():
        return []

    try:
        with MANIFEST_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as error:
        raise SystemExit(
            f"error: {MANIFEST_PATH.relative_to(ROOT)} is not valid JSON "
            f"(line {error.lineno}, column {error.colno})."
        ) from error
    except OSError as error:
        raise SystemExit(f"error: could not read the manifest: {error}") from error

    if not isinstance(data, list):
        raise SystemExit(
            f"error: {MANIFEST_PATH.relative_to(ROOT)} must contain a top-level array."
        )
    return data


def write_manifest(entries: list[object]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = MANIFEST_PATH.with_name(f".{MANIFEST_PATH.name}.tmp")

    try:
        with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(entries, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_path, MANIFEST_PATH)
    except OSError as error:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise SystemExit(f"error: could not write the manifest: {error}") from error


def discover_images() -> tuple[dict[str, tuple[int, int]], list[str]]:
    images: dict[str, tuple[int, int]] = {}
    warnings: list[str] = []

    if not IMAGES_DIR.exists():
        warnings.append(f"{IMAGES_DIR.relative_to(ROOT)} does not exist.")
        return images, warnings

    for path in sorted(IMAGES_DIR.iterdir(), key=lambda item: item.name.casefold()):
        if path.name.startswith(".") or path.name == ".gitkeep":
            continue
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        try:
            images[f"images/wallpapers/{path.name}"] = image_dimensions(path)
        except (ImageReadError, OSError) as error:
            warnings.append(f"skipped {path.name}: {error}")

    return images, warnings


def synchronise(entries: list[object], images: dict[str, tuple[int, int]]):
    ordered_entries: list[dict[str, object]] = []
    existing_by_key: dict[str, list[dict[str, object]]] = {}
    warnings: list[str] = []
    additions: list[str] = []
    metadata_updates: list[str] = []

    if not isinstance(entries, list):
        raise SystemExit("error: the manifest must be an array.")

    for entry in entries:
        if not isinstance(entry, dict):
            warnings.append("ignored a non-object manifest entry")
            ordered_entries.append(entry)  # type: ignore[arg-type]
            continue

        ordered_entries.append(entry)
        key = normalize_image_key(entry.get("image"))
        if key:
            existing_by_key.setdefault(key, []).append(entry)

    valid_orders = [
        order
        for entry in ordered_entries
        if isinstance(entry, dict)
        if (order := numeric_order(entry.get("order"))) is not None
    ]
    next_order = (max(valid_orders) if valid_orders else 0) + 10

    # Refresh technical metadata for images that are already listed.
    for key, found_entries in existing_by_key.items():
        dimensions = images.get(key)
        if dimensions is None:
            continue

        width, height = dimensions
        orientation = orientation_for(width, height)
        for entry in found_entries:
            changed = False
            if entry.get("width") != width:
                entry["width"] = width
                changed = True
            if entry.get("height") != height:
                entry["height"] = height
                changed = True
            if entry.get("orientation") != orientation:
                entry["orientation"] = orientation
                changed = True
            if changed:
                metadata_updates.append(str(entry.get("image") or key))

    # Add only unseen filenames. Entries whose files are temporarily missing
    # stay in the manifest untouched.
    for key, (width, height) in images.items():
        if key in existing_by_key:
            continue

        filename = key.rsplit("/", 1)[-1]
        orientation = orientation_for(width, height)
        entry: dict[str, object] = {
            "id": stable_id(key),
            "title": title_from_filename(filename),
            "image": key,
            "width": width,
            "height": height,
            "orientation": orientation,
            "order": format_order(next_order),
        }
        next_order += 10
        ordered_entries.append(entry)
        existing_by_key[key] = [entry]
        additions.append(filename)

    return ordered_entries, additions, metadata_updates, warnings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add new wallpaper images to the manifest and refresh dimensions."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would change without writing data/wallpapers.json",
    )
    args = parser.parse_args()

    entries = load_manifest()
    images, warnings = discover_images()
    entries, additions, metadata_updates, sync_warnings = synchronise(entries, images)
    warnings.extend(sync_warnings)

    total = sum(1 for entry in entries if isinstance(entry, dict))
    print(f"Scanned {len(images)} image{'s' if len(images) != 1 else ''} in {IMAGES_DIR.relative_to(ROOT)}.")

    for filename in additions:
        print(f"  add  {filename}")
    for image in metadata_updates:
        print(f"  sync {image}")

    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)

    changed = bool(additions or metadata_updates)
    if args.dry_run:
        if changed:
            print(
                f"Dry run: would add {len(additions)} and update "
                f"{len(metadata_updates)} entr{'y' if len(metadata_updates) == 1 else 'ies'}; "
                f"manifest would contain {total} wallpapers."
            )
        else:
            print(f"Dry run: manifest is already up to date ({total} wallpapers).")
        return 0

    if changed:
        write_manifest(entries)
        print(
            f"Updated data/wallpapers.json: added {len(additions)}, "
            f"refreshed {len(metadata_updates)}. {total} wallpapers total."
        )
    else:
        print(f"data/wallpapers.json is up to date ({total} wallpapers).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
