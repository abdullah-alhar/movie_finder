import https from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { load } from "cheerio";
import ipaddr from "ipaddr.js";

import { names, origins, posterUrl, mediaKind } from "./sources.js";
import { normalize, searchMovies, similarity } from "./search.js";

function safeURL(value, base) {
  try {
    if (!value || value.length > 8192) return null;
    const u = new URL(value, base);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.hostname.startsWith("[") ||
      isIP(u.hostname)
    )
      return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

function publicLookup(host, options, callback) {
  lookup(host, { all: true }, (err, rows) => {
    if (err) return callback(err);
    const privateAddress = rows.some(
      ({ address }) => ipaddr.parse(address).range() !== "unicast",
    );
    if (!rows.length || privateAddress)
      return callback(new Error("Public source required"));
    if (options.all) callback(null, rows);
    else {
      const row = rows.find(
        (candidate) => !options.family || candidate.family === options.family,
      );
      if (!row) return callback(new Error("Source address unavailable"));
      callback(null, row.address, row.family);
    }
  });
}

function requestPage(url, signal) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: publicLookup,
        autoSelectFamily: true,
        signal,
        headers: {
          "User-Agent": "Afterframe/2.0",
          Accept: "*/*",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          resolve({ location: res.headers.location });
          res.destroy();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error("Source unavailable"));
          res.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("error", reject);
        res.on("data", (part) => {
          size += part.length;
          if (size > 2_000_000) res.destroy(new Error("Oversized listing"));
          else chunks.push(part);
        });
        res.on("end", () =>
          resolve({
            html: Buffer.concat(chunks).toString("utf8"),
            url: url.href,
          }),
        );
      },
    );
    req.on("error", reject);
  });
}

let active = 0;
const queue = [];
export async function readHTML(address, timeout = 8000) {
  let url = safeURL(address);
  if (!url) throw new Error("Invalid URL");
  const signal = AbortSignal.timeout(timeout);
  if (active >= 10) {
    if (queue.length >= 64) throw new Error("Sources busy");
    await new Promise((resolve, reject) => {
      function begin() {
        signal.removeEventListener("abort", expire);
        resolve();
      }
      function expire() {
        queue.splice(queue.indexOf(begin), 1);
        reject(signal.reason);
      }
      queue.push(begin);
      signal.addEventListener("abort", expire, { once: true });
    });
  } else active++;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const result = await requestPage(url, signal);
      if ("html" in result) return result;
      const next = safeURL(result.location, url);
      if (next?.origin !== url.origin) break;
      url = next;
    }
    throw new Error("Source redirected");
  } finally {
    if (queue.length) queue.shift()();
    else active--;
  }
}

const moviePatterns = {
  isaidub: /^\/movie\/[a-z0-9-]+\/?$/i,
  moviezda: /^\/[a-z0-9-]+-(?:movie|(?:web-?)?series)(?:-\d+|-moviesda)?\/?$/i,
};
const itemPattern = /^\/download\/(?:page\/\d+|[a-z0-9-]+)\/?$/i;
function parseListing(html, url, source) {
  const $ = load(html);
  const items = [];
  $("a[href]")
    .slice(0, 5000)
    .each((_, el) => {
      const target = safeURL($(el).attr("href"), url);
      const match = $(el)
        .text()
        .trim()
        .match(/^(.{1,240}?)\s+\(((?:18|19|20)\d{2})\)/);
      if (
        !match ||
        target?.origin !== origins[source] ||
        !moviePatterns[source].test(target.pathname)
      )
        return;
      const movie = {
        url: target.href,
        title: match[1],
        year: +match[2],
        provider: names[source],
        source,
      };
      const anchor = $(el);
      const row = anchor.parent();
      const suffix = anchor.text().split(match[0]).at(-1);
      const adjacent =
        row.find("a[href]").length === 1
          ? row.text().split(match[0]).at(-1)
          : "";
      movie.quality = releaseQuality(suffix + " " + adjacent);
      items.push({ ...movie, poster: posterUrl(movie) });
    });
  const current = Number($("#currentPage").text() || 1);
  const total = Math.min(500, Number($("#totalPages").text() || 1));
  if (
    !items.length ||
    !Number.isInteger(current) ||
    !Number.isInteger(total) ||
    current < 1 ||
    total < current
  )
    throw new Error("Invalid catalogue page");
  return { items, current, total };
}

