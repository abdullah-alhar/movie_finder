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

const dnsCache = new Map();
function publicLookup(host, options, callback) {
  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    if (options.all) return callback(null, cached.rows);
    const row = cached.rows.find(
      (candidate) => !options.family || candidate.family === options.family,
    ) || cached.rows[0];
    return callback(null, row.address, row.family);
  }
  lookup(host, { all: true }, (err, rows) => {
    if (err) return callback(err);
    const privateAddress = rows.some(
      ({ address }) => ipaddr.parse(address).range() !== "unicast",
    );
    if (!rows.length || privateAddress)
      return callback(new Error("Public source required"));
    dnsCache.set(host, { rows, expires: Date.now() + 300_000 });
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

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,
  maxFreeSockets: 10,
  timeout: 5000,
});

function requestPage(url, signal) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: httpsAgent,
        lookup: publicLookup,
        autoSelectFamily: true,
        signal,
        headers: {
          "User-Agent": "AfterShow/2.0",
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
export async function readHTML(address, timeout = 4500) {
  let url = safeURL(address);
  if (!url) throw new Error("Invalid URL");
  const signal = AbortSignal.timeout(timeout);
  if (active >= 24) {
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
      const isSourceOrigin = target?.origin === origins[source] ||
        // Allow any URL whose origin matches any registered origin for this source family
        Object.entries(origins).some(([k, o]) => k === source && target?.origin === o);
      if (
        !match ||
        !isSourceOrigin ||
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

const season = /\b(?:season[\s._-]*|s)(\d{1,3})(?=\b|e\d)/i;
const episode = /(?:\b(?:episode|epi|ep)[\s._-]*|(?<=\d)e|\bE)(\d{1,4})\b/i;
function releaseQuality(label) {
  const formats = [
    [/\b(?:hq[ -]*)?pre[ -]*dvd(?:rip)?\b/i, "PreDVD"],
    [/\b(?:hd[ -]*)?cam(?:[ -]*dvd|rip)?\b/i, "CAM"],
    [/\bcam[ -]*dvd\b/i, "CAM"],
    [/\b(?:hd[ -]*)?ts\b|\bhdts\b|\btelesync\b/i, "HDTS"],
    [/\b(?:tc|tcrip|telecine)\b/i, "TC"],
    [/\bdvdscr|scr\b/i, "SCR"],
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

export function createProviders(read = readHTML, { listingTtl = 0 } = {}) {
  const listings = new Map();
  async function listing(source, category, num) {
    const address = pageUrl(source, category, num);
    const key = `${source}:${category.series ? "tv" : "movie"}:${address}`;
    const cached = listings.get(key);
    if (cached && cached.expires > Date.now()) return cached.pending;
    const pending = (async () => {
      const { html, url } = await read(address);
      const data = parseListing(html, url, source);
      if (category.series) for (const item of data.items) item.kind = "tv";
      return data;
    })();
    if (listingTtl > 0) {
      if (listings.size >= 256) listings.delete(listings.keys().next().value);
      listings.set(key, { pending, expires: Date.now() + listingTtl });
      pending.catch(() => {
        if (listings.get(key)?.pending === pending) listings.delete(key);
      });
    }
    return pending;
  }

  const seasonChecks = new Map();
  async function seasonNumbers(movie) {
    const cached = seasonChecks.get(movie.url);
    if (cached?.until > Date.now()) return cached.result;
    const result = (async () => {
      try {
        const { html, url } = await read(movie.url);
        const $ = load(html);
        const numbers = new Set();
        $("a[href]").slice(0, 5000).each((_, el) => {
          const link = safeURL($(el).attr("href"), url);
          const number = $(el).text().match(season)?.[1];
          if (link?.origin === origins[movie.source] && folder.test(link.pathname) && number)
            numbers.add(Number(number));
        });
        return [...numbers].sort((a, b) => a - b);
      } catch {
        seasonChecks.delete(movie.url);
        return [];
      }
    })();
    if (seasonChecks.size >= 512) seasonChecks.delete(seasonChecks.keys().next().value);
    seasonChecks.set(movie.url, { result, until: Date.now() + 120_000 });
    return result;
  }

  async function groupSeries(items) {
    const candidates = new Map();
    for (const item of items) {
      if (mediaKind(item) !== "tv") continue;
      const title = normalize(item.title).replace(/\s+(?:season|s)\s*\d{1,3}$/, "");
      const key = `${item.source}:${title}`;
      if (!title) continue;
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(item);
    }
    const replacements = new Map();
    const groups = [...candidates.values()].filter(group =>
      group.length >= 2 && group.length <= 8);
    for (let i = 0; i < groups.length; i += 3) {
      await Promise.all(groups.slice(i, i + 3).map(async group => {
        const entries = await Promise.all(group.map(async item => ({
          item,
          seasons: await seasonNumbers(item),
        })));
        const complete = entries.filter(entry => entry.seasons.length);
        // Separate runs/remakes can share a title. Never collapse overlapping
        // numbering, or infer a season from the release year.
        const seasons = complete.flatMap(entry => entry.seasons);
        if (complete.length < 2 || new Set(seasons).size !== seasons.length) return;
        complete.sort((a, b) => b.seasons.at(-1) - a.seasons.at(-1) || b.item.year - a.item.year);
        const canonical = {
          ...complete[0].item,
          title: complete[0].item.title.replace(/[\s(–-]+(?:season|s)\s*\d{1,3}\)?$/i, ""),
          seriesEntries: complete.map(({ item, seasons }) => [item.url, item.year, seasons]),
        };
        for (const { item } of complete) replacements.set(item.url, canonical);
      }));
    }
    return [...new Set(items.map(item => replacements.get(item.url) || item))];
  }

  const directories = new Map();
  async function seriesDirectory(source, category, start) {
    // Compare adjacent provider pages before choosing the canonical card.
    const firstPage = Math.floor((start - 1) / 12) * 12 + 1;
    const key = `${origins[source]}:${firstPage}`;
    const cached = directories.get(key);
    let result = cached?.until > Date.now() ? cached.result : null;
    if (!result) {
      result = (async () => {
        const first = await listing(source, category, 1);
        let incomplete = false;
        const pages = new Map();
        for (let n = firstPage; n <= Math.min(firstPage + 11, first.total); n++) {
          pages.set(n, (n === 1 ? Promise.resolve(first) : listing(source, category, n))
            .then(data => {
              if (data.current !== n) throw new Error("Unexpected page");
              return data.items;
            })
            .catch(() => {
              incomplete = true;
              return [];
            }));
        }
        const groups = await Promise.all(pages.values());
        return { pages, all: groups.flat(), total: first.total, incomplete };
      })();
      if (directories.size >= 64) directories.delete(directories.keys().next().value);
      directories.set(key, { result, until: Date.now() + 60_000 });
      result.then(data => {
        if (data.incomplete && directories.get(key)?.result === result) directories.delete(key);
      }, () => {
        if (directories.get(key)?.result === result) directories.delete(key);
      });
    }
    const data = await result;
    return { ...data, items: await data.pages.get(start) || [] };
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
    if (!sources.length) return { items: [], more: false, unavailable: true };
    const size = Math.min(12, Math.max(1, parseInt(limitPages) || 12));
    const start = term
      ? (Math.min(42, Math.max(1, parseInt(scan) || 1)) - 1) * 12 + 1
      : Math.min(500, Math.max(1, parseInt(page) || 1));
    let unavailable = false,
      more = false;
    if (!term && category === "series") {
      const dirs = await Promise.all(sources.map(source =>
        seriesDirectory(source, categories(term, source, category)[0], start)
          .catch(() => ({ items: [], all: [], total: 1, incomplete: true }))));
      const universe = [...new Map(dirs.flatMap(dir => dir.all).map(item => [item.url, item])).values()];
      const current = new Set(dirs.flatMap(dir => dir.items).map(item => item.url));
      const items = (await groupSeries(universe)).filter(item => current.has(item.url));
      const pages = Math.max(1, ...dirs.map(dir => dir.total));
      return { items, pages, more: start < pages, unavailable: dirs.some(dir => dir.incomplete) };
    }
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
    const matches = term
      ? searchMovies(term, items)
      : items;
    // Group before the server slices search results into display pages.
    return { items: await groupSeries(matches), more, unavailable };
  }

  async function preview(movie) {
    let target = safeURL(movie.url);
    if (!target) return { quality: null, poster: null };
    let source = Object.keys(origins).find((k) => origins[k] === target.origin);
    if (!source) {
      if (/isaidub/i.test(target.hostname)) source = "isaidub";
      else if (/moviezda|moviesda/i.test(target.hostname)) source = "moviezda";
    }
    if (source && origins[source] && origins[source] !== target.origin) {
      target = safeURL(target.pathname + target.search, origins[source]) || target;
    }
    try {
      const { html, url } = await read(target.href);
      const $ = load(html);
      const src = $('img[src*="/posters/"]').first().attr("src");
      return { quality: pageQuality($), poster: safeURL(src, url)?.href || null };
    } catch {
      return { quality: null, poster: null };
    }
  }

  const optionsCache = new Map();
  const pendingOptions = new Map();

  async function options(movie) {
    let root = safeURL(movie.url);
    if (!root) return { options: [], unavailable: true };

    let source = Object.keys(origins).find(
      (key) => origins[key] === root.origin,
    );
    if (!source) {
      if (/isaidub/i.test(root.hostname)) source = "isaidub";
      else if (/moviezda|moviesda/i.test(root.hostname)) source = "moviezda";
    }
    if (!source) return { options: [], unavailable: true };

    // Point root to the CURRENT active origin for this source so updated mirrors work seamlessly!
    if (origins[source] && origins[source] !== root.origin) {
      root = safeURL(root.pathname + root.search, origins[source]) || root;
    }

    if (!moviePatterns[source].test(root.pathname))
      return { options: [], unavailable: true };

    const cacheKey = root.href;
    const cached = optionsCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (pendingOptions.has(cacheKey)) {
      return pendingOptions.get(cacheKey);
    }

    const fetchPromise = (async () => {
      const found = new Map(),
        seen = new Set([root.href]);
      let unavailable = false;
      let rootQuality = "";
      let batch = [{ url: root.href, context: "", version: "", depth: 0 }];
      const deadline = Date.now() + 15_000;
      while (batch.length && Date.now() < deadline) {
        const next = [];
        for (let offset = 0; offset < batch.length; offset += 10) {
          await Promise.all(
            batch.slice(offset, offset + 10).map(async (item) => {
              try {
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new Error("Source timed out");
                const { html, url } = await read(item.url, Math.min(4500, remaining));
                const $ = load(html);
                const version = item.version || pageQuality($);
                if (item.url === root.href) rootQuality = version;
                $("a[href]")
                  .slice(0, 5000)
                  .each((_, el) => {
                    const a = $(el),
                      href = safeURL(a.attr("href"), url);
                    if (href?.origin !== root.origin) return;
                    const label = a.text().replace(/\s+/g, " ").trim();
                    if (
                      href.pathname === new URL(url).pathname &&
                      /^\?(?:get-)?page=\d+$/.test(href.search)
                    ) {
                      if (seen.has(href.href) || /page=1$/.test(href.search)) return;
                      if (seen.size >= 128) {
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
                      if (seen.size >= 128 || item.depth >= 6) {
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
                        depth: item.depth + 1,
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
      unavailable ||= batch.length > 0;
      const data = {
        quality: rootQuality,
        options: [...found.values()].sort((a, b) => b.resolution - a.resolution),
        unavailable,
      };
      if (data.options.length && !data.unavailable) {
        if (optionsCache.size >= 512) optionsCache.delete(optionsCache.keys().next().value);
        optionsCache.set(cacheKey, { data, expires: Date.now() + 120_000 });
      }
      return data;
    })();

    pendingOptions.set(cacheKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      pendingOptions.delete(cacheKey);
    }
  }

  async function resolveMedia(page, watch) {
    let current = safeURL(page);
    if (!current) return null;
    let source = Object.keys(origins).find(
      (key) => origins[key] === current.origin,
    );
    if (!source) {
      if (/isaidub/i.test(current.hostname)) source = "isaidub";
      else if (/moviezda|moviesda/i.test(current.hostname)) source = "moviezda";
    }
    if (source && origins[source] && origins[source] !== current.origin) {
      current = safeURL(current.pathname + current.search, origins[source]) || current;
    }
    if (!current || !itemPattern.test(current.pathname))
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
export const { catalogue, options, preview, resolveMedia } = createProviders(readHTML, { listingTtl: 15_000 });
