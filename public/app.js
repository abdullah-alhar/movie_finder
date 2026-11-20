import { $, icon, esc, movieUrl, card, section, choice, json } from "./ui.js";
import { showDetail } from "./detail.js";

const main = $("#main"),
  params = new URLSearchParams(location.search);
const q = (params.get("q") || "").trim(),
  source = params.get("source") || "",
  sort = params.get("sort") || "latest";
const isDetail = location.pathname.startsWith("/movie/"),
  isSeries = location.pathname === "/series";
const isDiscover =
  location.pathname === "/" &&
  !q &&
  !source &&
  !params.has("sort") &&
  !params.has("page");
$(
  "#" + (isSeries ? "series" : isDiscover ? "discover" : "browse") + "-nav",
).setAttribute("aria-current", "page");
function theme(value) {
  document.documentElement.dataset.theme = value;
  $("#theme").innerHTML = icon(value === "light" ? "moon" : "sun");
  $("#theme").setAttribute(
    "aria-label",
    "Switch to " + (value === "light" ? "dark" : "light") + " mode",
  );
}
// Remove preferences and history left by earlier versions.
try {
  for (const key of [
    "afterframe-theme",
    "afterframe-history",
    "afterframe-watchlist",
  ])
    localStorage.removeItem(key);
} catch {}
theme("dark");
$("#theme").onclick = () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  theme(next);
};
const query = $("#query"),
  suggestions = $("#suggestions");
query.value = q;
if (isSeries) {
  query.form.action = "/series";
  query.placeholder = "Search series…";
  query.setAttribute("aria-label", "Search series");
}
if (source) {
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "source";
  hidden.value = source;
  query.form.append(hidden);
}
let timer, abort;
function closeSearch() {
  clearTimeout(timer);
  abort?.abort();
  suggestions.hidden = true;
  query.setAttribute("aria-expanded", "false");
}
query.oninput = () => {
  closeSearch();
  const value = query.value.trim();
  if (value.length < 2) return;
  timer = setTimeout(async () => {
    const controller = new AbortController();
    abort = controller;
    try {
      const data = await json(
        "/api/suggestions?" +
          new URLSearchParams({
            q: value,
            source,
            category: isSeries ? "series" : "",
          }),
        controller.signal,
      );
      if (query.value.trim() !== value || controller.signal.aborted) return;
      suggestions.replaceChildren(
        ...data.items.slice(0, 6).map((item) => {
          const link = document.createElement("a");
          link.href = movieUrl(item);
          link.textContent = [item.title, item.year]
            .filter(Boolean)
            .join(" · ");
          return link;
        }),
      );
      const all = document.createElement("button");
      all.type = "submit";
      all.textContent = isSeries ? "Search series" : "Search all listings";
      suggestions.append(all);
      suggestions.hidden = false;
      query.setAttribute("aria-expanded", "true");
    } catch {}
  }, 350);
};
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  ) {
    event.preventDefault();
    query.focus();
  }
  if (event.key === "Escape") closeSearch();
});
query.form.addEventListener("keydown", (event) => {
  if (suggestions.hidden || !["ArrowDown", "ArrowUp"].includes(event.key))
    return;
  event.preventDefault();
  const targets = [query, ...suggestions.querySelectorAll("a,button")];
  targets[
    (targets.indexOf(document.activeElement) +
      (event.key === "ArrowDown" ? 1 : -1) +
      targets.length) %
      targets.length
  ].focus();
});
query.form.addEventListener("focusout", (event) => {
  if (!query.form.contains(event.relatedTarget)) closeSearch();
});
function href(changes) {
  const copy = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (!value || value === 1) copy.delete(key);
    else copy.set(key, value);
  }
  return (isSeries ? "/series" : "/movies") + (copy.size ? "?" + copy : "");
}
function createCatalogue() {
  const shell = document.createElement("section");
  shell.className = "catalogue collection";
  const page = Math.max(1, Number(params.get("page")) || 1),
    scan = Math.max(1, Number(params.get("scan")) || 1);
  shell.innerHTML =
    '<div class="section-head"><h2>' +
    esc(
      q
        ? "Search results"
        : isDiscover
          ? "Latest in the catalogue"
          : isSeries
            ? "Series catalogue"
            : "Film catalogue",
    ) +
    '</h2></div><div class="filters"><div class="pills">' +
    [
      ["", "All sources"],
      ["isaidub", "Dubbed"],
      ["moviezda", isSeries ? "Tamil" : "Tamil movies"],
    ]
      .map(
        ([k, label]) =>
          "<a " +
          (k === source ? 'aria-current="true"' : "") +
          ' href="' +
          esc(href({ source: k, page: 1, scan: 1 })) +
          '">' +
          label +
          "</a>",
      )
      .join("") +
    '</div></div><div class="catalogue-body" aria-busy="true"><p class="notice" role="status">Loading titles…</p></div>';
  const sortMenu = choice(
    "Sort",
    ["latest", "title"],
    sort === "title" ? sort : "latest",
    (value) => location.assign(href({ sort: value, page: 1 })),
    (value) => (value === "title" ? "Title A–Z" : q ? "Relevance" : "Latest"),
  );
  shell.querySelector(".filters").append(sortMenu);
  const body = shell.querySelector(".catalogue-body");
  function draw(data) {
    body.replaceChildren();
    body.setAttribute("aria-busy", "false");
    if (data.items?.length) {
      const cards = document.createElement("div");
      cards.className = "posters";
      cards.append(...data.items.map(card));
      body.append(cards);
    } else if (!data.unavailable) {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = q
        ? "No matching titles. Try a shorter title or another source."
        : "No titles available from this source.";
      body.append(notice);
    }
    if (data.unavailable) {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = "Some live listings could not be checked.";
      const retry = document.createElement("button");
      retry.className = "textbtn";
      retry.textContent = "Retry listings";
      retry.onclick = refresh;
      body.append(notice, retry);
    }
    const nav = document.createElement("nav");
    nav.className = "paging";
    nav.setAttribute("aria-label", "Catalogue pages");
    function pageLink(text, path) {
      const link = document.createElement("a");
      link.className = "secondary";
      link.href = path;
      link.textContent = text;
      nav.append(link);
    }
    if (page > 1) pageLink("Previous page", href({ page: page - 1 }));
    if (data.pages > page || (!q && data.more))
      pageLink("Next page", href({ page: page + 1 }));
    if (q && (data.more || data.moreListings))
      pageLink("Search more listings", href({ scan: scan + 1, page: 1 }));
    body.append(nav);
  }
  const filters = new URLSearchParams({ q, source, page, scan, sort });
  if (isSeries) filters.set("category", "series");
  let loading = false;
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    body.setAttribute("aria-busy", "true");
    try {
      draw(await json("/api/catalogue?" + filters));
    } catch {
      draw({ items: [], unavailable: true });
    } finally {
      loading = false;
    }
  }
  refresh();
  setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", refresh);
  return shell;
}
if (isDetail) showDetail(main);
else {
  const heading = document.createElement("header");
  heading.className = "page-heading";
  const title = q
    ? "Results for “" + q + "”"
    : isSeries
      ? "Series"
      : isDiscover
        ? "Discover films"
        : "Browse films";
  heading.innerHTML = "<h1>" + esc(title) + "</h1>";
  main.append(heading);
  document.title = title + " · Afterframe";
  main.append(createCatalogue());
  if (isDiscover)
    json("/api/discovery")
      .then((groups) => {
        for (const [title, films] of Object.entries(groups)) {
          if (Array.isArray(films) && films.length)
            main.append(section(title, films));
        }
      })
      .catch(() => {});
}