function categories(query, source, section) {
  const series = {
    path:
      source === "moviezda"
        ? "/tamil-web-series-download/"
        : "/tamil-dubbed-web-series/",
    series: true,
  };
  if (section === "series") return [series];
  const perYear = (year) =>
    "/tamil-" + year + (source === "isaidub" ? "-dubbed" : "") + "-movies/";
  const words = query.split(" ");
  const letters = new Set([words[0]?.[0]]);
  if (["a", "an", "the"].includes(words[0])) letters.add(words[1]?.[0]);
  if (similarity(words[0], "avengers") >= 0.74) {
    letters.add("a");
    letters.add("t");
  }
  const initials = [...letters].filter((x) => x && /^[a-z]$/.test(x));
  if (!initials.length || /^\d{4}$/.test(query)) {
    const year = /^\d{4}$/.test(query) ? query : new Date().getFullYear();
    return [{ path: perYear(year), year: true }];
  }
  const lettersPages = initials.map((c) => ({
    path:
      source === "isaidub"
        ? "/tamil-atoz-dubbed-movies/" + c
        : "/tamil-movies/" + c + "/",
    year: false,
  }));
  return [...lettersPages, series];
}

function pageUrl(source, category, page) {
  const url = origins[source] + category.path;
  if (page === 1) return url;
  if (category.series) return url + "?get-page=" + page;
  if (source === "moviezda") return url + "?page=" + page;
  return category.year ? url + "?get-page=" + page : url + "/" + page;
}

function pageQuality($) {
  return $("strong")
    .filter((_, el) => /^quality:$/i.test($(el).text().trim()))
    .first()
    .next("span")
    .text()
    .trim();
}

const season = /\b(?:season\s*|s)(\d{1,3})(?=\b|e\d)/i;
const episode = /(?:\b(?:episode|epi|ep)\s*|(?<=\d)e|\bE)(\d{1,4})\b/i;
function releaseQuality(label) {
  const formats = [
    [/\b(?:hq[ -]*)?pre[ -]*dvd(?:rip)?\b/i, "PreDVD"],
    [/\b(?:hd[ -]*)?cam(?:rip)?\b/i, "CAM"],
    [/\bHDTS\b/i, "HDTS"],
    [/\bweb[ -]*dl\b/i, "WEB-DL"],
    [/\bweb[ -]*rip\b/i, "WEBRip"],
    [/\b(?:blu[ -]*ray|b[rd]rip)\b/i, "Blu-ray"],
    [/\bhd[ -]*rip\b/i, "HDRip"],
    [/\bdvd[ -]*rip\b/i, "DVDRip"],
    [/\bHD\b/i, "HD"],
  ];
  return formats.find(([pattern]) => pattern.test(label))?.[1] || null;
}
const edition =
  /\b(?:HQ\s+PreDVD|PreDVD|WEB[- ]?DL|WEBRip|BDRip|Blu[- ]?Ray|HDRip|DVDRip|HDTS|Original|HD)\b/i;
const folder =
  /^\/(?:movie\/(?:\d+|[a-z0-9-]+-movie(?:-[a-z0-9-]+)?)|[a-z0-9-]+-(?:movie|(?:web-?)?series))\/?$/i;
function resolution(label) {
  const m = label.match(
    /\b(\d{3,4})\s*p\b|\b\d{3,4}\s*[x×]\s*(\d{3,4})\b|\b(4K)\b/i,
  );
  return m ? Number(m[1] || m[2] || 2160) : 0;
}

const handoffs = new Map(
  Object.entries({
    "download.moviespage.xyz": /^\/download\/file\/\d+\/?$/,
    "movies.downloadpage.xyz": /^\/download\/page\/\d+\/?$/,
    "dubpage.xyz": /^\/download\/view\/\d+\/?$/,
    "dubmv.xyz": /^\/download\/file\/\d+\/?$/,
  }),
);
function mediaFile(url) {
  return (
    /(?:^|\.)(?:fastbytes\.xyz|uptodub\.ch|isaidub\.dad)$/.test(url.hostname) &&
    ["/download.php", "/open.php"].includes(url.pathname) &&
    url.search
  );
}

