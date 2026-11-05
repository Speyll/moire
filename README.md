# Moiré

A small personal wallpaper library hosted on GitHub Pages. Wallpapers live in this repository, and the gallery is plain HTML, CSS, and JavaScript.

There is no build step, package manager, database, backend, external image host, or third-party service. The repository is the content source.

## Public addresses

Once GitHub Pages is enabled:

- Gallery: <https://speyll.github.io/moire/>
- JSON manifest: <https://speyll.github.io/moire/data/wallpapers.json>
- Image base: <https://speyll.github.io/moire/images/wallpapers/>

The site is a GitHub Pages project site, so it lives under `/moire/`. Manifest paths and public links account for that prefix.

## Repository layout

```text
moire/
├── index.html
├── .nojekyll
├── README.md
├── data/
│   └── wallpapers.json
├── images/
│   └── wallpapers/
├── scripts/
│   └── sync_wallpapers.py
└── assets/
    ├── css/
    │   └── style.css
    ├── js/
    │   └── app.js
    └── favicon.svg
```

- `images/wallpapers/` holds the original image files.
- `data/wallpapers.json` is the public manifest and the gallery's only content source.
- `scripts/sync_wallpapers.py` imports new images and refreshes their dimensions.
- `.nojekyll` tells GitHub Pages to publish files as-is.

## Add wallpapers

1. Copy images into `images/wallpapers/`. Supported formats are JPG, JPEG, PNG, WebP, and AVIF.
2. Preview the import:

   ```bash
   python3 scripts/sync_wallpapers.py --dry-run
   ```

3. Update the manifest:

   ```bash
   python3 scripts/sync_wallpapers.py
   ```

4. Review `data/wallpapers.json`, then commit and push the images and manifest.

The script needs only Python 3 and its standard library. It can be run from any working directory.

### What the sync script does

- Scans `images/wallpapers/` and ignores hidden files and `.gitkeep`.
- Adds each supported image exactly once.
- Generates a default title from the filename.
- Reads the real image dimensions and stores `width`, `height`, and `orientation`.
- Preserves existing titles, descriptions, IDs, manual order, and other metadata.
- Refreshes technical dimension fields when an existing image changes.
- Leaves entries whose image is temporarily missing in place.
- Writes nothing when the manifest is already up to date.
- Supports `--dry-run` to preview without modifying the manifest.

The default title removes the extension, separators, resolution, and format tokens. For example, `quiet-dunes_1920x1080_png.avif` becomes `Quiet dunes`. Edit `title` in `data/wallpapers.json` if you want a different name.

## Manifest

`data/wallpapers.json` is a top-level array. A generated entry looks like this:

```json
{
  "id": "10b88b67-89f1-5b79-a6b6-8ad6ce4d0236",
  "title": "Quiet dunes",
  "image": "images/wallpapers/quiet-dunes_1920x1080_png.avif",
  "width": 1920,
  "height": 1080,
  "orientation": "landscape",
  "order": 10
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable identifier derived from the image path. |
| `title` | string | Searchable display name. |
| `image` | string | Repository-relative image path. |
| `width` | number | Image width in pixels. |
| `height` | number | Image height in pixels. |
| `orientation` | string | `portrait`, `landscape`, or `square`. |
| `order` | number | Lower numbers appear first in manual order. |
| `description` | string | Optional. Shown in the full-resolution preview. |

Orientation is calculated from the actual dimensions:

- Portrait: height is greater than width.
- Landscape: width is greater than height.
- Square: width and height are equal.

The gallery uses the stored dimensions for filtering, so it does not load every full-size image just to determine orientation.

### Edit, reorder, or remove entries

- Edit `title` or add an optional `description` directly in the manifest.
- Reorder by changing `order` values. Lower numbers appear first. Ties keep their order in the JSON file.
- To remove a wallpaper, delete its entry from the manifest and delete its image from `images/wallpapers/`.
- The sync script never removes entries automatically, including when an image is missing.
- To rename an image, rename both the file and its `image` path, or remove the old entry and run the sync script to add the new file.

## Preview locally

The gallery fetches the manifest, so serve the site over HTTP instead of opening `index.html` with a `file://` URL.

From the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

To reproduce the `/moire/` path used by GitHub Pages, serve the parent directory:

```bash
cd ..
python3 -m http.server 8000
```

Then open <http://localhost:8000/moire/>.

## GitHub Pages setup

1. Push the repository to `Speyll/moire` on the `main` branch.
2. Open the repository on GitHub and go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **`main`** and folder **`/ (root)`**, then save.
5. Wait for the deployment and open <https://speyll.github.io/moire/>.

No Actions workflow or build command is needed. `.nojekyll` keeps `assets/`, `data/`, and `scripts/` serving correctly.

## Gallery controls

- **Search** filters by title, ignoring accents and case.
- **All, Portrait, Landscape, Square** filter using the dimensions stored in the manifest.
- **Manual order** and **Title A–Z** change the display order.
- **Copy all** copies every wallpaper URL, one per line, in manual order.
- **Copy shown** copies the current filtered results in their current sort order.
- **Download list** saves all wallpaper URLs as `moire-wallpapers.txt`.
- **Manifest** opens the public JSON manifest.
- Clicking a wallpaper opens the full-resolution preview. Use the arrow buttons or arrow keys to move, and Escape to close.
- Each card has a copy button and an open-original link.

A direct image URL looks like:

```text
https://speyll.github.io/moire/images/wallpapers/example.avif
```

## URL handling

`assets/js/app.js` has one image URL resolver. The gallery, preview, per-card actions, bulk copy actions, and text export all use it.

The resolver:

1. Derives the site base from the current page, such as `/moire/`.
2. Accepts repository-relative paths and root-relative paths.
3. Rebases paths under the GitHub Pages project prefix.
4. Rejects external origins and paths outside the site.
5. Returns absolute URLs for links and exports.

For example, both `/images/wallpapers/example.avif` and `images/wallpapers/example.avif` resolve to `https://speyll.github.io/moire/images/wallpapers/example.avif`.

## Limits

- There are no generated thumbnails; cards use the original files. Optimised WebP and AVIF files keep the gallery fast.
- The gallery requires JavaScript.
- The sync script reads dimensions but does not edit pixels, convert formats, or create thumbnails.
- The manual order is numeric. Ties fall back to the entry order in the JSON file.
- If an image is deleted but its manifest entry remains, the card shows an unavailable-image fallback. Remove the entry to clear it.
- Direct links are stable as long as the image path stays the same.
