(() => {
  "use strict";

  const SITE_BASE = new URL("./", window.location.href);
  const BASE_PATH = SITE_BASE.pathname.replace(/\/+$/, "");
  const MANIFEST_URL = new URL("data/wallpapers.json", SITE_BASE).href;
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
    categoryFilter: document.getElementById("category-filter"),
    tagFilter: document.getElementById("tag-filter"),
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
    preview: document.getElementById("preview"),
    previewTitle: document.getElementById("preview-title"),
    previewCategory: document.getElementById("preview-category"),
    previewCounter: document.getElementById("preview-counter"),
    previewDescription: document.getElementById("preview-description"),
    previewTags: document.getElementById("preview-tags"),
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
    category: "",
    tag: "",
    sort: "manual",
    loading: true,
    error: null,
    previewIndex: -1,
    previewTrigger: null,
  };

  let toastTimer = 0;

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeForSearch(value) {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(asString).filter(Boolean))];
  }

  /**
   * The single source of truth for turning a manifest image path into a public
   * URL. Both the gallery and every exported link use this function.
   *
   * Pages CMS can write paths such as /images/wallpapers/a.webp. GitHub Pages
   * project sites live under /moire/, so leading slashes must be rebased rather
   * than resolved against the domain root.
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
    const category = asString(raw.category) || "Uncategorized";
    const image = asString(raw.image);
    const imageUrl = resolveImagePath(image);
    const id = asString(raw.id) || `wallpaper-${index}`;
    const description = asString(raw.description);
    const numericOrder =
      raw.order === null || raw.order === undefined || raw.order === ""
        ? null
        : Number(raw.order);
    const order = Number.isFinite(numericOrder) ? numericOrder : null;

    let rawTags = [];
    if (Array.isArray(raw.tags)) {
      rawTags = raw.tags;
    } else if (typeof raw.tags === "string") {
      rawTags = raw.tags.split(",");
    }

    const tags = uniqueStrings(rawTags);
    const searchText = normalizeForSearch(
      [title, category, tags.join(" "), description].join(" ")
    );

    if (image && !imageUrl) {
      console.warn(`Could not resolve the image path for "${title}".`);
    }

    return {
      id,
      title,
      image,
      imageUrl,
      category,
      tags,
      description,
      order,
      index,
      searchText,
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
      if (state.category && wallpaper.category !== state.category) return false;
      if (state.tag && !wallpaper.tags.includes(state.tag)) return false;
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

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = wallpaper.title;
    title.title = wallpaper.title;

    const category = document.createElement("span");
    category.className = "card-category";
    category.textContent = wallpaper.category;

    info.append(title, category);

    const tags = document.createElement("p");
    tags.className = "card-tags";
    wallpaper.tags.slice(0, 3).forEach((tag) => {
      const tagLabel = document.createElement("span");
      tagLabel.textContent = tag;
      tags.append(tagLabel);
    });
    if (wallpaper.tags.length > 3) {
      const more = document.createElement("span");
      more.textContent = `+${wallpaper.tags.length - 3}`;
      tags.append(more);
    }

    card.append(media, info, tags);
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
    for (let index = 0; index < 8; index += 1) {
      const card = document.createElement("div");
      card.className = "wallpaper-card skeleton-card";
      const media = document.createElement("div");
      media.className = "skeleton-media";
      const title = document.createElement("div");
      title.className = "skeleton-line skeleton-line--title";
      const tag = document.createElement("div");
      tag.className = "skeleton-line skeleton-line--tag";
      card.append(media, title, tag);
      fragment.append(card);
    }
    elements.gallery.replaceChildren(fragment);
    elements.gallery.hidden = false;
    elements.gallery.setAttribute("aria-busy", "true");
  }

  function buildFilterOptions() {
    const categories = uniqueStrings(state.all.map((item) => item.category)).sort(
      (a, b) => collator.compare(a, b)
    );
    const tags = uniqueStrings(state.all.flatMap((item) => item.tags)).sort(
      (a, b) => collator.compare(a, b)
    );

    const categoryOption = new Option("All categories", "");
    const tagOption = new Option("All tags", "");

    elements.categoryFilter.replaceChildren(
      categoryOption,
      ...categories.map((category) => new Option(category, category))
    );
    elements.tagFilter.replaceChildren(
      tagOption,
      ...tags.map((tag) => new Option(tag, tag))
    );

    if (!categories.includes(state.category)) state.category = "";
    if (!tags.includes(state.tag)) state.tag = "";

    elements.categoryFilter.value = state.category;
    elements.tagFilter.value = state.tag;
    elements.sortFilter.value = state.sort;
  }

  function updateCounts() {
    if (state.loading) {
      elements.resultsCount.textContent = "Loading collection…";
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

  function updateControls() {
    const hasFilters = Boolean(state.query || state.category || state.tag);
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

    if (isEmpty) {
      elements.gallery.hidden = true;
    }
    if (hasNoResults) {
      elements.gallery.hidden = true;
    }
  }

  function syncUrl() {
    if (state.loading || state.error) return;

    try {
      const url = new URL(window.location.href);
      if (state.query) url.searchParams.set("q", state.query);
      else url.searchParams.delete("q");

      if (state.category) url.searchParams.set("category", state.category);
      else url.searchParams.delete("category");

      if (state.tag) url.searchParams.set("tag", state.tag);
      else url.searchParams.delete("tag");

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

  async function loadWallpapers() {
    setLoading();

    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-cache" });
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

      buildFilterOptions();
      applyFilters();
    } catch (error) {
      console.error("Failed to load wallpapers:", error);
      showError(error);
    }
  }

  function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    state.query = (params.get("q") || "").slice(0, 200);
    state.category = params.get("category") || "";
    state.tag = params.get("tag") || "";
    state.sort = params.get("sort") === "alphabetical" ? "alphabetical" : "manual";

    elements.searchInput.value = state.query;
    elements.sortFilter.value = state.sort;
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

    elements.previewTitle.textContent = wallpaper.title;
    elements.previewCategory.textContent = wallpaper.category;
    elements.previewCounter.textContent = `${state.previewIndex + 1} / ${total}`;
    elements.previewDescription.textContent = wallpaper.description;
    elements.previewDescription.hidden = !wallpaper.description;

    elements.previewTags.replaceChildren(
      ...wallpaper.tags.map((tag) => {
        const item = document.createElement("li");
        item.textContent = tag;
        return item;
      })
    );
    elements.previewTags.hidden = wallpaper.tags.length === 0;

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
    state.category = "";
    state.tag = "";
    elements.searchInput.value = "";
    elements.categoryFilter.value = "";
    elements.tagFilter.value = "";
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

    elements.categoryFilter.addEventListener("change", () => {
      state.category = elements.categoryFilter.value;
      applyFilters();
    });

    elements.tagFilter.addEventListener("change", () => {
      state.tag = elements.tagFilter.value;
      applyFilters();
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
    elements.manifestLink.href = MANIFEST_URL;
    elements.footerManifestLink.href = MANIFEST_URL;
    loadStateFromUrl();
    bindEvents();
    loadWallpapers();
  }

  init();
})();
