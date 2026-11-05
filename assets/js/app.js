(() => {
  "use strict";

  const SITE_BASE = new URL("./", window.location.href);
  const BASE_PATH = SITE_BASE.pathname.replace(/\/+$/, "");
  const MANIFEST_URL = new URL("data/wallpapers.json", SITE_BASE).href;
  const MANIFEST_TIMEOUT_MS = 15000;
  const VALID_ORIENTATIONS = new Set(["portrait", "landscape", "square"]);
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  const elements = {
    gallery: document.getElementById("gallery"),
    resultsCount: document.getElementById("results-count"),
    headerCount: document.getElementById("header-count"),
    searchInput: document.getElementById("search-input"),
    searchClear: document.getElementById("search-clear"),
    orientationButtons: Array.from(document.querySelectorAll("[data-orientation]")),
    sortFilter: document.getElementById("sort-filter"),
    clearFilters: document.getElementById("clear-filters"),
    emptyClearFilters: document.getElementById("empty-clear-filters"),
    copyAll: document.getElementById("copy-all"),
    copyVisible: document.getElementById("copy-visible"),
    downloadAll: document.getElementById("download-all"),
    emptyCollection: document.getElementById("empty-collection"),
    emptyResults: document.getElementById("empty-results"),
    errorState: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    retryButton: document.getElementById("retry-button"),
    manifestLink: document.getElementById("manifest-link"),
    footerManifestLink: document.getElementById("footer-manifest-link"),
    feedLinks: Array.from(document.querySelectorAll("[data-feed-link]")),
    feedCopyButtons: Array.from(document.querySelectorAll("[data-feed-copy]")),
    preview: document.getElementById("preview"),
    previewTitle: document.getElementById("preview-title"),
    previewMeta: document.getElementById("preview-meta"),
    previewCounter: document.getElementById("preview-counter"),
    previewDescription: document.getElementById("preview-description"),
    previewImage: document.getElementById("preview-image"),
    previewImageError: document.getElementById("preview-image-error"),
    previewLoader: document.getElementById("preview-loader"),
    previewPrev: document.getElementById("preview-prev"),
    previewNext: document.getElementById("preview-next"),
    previewClose: document.getElementById("preview-close"),
    previewCopy: document.getElementById("preview-copy"),
    previewOpen: document.getElementById("preview-open"),
    toast: document.getElementById("toast"),
  };

  const state = {
    all: [],
    visible: [],
    query: "",
    orientation: "",
    sort: "manual",
    loading: true,
    error: null,
    previewIndex: -1,
    previewTrigger: null,
  };

  let toastTimer = 0;

  /**
   * Fail early with a useful message if the HTML and JavaScript do not match.
   * This catches stale pages, incomplete deploys, and removed controls before
   * any event listener assumes an element exists.
   */
  function validatePageStructure() {
    const missing = Object.entries(elements)
      .filter(([, value]) => (Array.isArray(value) ? value.length === 0 : !value))
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(
        `Required page elements are missing: ${missing.join(", ")}.`
      );
    }
  }

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && Number.isInteger(number)
      ? number
      : null;
  }

  function normalizeForSearch(value) {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  }

  function orientationFor(width, height) {
    if (!width || !height) return "";
    if (width > height) return "landscape";
    if (width < height) return "portrait";
    return "square";
  }

  function orientationLabel(orientation) {
    if (orientation === "portrait") return "Portrait";
    if (orientation === "landscape") return "Landscape";
    if (orientation === "square") return "Square";
    return "";
  }

  function formatDimensions(width, height) {
    if (!width || !height) return "";
    return `${width} × ${height}`;
  }

  /**
   * Feeds live in feeds/ and are generated at deploy time. Resolving them from
   * the page base keeps the permanent /moire/feeds/... URLs on GitHub Pages
   * while local previews get working localhost URLs.
   */
  function feedUrl(name) {
    return new URL(`feeds/${name}.txt`, SITE_BASE).href;
  }

  /**
   * The single source of truth for turning a manifest image path into a public
   * URL. The gallery, preview, card actions and bulk exports all use it.
   *
   * Manifest paths can be repository-relative or root-relative. GitHub Pages
   * project sites live under /moire/, so leading slashes are rebased under the
   * current project path rather than resolved against the domain root.
   */
  function resolveImagePath(value) {
    if (typeof value !== "string") return null;

    let path = value.trim().replace(/\\/g, "/");
    if (!path) return null;

    // Absolute URLs are only accepted when they point at this same site.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
      try {
        const absolute = new URL(path, SITE_BASE);
        if (absolute.origin !== SITE_BASE.origin) return null;
        path = absolute.pathname;
      } catch {
        return null;
      }
    }

    path = path.split("#")[0].split("?")[0];

    // Handle a manifest that already contains the project base path.
    if (BASE_PATH) {
      if (path === BASE_PATH) {
        path = "/";
      } else if (path.startsWith(BASE_PATH + "/")) {
        path = path.slice(BASE_PATH.length);
      }
    }

    path = path.replace(/^\/+/, "");
    if (!path) return null;

    try {
      const resolved = new URL(path, SITE_BASE);
      if (resolved.origin !== SITE_BASE.origin) return null;

      const siteRoot = BASE_PATH ? BASE_PATH + "/" : "/";
      if (!resolved.pathname.startsWith(siteRoot)) return null;

      return resolved.href;
    } catch {
      return null;
    }
  }

  function normalizeWallpaper(raw, index) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      console.warn(`Skipping wallpaper at index ${index}: expected an object.`);
      return null;
    }

    const title = asString(raw.title) || "Untitled wallpaper";
    const image = asString(raw.image);
    const imageUrl = resolveImagePath(image);
    const id = asString(raw.id) || `wallpaper-${index}`;
    const width = positiveInteger(raw.width);
    const height = positiveInteger(raw.height);
    const storedOrientation = asString(raw.orientation);
    const orientation =
      orientationFor(width, height) ||
      (VALID_ORIENTATIONS.has(storedOrientation) ? storedOrientation : "");
    const description = asString(raw.description);
    const numericOrder =
      raw.order === null || raw.order === undefined || raw.order === ""
        ? null
        : Number(raw.order);
    const order = Number.isFinite(numericOrder) ? numericOrder : null;

    if (image && !imageUrl) {
      console.warn(`Could not resolve the image path for "${title}".`);
    }

    return {
      id,
      title,
      image,
      imageUrl,
      width,
      height,
      orientation,
      description,
      order,
      index,
      searchText: normalizeForSearch(title),
    };
  }

  function manualSort(items) {
    return items.slice().sort((a, b) => {
      const aOrder = a.order === null ? Number.POSITIVE_INFINITY : a.order;
      const bOrder = b.order === null ? Number.POSITIVE_INFINITY : b.order;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    });
  }

  function sortItems(items) {
    if (state.sort === "alphabetical") {
      return items.slice().sort((a, b) => collator.compare(a.title, b.title));
    }
    return manualSort(items);
  }

  function getVisibleWallpapers() {
    const terms = normalizeForSearch(state.query).split(/\s+/).filter(Boolean);

    const filtered = state.all.filter((wallpaper) => {
      if (state.orientation && wallpaper.orientation !== state.orientation) {
        return false;
      }
      if (terms.length > 0 && !terms.every((term) => wallpaper.searchText.includes(term))) {
        return false;
      }
      return true;
    });

    return sortItems(filtered);
  }

  function wallpaperUrls(items) {
    return items.map((wallpaper) => wallpaper.imageUrl).filter(Boolean);
  }

  function createIcon(symbolId) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${symbolId}`);
    svg.append(use);
    return svg;
  }

  function createFallback(container, message = "Image unavailable") {
    if (container.querySelector(".image-fallback")) return;

    const fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.append(createIcon("icon-image-off"));

    const label = document.createElement("span");
    label.textContent = message;
    fallback.append(label);
    container.append(fallback);
  }

  function buildCard(wallpaper, index) {
    const card = document.createElement("article");
    card.className = "wallpaper-card";
    card.dataset.orientation = wallpaper.orientation || "unknown";
    card.style.setProperty("--card-index", String(Math.min(index, 16)));

    const media = document.createElement("div");
    media.className = "card-media";

    const openButton = document.createElement("button");
    openButton.className = "card-open";
    openButton.type = "button";
    openButton.dataset.previewId = wallpaper.id;
    openButton.setAttribute("aria-label", `Preview ${wallpaper.title}`);

    if (wallpaper.imageUrl) {
      const image = document.createElement("img");
      image.alt = wallpaper.title;
      image.loading = index < 6 ? "eager" : "lazy";
      image.decoding = "async";
      image.addEventListener("load", () => image.classList.add("is-loaded"), {
        once: true,
      });
      image.addEventListener(
        "error",
        () => {
          image.remove();
          createFallback(openButton);
          openButton.setAttribute(
            "aria-label",
            `Preview ${wallpaper.title} — Image unavailable`
          );
        },
        { once: true }
      );
      image.src = wallpaper.imageUrl;
      openButton.append(image);
    } else {
      createFallback(openButton);
      openButton.setAttribute(
        "aria-label",
        `Preview ${wallpaper.title} — Image unavailable`
      );
    }

    media.append(openButton);

    if (wallpaper.imageUrl) {
      const actions = document.createElement("div");
      actions.className = "card-actions";

      const copyButton = document.createElement("button");
      copyButton.className = "action-button";
      copyButton.type = "button";
      copyButton.dataset.copyUrl = wallpaper.imageUrl;
      copyButton.title = "Copy image URL";
      copyButton.setAttribute("aria-label", `Copy direct URL for ${wallpaper.title}`);
      copyButton.append(createIcon("icon-copy"));

      const openLink = document.createElement("a");
      openLink.className = "action-button";
      openLink.href = wallpaper.imageUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.title = "Open original image";
      openLink.setAttribute("aria-label", `Open original image for ${wallpaper.title}`);
      openLink.append(createIcon("icon-external"));

      actions.append(copyButton, openLink);
      media.append(actions);
    }

    const info = document.createElement("div");
    info.className = "card-info";

    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = wallpaper.title;
    title.title = wallpaper.title;

    info.append(title);

    const dimensions = formatDimensions(wallpaper.width, wallpaper.height);
    if (dimensions) {
      const meta = document.createElement("span");
      meta.className = "card-meta";
      meta.textContent = dimensions;
      info.append(meta);
    }

    card.append(media, info);
    return card;
  }

  function renderGallery() {
    const fragment = document.createDocumentFragment();
    state.visible.forEach((wallpaper, index) => {
      fragment.append(buildCard(wallpaper, index));
    });
    elements.gallery.replaceChildren(fragment);
    elements.gallery.hidden = state.visible.length === 0;
    elements.gallery.setAttribute("aria-busy", "false");
  }

  function renderSkeletons() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 10; index += 1) {
      const card = document.createElement("div");
      card.className = "wallpaper-card skeleton-card";
      const media = document.createElement("div");
      media.className = "skeleton-media";
      const title = document.createElement("div");
      title.className = "skeleton-line skeleton-line--title";
      const meta = document.createElement("div");
      meta.className = "skeleton-line skeleton-line--meta";
      card.append(media, title, meta);
      fragment.append(card);
    }
    elements.gallery.replaceChildren(fragment);
    elements.gallery.hidden = false;
    elements.gallery.setAttribute("aria-busy", "true");
  }

  function updateCounts() {
    if (state.loading) {
      elements.resultsCount.textContent = "Loading…";
      elements.headerCount.textContent = "";
      return;
    }

    if (state.error) {
      elements.resultsCount.textContent = "Unavailable";
      elements.headerCount.textContent = "";
      return;
    }

    const total = state.all.length;
    const shown = state.visible.length;
    const totalLabel = `${total} wallpaper${total === 1 ? "" : "s"}`;

    if (total === 0) {
      elements.resultsCount.textContent = "No wallpapers";
      elements.headerCount.textContent = "0 wallpapers";
      return;
    }

    elements.headerCount.textContent = totalLabel;
    elements.resultsCount.textContent =
      shown === total ? totalLabel : `${shown} of ${total} wallpapers`;
  }

  function updateOrientationButtons() {
    elements.orientationButtons.forEach((button) => {
      const isActive = button.dataset.orientation === state.orientation;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateControls() {
    const hasFilters = Boolean(state.query || state.orientation);
    elements.searchClear.hidden = !state.query;
    elements.clearFilters.hidden = !hasFilters;

    const allUrls = wallpaperUrls(state.all);
    const visibleUrls = wallpaperUrls(state.visible);
    const unavailable = state.loading || Boolean(state.error);

    elements.copyAll.disabled = unavailable || allUrls.length === 0;
    elements.copyVisible.disabled = unavailable || visibleUrls.length === 0;
    elements.downloadAll.disabled = unavailable || allUrls.length === 0;
  }

  function updateEmptyStates() {
    const isEmpty = !state.loading && !state.error && state.all.length === 0;
    const hasNoResults =
      !state.loading && !state.error && state.all.length > 0 && state.visible.length === 0;

    elements.emptyCollection.hidden = !isEmpty;
    elements.emptyResults.hidden = !hasNoResults;
    elements.errorState.hidden = !state.error;

    if (isEmpty || hasNoResults) {
      elements.gallery.hidden = true;
    }
  }

  function syncUrl() {
    if (state.loading || state.error) return;

    try {
      const url = new URL(window.location.href);
      if (state.query) url.searchParams.set("q", state.query);
      else url.searchParams.delete("q");

      if (state.orientation) url.searchParams.set("orientation", state.orientation);
      else url.searchParams.delete("orientation");

      if (state.sort === "alphabetical") url.searchParams.set("sort", "alphabetical");
      else url.searchParams.delete("sort");

      window.history.replaceState(null, "", url);
    } catch {
      // Filter state is optional; the gallery still works without URL updates.
    }
  }

  function applyFilters() {
    state.visible = getVisibleWallpapers();
    renderGallery();
    updateCounts();
    updateOrientationButtons();
    updateControls();
    updateEmptyStates();
    syncUrl();
  }

  function setLoading() {
    state.loading = true;
    state.error = null;
    state.all = [];
    state.visible = [];

    elements.errorState.hidden = true;
    elements.emptyCollection.hidden = true;
    elements.emptyResults.hidden = true;
    renderSkeletons();
    updateCounts();
    updateControls();
    updateOrientationButtons();
  }

  function showError(error) {
    state.loading = false;
    state.error = error;
    state.visible = [];

    elements.gallery.replaceChildren();
    elements.gallery.hidden = true;
    elements.gallery.setAttribute("aria-busy", "false");
    elements.emptyCollection.hidden = true;
    elements.emptyResults.hidden = true;
    elements.errorState.hidden = false;

    if (error instanceof TypeError) {
      elements.errorMessage.textContent =
        "The manifest could not be fetched. Check that data/wallpapers.json exists and that the site is served over HTTP.";
    } else {
      elements.errorMessage.textContent =
        error instanceof Error && error.message
          ? error.message
          : "The manifest may be missing or malformed.";
    }

    updateCounts();
    updateControls();
  }

  /**
   * Last-resort error display for problems that happen before the normal
   * gallery state can be rendered. It deliberately uses direct DOM lookups so
   * a single missing element cannot prevent the error from being shown.
   */
  function showInitializationError(error) {
    console.error("Failed to initialize Moiré:", error);

    state.loading = false;
    state.error = error;

    const message =
      error instanceof Error && error.message
        ? error.message
        : "The gallery could not start.";
    const gallery = document.getElementById("gallery");
    const resultsCount = document.getElementById("results-count");
    const headerCount = document.getElementById("header-count");
    const errorState = document.getElementById("error-state");
    const errorMessage = document.getElementById("error-message");

    if (gallery) {
      gallery.replaceChildren();
      gallery.hidden = true;
      gallery.setAttribute("aria-busy", "false");
    }

    for (const id of ["empty-collection", "empty-results"]) {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    }

    for (const id of ["copy-all", "copy-visible", "download-all"]) {
      const element = document.getElementById(id);
      if (element) element.disabled = true;
    }

    if (resultsCount) resultsCount.textContent = "Unavailable";
    if (headerCount) headerCount.textContent = "";

    if (errorMessage) {
      errorMessage.textContent = `${message} Reload the page to try again.`;
    }

    if (errorState) {
      errorState.hidden = false;
    } else {
      const fallback = document.createElement("p");
      fallback.className = "noscript";
      fallback.setAttribute("role", "alert");
      fallback.textContent = `The wallpaper gallery could not start. ${message}`;
      (document.querySelector("main") || document.body).prepend(fallback);
    }

    const retryButton = document.getElementById("retry-button");
    if (retryButton) {
      retryButton.onclick = () => window.location.reload();
    }
  }

  async function loadWallpapers() {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      MANIFEST_TIMEOUT_MS
    );

    try {
      setLoading();

      const response = await fetch(MANIFEST_URL, {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `The wallpaper manifest returned HTTP ${response.status}.`
        );
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("data/wallpapers.json is not valid JSON.");
      }

      if (!Array.isArray(data)) {
        throw new Error("data/wallpapers.json must contain a top-level array.");
      }

      state.all = data
        .map((wallpaper, index) => normalizeWallpaper(wallpaper, index))
        .filter(Boolean);
      state.loading = false;
      state.error = null;

      applyFilters();
    } catch (error) {
      const displayError =
        error?.name === "AbortError"
          ? new Error("The wallpaper manifest took too long to load.")
          : error;

      console.error("Failed to load wallpapers:", displayError);
      showError(displayError);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const orientation = params.get("orientation") || "";

    state.query = (params.get("q") || "").slice(0, 200);
    state.orientation = VALID_ORIENTATIONS.has(orientation) ? orientation : "";
    state.sort = params.get("sort") === "alphabetical" ? "alphabetical" : "manual";

    elements.searchInput.value = state.query;
    elements.sortFilter.value = state.sort;
    updateOrientationButtons();
  }

  async function copyText(text) {
    if (!text) throw new Error("There is nothing to copy.");

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the selection-based copy path.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }

    if (!copied) throw new Error("Copying failed.");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.dataset.visible = "true";
    toastTimer = window.setTimeout(() => {
      elements.toast.dataset.visible = "false";
    }, 2600);
  }

  async function copyUrls(items, emptyMessage) {
    const urls = wallpaperUrls(items);
    if (urls.length === 0) {
      showToast(emptyMessage);
      return;
    }

    try {
      await copyText(urls.join("\n"));
      const label = `${urls.length} wallpaper URL${urls.length === 1 ? "" : "s"}`;
      const missing = items.length - urls.length;
      showToast(
        missing > 0
          ? `Copied ${label}. ${missing} entr${missing === 1 ? "y was" : "ies were"} missing an image.`
          : `Copied ${label}.`
      );
    } catch (error) {
      console.error(error);
      showToast("The links could not be copied. Try again.");
    }
  }

  function downloadAllUrls() {
    const urls = wallpaperUrls(manualSort(state.all));
    if (urls.length === 0) {
      showToast("There are no wallpaper URLs to download.");
      return;
    }

    const blob = new Blob([`${urls.join("\n")}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "moire-wallpapers.txt";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast(
      `Downloaded ${urls.length} wallpaper URL${urls.length === 1 ? "" : "s"}.`
    );
  }

  function setPreviewImage(url, title) {
    const image = elements.previewImage;

    image.classList.remove("is-loaded");
    image.hidden = true;
    image.removeAttribute("src");
    elements.previewLoader.hidden = false;
    elements.previewImageError.hidden = true;
    elements.previewImageError.textContent = "This image could not be loaded.";

    if (!url) {
      elements.previewLoader.hidden = true;
      elements.previewImageError.textContent =
        "This wallpaper has no usable image path.";
      elements.previewImageError.hidden = false;
      return;
    }

    image.onload = () => {
      image.hidden = false;
      image.classList.add("is-loaded");
      elements.previewLoader.hidden = true;
      elements.previewImageError.hidden = true;
      preloadAdjacentImages();
    };

    image.onerror = () => {
      image.hidden = true;
      elements.previewLoader.hidden = true;
      elements.previewImageError.hidden = false;
    };

    image.alt = `${title} wallpaper`;
    image.src = url;
  }

  function preloadAdjacentImages() {
    const total = state.visible.length;
    if (total < 2) return;

    const indexes = [
      (state.previewIndex - 1 + total) % total,
      (state.previewIndex + 1) % total,
    ];

    indexes.forEach((index) => {
      const url = state.visible[index]?.imageUrl;
      if (!url) return;
      const preload = new Image();
      preload.src = url;
    });
  }

  function renderPreview() {
    const wallpaper = state.visible[state.previewIndex];
    if (!wallpaper) {
      elements.preview.close();
      return;
    }

    const total = state.visible.length;
    const hasImage = Boolean(wallpaper.imageUrl);
    const meta = [
      orientationLabel(wallpaper.orientation),
      formatDimensions(wallpaper.width, wallpaper.height),
    ].filter(Boolean);

    elements.previewTitle.textContent = wallpaper.title;
    elements.previewMeta.textContent = meta.join(" · ");
    elements.previewCounter.textContent = `${state.previewIndex + 1} / ${total}`;
    elements.previewDescription.textContent = wallpaper.description;
    elements.previewDescription.hidden = !wallpaper.description;

    elements.previewPrev.disabled = total < 2;
    elements.previewNext.disabled = total < 2;

    elements.previewCopy.disabled = !hasImage;
    if (hasImage) {
      elements.previewOpen.href = wallpaper.imageUrl;
      elements.previewOpen.removeAttribute("aria-disabled");
      elements.previewOpen.removeAttribute("tabindex");
    } else {
      elements.previewOpen.removeAttribute("href");
      elements.previewOpen.setAttribute("aria-disabled", "true");
      elements.previewOpen.setAttribute("tabindex", "-1");
    }

    setPreviewImage(wallpaper.imageUrl, wallpaper.title);
  }

  function openPreview(id, trigger) {
    const index = state.visible.findIndex((wallpaper) => wallpaper.id === id);
    if (index < 0) return;

    state.previewIndex = index;
    state.previewTrigger = trigger || null;
    renderPreview();

    if (!elements.preview.open) {
      elements.preview.showModal();
    }

    document.body.classList.add("preview-open");
    elements.previewClose.focus({ preventScroll: true });
  }

  function movePreview(step) {
    const total = state.visible.length;
    if (total < 2) return;
    state.previewIndex = (state.previewIndex + step + total) % total;
    renderPreview();
  }

  function closePreview() {
    if (elements.preview.open) elements.preview.close();
  }

  function clearFilters() {
    state.query = "";
    state.orientation = "";
    elements.searchInput.value = "";
    applyFilters();
    elements.searchInput.focus();
  }

  function bindEvents() {
    elements.searchInput.addEventListener("input", () => {
      state.query = elements.searchInput.value.slice(0, 200);
      applyFilters();
    });

    elements.searchClear.addEventListener("click", () => {
      state.query = "";
      elements.searchInput.value = "";
      applyFilters();
      elements.searchInput.focus();
    });

    elements.orientationButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const orientation = button.dataset.orientation || "";
        state.orientation = VALID_ORIENTATIONS.has(orientation) ? orientation : "";
        applyFilters();
      });
    });

    elements.sortFilter.addEventListener("change", () => {
      state.sort =
        elements.sortFilter.value === "alphabetical" ? "alphabetical" : "manual";
      applyFilters();
    });

    elements.clearFilters.addEventListener("click", clearFilters);
    elements.emptyClearFilters.addEventListener("click", clearFilters);

    elements.copyAll.addEventListener("click", () => {
      copyUrls(manualSort(state.all), "There are no wallpaper URLs to copy.");
    });

    elements.copyVisible.addEventListener("click", () => {
      copyUrls(state.visible, "There are no matching wallpaper URLs to copy.");
    });

    elements.downloadAll.addEventListener("click", downloadAllUrls);

    elements.feedCopyButtons.forEach((button) => {
      button.addEventListener("click", () => {
        copyText(button.dataset.feedUrl)
          .then(() => showToast("Feed URL copied."))
          .catch((error) => {
            console.error(error);
            showToast("The feed URL could not be copied.");
          });
      });
    });

    elements.retryButton.addEventListener("click", loadWallpapers);

    elements.gallery.addEventListener("click", (event) => {
      const copyButton = event.target.closest("[data-copy-url]");
      if (copyButton) {
        copyText(copyButton.dataset.copyUrl)
          .then(() => showToast("Image URL copied."))
          .catch((error) => {
            console.error(error);
            showToast("The image URL could not be copied.");
          });
        return;
      }

      const previewButton = event.target.closest("[data-preview-id]");
      if (previewButton) {
        openPreview(previewButton.dataset.previewId, previewButton);
      }
    });

    elements.previewClose.addEventListener("click", closePreview);

    elements.previewPrev.addEventListener("click", () => movePreview(-1));
    elements.previewNext.addEventListener("click", () => movePreview(1));

    elements.previewCopy.addEventListener("click", () => {
      const wallpaper = state.visible[state.previewIndex];
      if (!wallpaper?.imageUrl) {
        showToast("This wallpaper has no image URL.");
        return;
      }
      copyText(wallpaper.imageUrl)
        .then(() => showToast("Image URL copied."))
        .catch((error) => {
          console.error(error);
          showToast("The image URL could not be copied.");
        });
    });

    elements.preview.addEventListener("close", () => {
      document.body.classList.remove("preview-open");
      elements.previewImage.removeAttribute("src");
      elements.previewImage.hidden = true;
      if (state.previewTrigger?.isConnected) {
        state.previewTrigger.focus({ preventScroll: true });
      }
      state.previewTrigger = null;
      state.previewIndex = -1;
    });

    elements.preview.addEventListener("click", (event) => {
      if (event.target === elements.preview) closePreview();
    });

    document.addEventListener("keydown", (event) => {
      if (elements.preview.open) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          movePreview(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          movePreview(1);
        }
        return;
      }

      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        elements.searchInput.focus();
      }
    });
  }

  function init() {
    try {
      validatePageStructure();
      elements.manifestLink.href = MANIFEST_URL;
      elements.footerManifestLink.href = MANIFEST_URL;
      elements.feedLinks.forEach((link) => {
        link.href = feedUrl(link.dataset.feedLink);
      });
      elements.feedCopyButtons.forEach((button) => {
        button.dataset.feedUrl = feedUrl(button.dataset.feedCopy);
      });
      loadStateFromUrl();
      bindEvents();
      loadWallpapers();
    } catch (error) {
      showInitializationError(error);
    }
  }

  init();
})();
