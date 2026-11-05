# Moiré

A minimalist personal wallpaper library. Moiré is a static site hosted on GitHub Pages, with wallpapers and metadata stored in this repository and edited through Pages CMS.

No build step, package manager, database, backend, API server, or paid service is required. The public site is vanilla HTML, CSS, and JavaScript.

## Public addresses

Once GitHub Pages is enabled:

- Gallery: <https://speyll.github.io/moire/>
- JSON manifest: <https://speyll.github.io/moire/data/wallpapers.json>
- Direct image base: <https://speyll.github.io/moire/images/wallpapers/>

The site is a GitHub Pages *project site*, so it lives under `/moire/`. All image and manifest paths account for that prefix.

## Repository layout

```text
moire/
├── index.html
├── .nojekyll
├── .pages.yml
├── README.md
├── data/
│   └── wallpapers.json
├── images/
│   └── wallpapers/
│       └── .gitkeep
└── assets/
    ├── css/
    │   └── style.css
    ├── js/
    │   └── app.js
    └── favicon.svg
```

- `data/wallpapers.json` is the only content source. It starts as an empty array.
- `images/wallpapers/` is the media folder configured for uploads.
- `.pages.yml` configures Pages CMS.
- `.nojekyll` tells GitHub Pages to serve files as-is.

## Preview locally

The gallery fetches a JSON manifest, so it must be served over HTTP. Opening `index.html` directly with a `file://` URL will not work.

From the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

To test the same `/moire/` path shape GitHub Pages uses, serve the parent directory:

```bash
cd ..
python3 -m http.server 8000
```

Then open <http://localhost:8000/moire/>.

## One-time setup

### 1. Enable GitHub Pages

1. Push this repository to `Speyll/moire`, on the `main` branch.
2. Open the repository on GitHub.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose branch **`main`** and folder **`/ (root)`**, then save.
6. Wait for the first deployment, then open <https://speyll.github.io/moire/>.

There is no Actions workflow to configure and no build command. GitHub Pages publishes the repository root directly. `.nojekyll` keeps paths such as `assets/` and `data/` untouched.

### 2. Connect Pages CMS

Pages CMS edits files in the repository through its GitHub App. It does not store content in a separate database.

1. Go to <https://app.pagescms.org/> and sign in with GitHub.
2. Install the Pages CMS GitHub App when prompted.
3. Choose **Only select repositories** and select **`Speyll/moire`** only. The app does not need access to any other repository.
4. Return to Pages CMS and open the `Speyll/moire` repository.
5. Pages CMS reads `.pages.yml` from the repository root. Confirm that **Wallpapers** appears in the sidebar.

The one-time setup is complete. Every save in Pages CMS creates a commit on `main`, and GitHub Pages redeploys automatically.

## Managing wallpapers

### Add a wallpaper

1. In Pages CMS, open **Wallpapers**.
2. Add a new item to the list.
3. Choose the **Wallpaper image** field and upload a JPG, JPEG, PNG, WebP, or AVIF file. Uploads are stored in `images/wallpapers/`.
4. Fill in the title, category, tags, optional description, and display order.
5. The **ID** field is generated automatically. Leave it as-is.
6. Save. The gallery updates after GitHub Pages finishes its next deployment.

Use a descriptive, unique `order` value such as `10`, `20`, or `30`. Lower numbers appear first in **Manual order**. Gaps leave room to insert wallpapers later without renumbering everything.

### Edit metadata and reorder

- Edit the title, category, tags, or description in **Wallpapers**. This never changes the image path or its direct URL.
- Reorder by changing the numeric **Display order** values.
- Use **Alphabetical** in the public gallery to sort by title instead.

### Remove a wallpaper and its image

A wallpaper has two separate parts: the JSON entry and the image file. Remove both:

1. In Pages CMS, open **Wallpapers**.
2. Remove the wallpaper entry from the list and save. This removes its metadata and its card from the gallery.
3. Open the **Media** section, choose the **Wallpapers** media source, and delete the associated image file.
4. Save/confirm the deletion.

Remove the entry first when possible, so the public gallery does not temporarily show a broken image. Do not delete an image that is still referenced by another entry.

Images are never renamed when metadata changes. If you deliberately rename or move an image in the media manager, update or re-pick the image in the wallpaper entry so its path stays correct.

### Upload filename conflicts

Pages CMS does not silently overwrite an existing media file. If you upload a second file with the same name, Pages CMS appends a numeric suffix (for example, `example-1.webp`) and saves that new path. The gallery preserves each wallpaper's distinct image URL. Check the image field after uploading to confirm the actual filename.

## Getting direct image links

Every wallpaper has a stable public URL derived from its image path, for example:

```text
https://speyll.github.io/moire/images/wallpapers/example.webp
```

The gallery provides:

- **Copy** on a card: copies that wallpaper's direct image URL.
- **Open** on a card: opens the original image in a new tab.
- **Copy all**: copies every wallpaper URL, one per line.
- **Copy shown**: copies URLs for the current search/category/tag results, in the current sort order.
- **Download** (arrow icon): downloads all wallpaper URLs as `moire-wallpapers.txt`.

The full JSON manifest is always available at:

```text
https://speyll.github.io/moire/data/wallpapers.json
```

A normal wallpaper entry looks like this:

```json
{
  "id": "4c4d45bd-7f64-4d97-a31c-8e92d273fab3",
  "title": "Quiet Dunes",
  "image": "images/wallpapers/quiet-dunes.webp",
  "category": "Nature",
  "tags": ["sand", "minimal", "warm"],
  "description": "Late afternoon light across a field of dunes.",
  "order": 10
}
```

Image paths and direct links are independent of `title`, `category`, `tags`, `description`, `id`, and `order`.

## URL resolution

`assets/js/app.js` contains one URL resolver used by the gallery, the lightbox, per-card copy actions, bulk copy actions, and the text export.

It:

1. Derives the site base from the current page (for example, `/moire/`).
2. Normalises manifest paths such as `/images/wallpapers/example.webp` and `images/wallpapers/example.webp` into the same project-relative path.
3. Rejects external origins and paths outside the site.
4. Produces absolute public URLs for links and exports.

This means root-relative paths written by Pages CMS are rebased under `/moire/` instead of accidentally pointing at `https://speyll.github.io/images/...`.

## Data rules

`data/wallpapers.json` is a top-level array of objects with these fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable UUID, generated by Pages CMS. |
| `title` | string | Display name. |
| `image` | string | Repository path to the image. |
| `category` | string | One category per wallpaper. |
| `tags` | string array | Used by search and tag filtering. |
| `description` | string | Optional. |
| `order` | number | Lower numbers appear first in Manual order. |

The gallery handles a missing image, an unreachable image, individual malformed entries, an empty array, malformed JSON, and a non-array root gracefully.

## Known limitations

- There are no generated thumbnails or image transformations. Cards use the full image files, so optimised WebP/AVIF wallpapers keep the gallery fast.
- Categories and tags are free text and case-sensitive. Use consistent spelling, because `Nature` and `nature` are different filters.
- Manual ordering is numeric rather than drag-and-drop in Pages CMS. Ties fall back to their order in the JSON array.
- The public site requires JavaScript to load and filter the manifest.
- The site depends on GitHub Pages for hosting and on repository commits for updates. Pages CMS is only the editing interface; it is not used at runtime.
- Renaming or deleting an image file outside Pages CMS can break its direct URL. Metadata changes alone never do.
- There is no redirect service. Use the direct image links and the downloadable URL list instead.