export function createProviders(read = readHTML) {
  async function listing(source, category, num) {
    const { html, url } = await read(pageUrl(source, category, num));
    const data = parseListing(html, url, source);
    if (category.series)
      data.items.forEach((item) => {
        item.kind = "tv";
      });
    return data;
  }

  async function catalogue({
    q = "",
    category = "",
    source = "",
    page = 1,
    scan = 1,
    suggest = false,
    limitPages = suggest ? 2 : 12,
  } = {}) {
    const term = normalize(String(q).slice(0, 120));
    const sources = Object.hasOwn(origins, source)
      ? [source]
      : Object.keys(origins);
    const size = Math.min(12, Math.max(1, parseInt(limitPages) || 12));
    const start = term
      ? (Math.min(42, Math.max(1, parseInt(scan) || 1)) - 1) * 12 + 1
      : Math.min(500, Math.max(1, parseInt(page) || 1));
    let unavailable = false,
      more = false;
    const groups = await Promise.all(
      sources.flatMap((source) =>
        categories(term, source, category).map(async (category) => {
          try {
            const first = await listing(source, category, 1);
            const end = term ? start + size - 1 : start;
            more ||= first.total > end;
            const pending = [];
            for (let n = start; n <= Math.min(first.total, end); n++) {
              pending.push(
                (n === 1
                  ? Promise.resolve(first)
                  : listing(source, category, n)
                )
                  .then((result) => {
                    if (result.current !== n)
                      throw new Error("Unexpected page");
                    return result.items;
                  })
                  .catch(() => {
                    unavailable = true;
                    return [];
                  }),
              );
            }
            return (await Promise.all(pending)).flat();
          } catch {
            unavailable = true;
            return [];
          }
        }),
      ),
    );
    const unique = new Map();
    const length = Math.max(0, ...groups.map((g) => g.length));
    for (let i = 0; i < length; i++)
      for (const group of groups)
        if (group[i]) {
          const item = group[i];
          if (!unique.has(item.url) || item.kind === "tv")
            unique.set(item.url, item);
        }
    const items = [...unique.values()].filter(
      (movie) => category !== "series" || mediaKind(movie) === "tv",
    );
    if (!term) return { items, more, unavailable };
    return { items: searchMovies(term, items), more, unavailable };
  }

  async function preview(movie) {
    const { html, url } = await read(movie.url);
    const $ = load(html);
    const src = $('img[src*="/posters/"]').first().attr("src");
    return { quality: pageQuality($), poster: safeURL(src, url)?.href || null };
  }

  async function options(movie) {
    const root = safeURL(movie.url);
    const source = Object.keys(origins).find(
      (key) => origins[key] === root?.origin,
    );
    if (!source || !moviePatterns[source].test(root.pathname))
      return { options: [], unavailable: true };
    const found = new Map(),
      seen = new Set([root.href]);
    let unavailable = false;
    let rootQuality = "";
    let batch = [{ url: root.href, context: "", version: "" }];
    const deadline = Date.now() + 40000;
    for (let depth = 0; batch.length; depth++) {
      const next = [];
      for (let offset = 0; offset < batch.length; offset += 5) {
        await Promise.all(
          batch.slice(offset, offset + 5).map(async (item) => {
            try {
              if (Date.now() >= deadline) throw new Error("Source timed out");
              const { html, url } = await read(item.url);
              const $ = load(html);
              const version = item.version || pageQuality($);
              if (depth === 0) rootQuality = version;
              $("a[href]")
                .slice(0, 5000)
                .each((_, el) => {
                  const a = $(el),
                    href = safeURL(a.attr("href"), url);
                  if (href?.origin !== root.origin) return;
                  const label = a.text().replace(/\s+/g, " ").trim();
                  if (
                    href.pathname === new URL(url).pathname &&
                    /^\?(?:get-)?page=\d+$/.test(href.search) &&
                    !seen.has(href.href)
                  ) {
                    if (seen.size >= 256) {
                      unavailable = true;
                      return;
                    }
                    seen.add(href.href);
                    next.push({ ...item, url: href.href, version });
                    return;
                  }
                  if (!label) return;
                  const context = label + " " + item.context;
                  if (
                    itemPattern.test(href.pathname) &&
                    !/\b(sample|trailer|teaser)\b/i.test(label)
                  ) {
                    const quality = resolution(context);
                    const size =
                      a
                        .closest("ul")
                        .text()
                        .match(
                          /\b(?:file\s*)?size\s*:\s*(\d+(?:\.\d+)?\s*(?:GB|MB|KB))\b/i,
                        )?.[1] ||
                      label.match(/\((\d+(?:\.\d+)?\s*(?:GB|MB|KB))\)/i)?.[1] ||
                      "";
                    found.set(href.href, {
                      page: href.href,
                      title: label,
                      label: quality ? quality + "p" : label,
                      resolution: quality,
                      size: size.toUpperCase(),
                      edition: version || context.match(edition)?.[0] || "",
                      season: Number(context.match(season)?.[1]) || null,
                      episode: Number(context.match(episode)?.[1]) || null,
                    });
                  } else if (
                    folder.test(href.pathname) &&
                    (resolution(label) ||
                      edition.test(label) ||
                      season.test(label)) &&
                    !seen.has(href.href)
                  ) {
                    if (seen.size >= 64 || depth === 3) {
                      unavailable = true;
                      return;
                    }
                    seen.add(href.href);
                    const nextVersion = !resolution(label)
                      ? label.match(edition)?.[0]
                      : "";
                    next.push({
                      url: href.href,
                      context,
                      version:
                        nextVersion &&
                        !(version && /^original$/i.test(nextVersion))
                          ? nextVersion
                          : version,
                    });
                  }
                });
            } catch {
              unavailable = true;
            }
          }),
        );
      }
      batch = next;
    }
    return {
      quality: rootQuality,
      options: [...found.values()].sort((a, b) => b.resolution - a.resolution),
      unavailable,
    };
  }

  async function resolveMedia(page, watch) {
    let current = safeURL(page);
    if (
      !current ||
      !Object.values(origins).includes(current.origin) ||
      !itemPattern.test(current.pathname)
    )
      return null;
    const seen = new Set();
    let firstHandoff = null;
    try {
      for (let i = 0; i < 4 && current && !seen.has(current.href); i++) {
        seen.add(current.href);
        const { html, url } = await read(current.href),
          $ = load(html);
        let next = null;
        for (const a of $("a[href]").slice(0, 5000)) {
          const target = safeURL($(a).attr("href"), url);
          if (!target) continue;
          const label = $(a).text();
          if (
            watch &&
            /\bwatch\s+online\b/i.test(label) &&
            ["play.onestream.today", "dub.onestream.today"].includes(
              target.hostname,
            ) &&
            /^\/stream\/(?:page|video)\/\d+\/?$/.test(target.pathname)
          ) {
            const player = await read(target.href),
              doc = load(player.html);
            for (const el of doc("video[src], video source[src]")) {
              const src = safeURL(doc(el).attr("src"), player.url);
              if (
                ["video/mp4", "video/webm"].includes(
                  doc(el).attr("type") || "video/mp4",
                ) &&
                src &&
                mediaFile(src)
              )
                return src.href;
            }
          }
          if (!/\bdownload\b/i.test(label)) continue;
          if (
            !watch &&
            mediaFile(target) &&
            (target.searchParams.get("dl") ||
              (target.hostname === "download.isaidub.dad" &&
                target.searchParams.get("url")))
          )
            return target.href;
          if (!next && handoffs.get(target.hostname)?.test(target.pathname))
            next = target;
        }
        firstHandoff ||= next?.href;
        current = next;
      }
    } catch {
      /* An expired server may still offer the provider's download page. */
    }
    return watch ? null : firstHandoff || null;
  }
  return { catalogue, options, preview, resolveMedia };
}
export const { catalogue, options, preview, resolveMedia } = createProviders();
