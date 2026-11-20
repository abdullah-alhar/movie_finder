export const $ = (selector) => document.querySelector(selector);
const shapes = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14a8.5 8.5 0 0 1-10-11A9 9 0 1 0 20 14Z"/>',
  save: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  film: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m4 3 16-2 1 5-17 2zm4 0 3 4m3-5 3 4"/>',
  left: '<path d="m14 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
};
export const icon = (name) =>
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
  (shapes[name] || "") +
  "</svg>";
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
export function safeImage(value) {
  return typeof value === "string" &&
    (/^https:\/\//.test(value) || /^\/art\/[\w.-]+$/.test(value))
    ? value
    : "";
}
export const searchUrl = (item) =>
  "/search?" +
  new URLSearchParams({ q: [item.title, item.year].filter(Boolean).join(" ") });
export function movieUrl(item) {
  return /^\/movie\/[\w.-]+$/.test(item.url || "") ? item.url : searchUrl(item);
}
export async function json(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
let timer;
export function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (node.hidden = true), 2600);
}
export function card(item, index = 6) {
  const node = document.createElement("article");
  node.className = "card";
  const art = safeImage(item.image || item.poster);
  const desc = [item.year, item.genre || item.provider]
    .filter(Boolean)
    .join(" · ");
  const link = document.createElement("a");
  link.className = "card-link";
  link.href = movieUrl(item);
  link.innerHTML =
    '<div class="poster"><span class="poster-name">' +
    esc(item.title) +
    "</span>" +
    (art
      ? '<img loading="' +
        (index < 4 ? "eager" : "lazy") +
        '" fetchpriority="' +
        (index < 2 ? "high" : "auto") +
        '" decoding="async" alt="" src="' +
        esc(art) +
        '">'
      : "") +
    "</div><h3>" +
    esc(item.title) +
    "</h3><p>" +
    esc(desc) +
    "</p>";
  node.append(link);
  const poster = link.querySelector(".poster");
  const image = poster.querySelector("img");
  const badge = document.createElement("span");
  if (item.provider) {
    badge.className = "release-quality";
    badge.textContent = item.quality || "Checking quality…";
    poster.append(badge);
  }
  if (/^\/movie\//.test(item.url || "")) {
    let active = false;
    let preview, artwork;
    const getPreview = () => preview ||= json(item.url + "/preview").catch(() => ({}));
    const getArtwork = () => artwork ||= json("/poster-artwork?" + new URLSearchParams({
      title: item.title, year: item.year || "", kind: item.kind || "movie",
    }));
    async function loadPoster(lookup, key) {
      const src = safeImage((await lookup())[key]);
      if (!src || src === art) throw new Error("No alternate poster");
      const replacement = new Image();
      replacement.alt = "";
      replacement.decoding = "async";
      replacement.fetchPriority = index < 2 ? "high" : "auto";
      replacement.src = src;
      await replacement.decode();
      return replacement;
    }
    async function updatePoster() {
      try {
        const provider = loadPoster(getPreview, "poster");
        const replacement = item.provider === "Isaidub"
          ? await Promise.any([provider, loadPoster(getArtwork, "image")])
          : await provider.catch(() => loadPoster(getArtwork, "image"));
        if (node.isConnected) poster.append(replacement);
      } catch {
        // The title stays visible when both sources lack artwork.
      }
    }
    if (image) image.onerror = () => {
      image.remove();
      if (active) updatePoster();
    };
    function activate() {
      active = true;
      if (!item.quality) getPreview().then((data) => {
        badge.textContent = data.quality || "Quality unlisted";
      });
      if (!poster.querySelector("img")) updatePoster();
    }
    if (index < 4) activate();
    else {
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        activate();
      }, {rootMargin: "240px 0px"});
      observer.observe(node);
    }
  } else if (image) image.onerror = () => image.remove();
  return node;
}
export function section(title, items) {
  const wrap = document.createElement("section");
  wrap.className = "collection";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const row = document.createElement("div");
  row.className = "posters";
  row.append(...items.map((item) => card(item)));
  wrap.append(heading, row);
  return wrap;
}

export function choice(label, values, selected, onChange, format = String) {
  const field = document.createElement("div");
  field.className = "choice";
  const caption = document.createElement("span");
  caption.textContent = label;
  const menu = document.createElement("details");
  menu.dataset.label = label;
  const trigger = document.createElement("summary");
  const panel = document.createElement("div");
  panel.className = "choice-options";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", label);

  function display(value) {
    trigger.textContent = format(value);
    trigger.setAttribute("aria-label", label + ", " + format(value));
    [...panel.children].forEach((button, index) =>
      button.setAttribute("aria-pressed", String(values[index] === value)),
    );
  }
  for (const value of values) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = format(value);
    button.onclick = () => {
      menu.open = false;
      display(value);
      onChange(value);
      // Season and episode changes rebuild the controls.
      const current = [...document.querySelectorAll(".choice details")].find(
        (details) => details.dataset.label === label,
      );
      current?.querySelector("summary").focus();
    };
    panel.append(button);
  }
  display(selected);
  menu.append(trigger, panel);
  field.append(caption, menu);
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      trigger.focus();
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    menu.open = true;
    const buttons = [...panel.children];
    const index = buttons.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index < 0
            ? buttons.findIndex(
                (button) => button.getAttribute("aria-pressed") === "true",
              )
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
    buttons[next]?.focus();
  });
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget)) menu.open = false;
  });
  return field;
}

document.addEventListener("pointerdown", (event) => {
  for (const menu of document.querySelectorAll(".choice details[open]"))
    if (!menu.contains(event.target)) menu.open = false;
});
