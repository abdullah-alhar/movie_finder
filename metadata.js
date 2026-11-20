import { readHTML } from "./providers.js";

import { mediaKind } from "./sources.js";

const readRemote = async (url, timeout) => (await readHTML(url, timeout)).html;

const TMDB = "https://api.themoviedb.org/3";
const WIKI = "https://en.wikipedia.org";
const publishers = new Set([
  "netflix",
  "prime video",
  "warner bros pictures",
  "divo music",
  "sony pictures entertainment",
  "universal pictures",
  "paramount pictures",
  "marvel entertainment",
  "disney",
  "20th century studios",
  "a24",
  "apple tv",
  "t series",
  "sun tv",
  "lyca productions",
  "sony music south",
]);
const numbering = [
  "one i",
  "two ii",
  "three iii",
  "four iv",
  "five v",
  "six vi",
  "seven vii",
  "eight viii",
  "nine ix",
  "ten x",
];
const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\b(part|chapter|volume) (\w+)/g, (phrase, prefix, n) => {
      const index = numbering.findIndex((pair) => pair.split(" ").includes(n));
      return index < 0 ? phrase : `${prefix} ${index + 1}`;
    });
const clean = (text) =>
  text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(
      /\b(480p|720p|1080p|2160p|4k|web[ .-]?dl|webrip|bluray|brrip|hdrip|x26[45]|hevc|hdtv|tamil|dubbed)\b/gi,
      " ",
    )
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .trim();

function similarity(a, b) {
  if (a === b) return 1;
  if (
    !a ||
    !b ||
    Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.78
  )
    return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(
          row[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
        ),
      );
    }
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function matchTitle({ title, year }, rows) {
  const wanted = normalize(clean(title));
  if (!wanted) return null;
  let highest = 0;
  let match = null;
  for (const row of rows) {
    const date = (row.release_date || row.first_air_date || "").slice(0, 4);
    const delta =
      year && /^\d{4}$/.test(date) ? Math.abs(Number(date) - year) : null;
    if (delta !== null && delta > 1) continue;
    const alike = Math.max(
      ...[row.title, row.original_title, row.name, row.original_name].map(
        (name) => similarity(wanted, normalize(name)),
      ),
    );
    const score = alike + (delta === 0 ? 0.18 : 0);
    if (alike >= 0.78 && score > highest) {
      highest = score;
      match = row;
    }
  }
  return match;
}
const image = (path, size = "w500") =>
  /^\/[\w.-]+$/.test(path ?? "")
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : null;
function movieCard(row) {
  return {
    title: row.title || row.name,
    year: (row.release_date || row.first_air_date || "").slice(0, 4),
    image: image(row.poster_path),
  };
}
function wikiMatch(title, year, pages, kind) {
  const media = kind === "tv" ? /\b(?:TV|television|web) series\b/i : /\bfilm\b/i;
  const matches = [];
  for (const page of pages) {
    const name = page.title || "";
    const suffix = /\s+\(([^()]*)\)$/.exec(name);
    if (suffix && !media.test(suffix[1])) continue;
    if (
      normalize(title) !==
      normalize(suffix ? name.slice(0, suffix.index) : name)
    )
      continue;
    if (!suffix && !media.test(page.description || "")) continue;
    const dates = `${suffix?.[1] || ""} ${page.description || ""}`.match(
      /\b(?:18|19|20)\d{2}\b/g,
    );
    if (
      dates
        ? dates.some((date) => date !== String(year))
        : !new RegExp(
            `\\b(?:is|was) (?:an? )?${year}\\b[^.!?]{0,100}\\bfilm\\b|\\b(?:release[ds]?|premiere[ds]?)\\b[^!?\\n]{0,95}\\b${year}\\b`,
            "i",
          ).test(page.extract || "")
    )
      continue;
    let picture;
    try {
      picture = new URL(page.thumbnail?.source);
    } catch {
      continue;
    }
    if (
      !["https://upload.wikimedia.org", "https://thumb.wikimedia.org"].includes(
        picture.origin,
      ) ||
      picture.username ||
      picture.password ||
      !picture.pathname.startsWith("/wikipedia/")
    )
      continue;
    matches.push({
      image: picture.origin + picture.pathname,
      article: WIKI + "/wiki/" + encodeURIComponent(name.replaceAll(" ", "_")),
      source: "Wikipedia",
    });
  }
  return matches.length === 1 ? matches[0] : null;
}
function youtubeId(html, title, year) {
  const assignment = /\bvar ytInitialData\s*=\s*/.exec(html);
  if (!assignment) return null;
  const end = html.indexOf("</script>", assignment.index);
  if (end === -1) return null;
  const data = JSON.parse(
    html
      .slice(assignment.index + assignment[0].length, end)
      .trim()
      .replace(/;$/, ""),
  );
  const text = (field) =>
    field?.simpleText || (field?.runs || []).map((part) => part.text).join("");
  const pending = [data];
  const name = normalize(title);
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    const video = item.videoRenderer;
    if (video) {
      const heading = normalize(text(video.title));
      const dates = heading.match(/\b(?:19|20)\d{2}\b/g) || [];
      if (
        /^[\w-]{11}$/.test(video.videoId || "") &&
        publishers.has(normalize(text(video.ownerText))) &&
        heading.startsWith(name + " ") &&
        (" " + heading + " ").includes(" official trailer ") &&
        dates.every((date) => date === String(year))
      )
        return video.videoId;
    } else {
      for (const value of Object.values(item).reverse()) pending.push(value);
    }
  }
  return null;
}

export function createMetadata({ read = readRemote, env = process.env } = {}) {
  const pending = new Map();
  function share(key, run) {
    if (!pending.has(key))
      pending.set(
        key,
        Promise.resolve()
          .then(run)
          .finally(() => pending.delete(key)),
      );
    return pending.get(key);
  }
  const configured = (key) => key?.trim() && !key.trim().startsWith("[");
  const apiUrl = (path, params) => path + "?" + new URLSearchParams(params);
  const json = async (url, timeout) => JSON.parse(await read(url, timeout));
  const tmdb = (path, params = {}) =>
    json(apiUrl(TMDB + path, { ...params, api_key: env.TMDB_API_KEY }), 6000);
  function lookup(movie) {
    if (!configured(env.TMDB_API_KEY)) return null;
    const { title, year } = movie;
    const kind = mediaKind(movie);
    return share(JSON.stringify(["lookup", title, year, kind]), async () => {
      for (const query of new Set([title, clean(title)])) {
        const found = await tmdb("/search/" + kind, {
          query,
          include_adult: "false",
        });
        const match = matchTitle(movie, found.results || []);
        if (!Number.isSafeInteger(match?.id)) continue;
        const path = "/" + kind + "/" + match.id;
        const info = await tmdb(path, {
          append_to_response: "credits,recommendations",
        });
        return {
          source: "TMDB",
          article: "https://www.themoviedb.org" + path,
          image: image(info.poster_path),
          backdrop: image(info.backdrop_path, "w1280"),
          overview: info.overview || "",
          runtime: info.runtime || info.episode_run_time?.[0] || null,
          rating: info.vote_count ? info.vote_average : null,
          genres: (info.genres || []).map((genre) => genre.name),
          cast: (info.credits?.cast || []).slice(0, 8).map((p) => p.name),
          recommendations: (info.recommendations?.results || [])
            .slice(0, 10)
            .map(movieCard),
        };
      }
      return null;
    });
  }
  async function discovery() {
    if (!configured(env.TMDB_API_KEY)) return {};
    const groups = [
      ["Trending this week", "/trending/movie/week"],
      ["Top rated", "/movie/top_rated"],
      ["Action", "/discover/movie", { with_genres: 28 }],
      ["Comedy", "/discover/movie", { with_genres: 35 }],
      ["Horror", "/discover/movie", { with_genres: 27 }],
    ];
    const results = await Promise.allSettled(
      groups.map(([label, path, params]) =>
        share("discovery:" + label, async () => {
          const { results } = await tmdb(path, params);
          return [
            label,
            (results || [])
              .slice(0, 10)
              .map((row) => ({ ...movieCard(row), rating: row.vote_average })),
          ];
        }),
      ),
    );
    return Object.fromEntries(
      results
        .filter((group) => group.status === "fulfilled")
        .map((group) => group.value),
    );
  }
  function rating(movie) {
    if (!configured(env.OMDB_API_KEY)) return null;
    const type = mediaKind(movie) === "tv" ? "series" : "movie";
    return share(
      JSON.stringify(["rating", movie.title, movie.year, type]),
      async () => {
        const data = await json(
          apiUrl("https://www.omdbapi.com/", {
            apikey: env.OMDB_API_KEY,
            t: clean(movie.title),
            y: movie.year || "",
            type,
            plot: "short",
          }),
          6000,
        );
        if (data.Response === "False") {
          if (/key|limit/i.test(data.Error || ""))
            throw new Error("Rating provider unavailable");
          return null;
        }
        if (
          !matchTitle(movie, [{ title: data.Title, release_date: data.Year }])
        )
          return null;
        const score = Number(data.imdbRating);
        const voteText = String(data.imdbVotes || "").replaceAll(",", "");
        const votes = Number(voteText);
        if (
          !/^\d+(\.\d+)?$/.test(data.imdbRating || "") ||
          score > 10 ||
          !/^\d+$/.test(voteText) ||
          !Number.isSafeInteger(votes) ||
          votes < 1 ||
          !/^tt\d+$/.test(data.imdbID || "")
        )
          return null;
        return { score, votes, id: data.imdbID };
      },
    );
  }
  async function imdbPoster(title, year, kind) {
    const term = normalize(title);
    const base = term.replace(/ encore$/, "");
    if (!term) return null;
    const url = "https://v3.sg.media-imdb.com/suggestion/" +
      encodeURIComponent(base[0]) + "/" + encodeURIComponent(base) + ".json";
    const data = await json(url, 4500);
    const candidates = (data.d || []).filter((row) =>
      /^tt\d+$/.test(row.id) && normalize(row.l) === base &&
      (kind === "tv" ? ["tvSeries", "tvMiniSeries"] : ["movie", "tvMovie", "video", "short"]).includes(row.qid) &&
      /^https:\/\/m\.media-amazon\.com\/images\/M\/[^?#]+\.jpg$/i.test(row.i?.imageUrl));
    const best = candidates.find((row) => row.y === year) ||
      candidates.find((row) => Math.abs(row.y - year) === 1) ||
      ((kind === "tv" || term !== base) && candidates.length === 1 && candidates[0].y <= year && candidates[0]);
    if (!best) return null;
    return { source: "IMDb", article: "https://www.imdb.com/title/" + best.id + "/",
      image: best.i.imageUrl.replace(/(?:\._V1_[^/]*)?\.jpg$/i, "._V1_QL80_UX360_.jpg") };
  }
  async function artwork(title, year, kind = "movie") {
    try {
      const info = await lookup({ title, year, kind });
      if (info?.image) return info;
    } catch {
      /* Fall back to attributed artwork. */
    }
    if (!/^\d{4}$/.test(String(year))) return null;
    const key = normalize(title) + ":" + year;
    return share("wiki:" + kind + ":" + key, async () => {
      try {
        const poster = await imdbPoster(title, Number(year), kind);
        if (poster) return poster;
      } catch { /* Continue to Wikimedia. */ }
      const name = title.replaceAll("|", " ");
      const type = kind === "tv" ? "TV series" : "film";
      const queries = [
        {
          titles: `${name} (${year} ${type})|${name} (${type})|${name}`,
          redirects: 1,
        },
        { generator: "search", gsrsearch: `${name} ${year} ${type}`, gsrlimit: 6 },
      ];
      for (const query of queries) {
        const data = await json(
          apiUrl(WIKI + "/w/api.php", {
            action: "query",
            format: "json",
            formatversion: 2,
            prop: "pageimages|description|extracts",
            piprop: "thumbnail",
            pithumbsize: 420,
            pilicense: "any",
            pilimit: 6,
            exintro: 1,
            explaintext: 1,
            exlimit: 6,
            exchars: 950,
            ...query,
          }),
          3500,
        );
        const art = wikiMatch(title, year, data.query?.pages || [], kind);
        if (art) return art;
      }
      return null;
    });
  }
  async function trailer({ title, year }) {
    const key = normalize(title) + ":" + year;
    try {
      return await share("trailer:" + key, async () => {
        const html = await read(
          apiUrl("https://www.youtube.com/results", {
            search_query: `${title} ${year} official trailer`,
          }),
          5000,
        );
        return youtubeId(html, title, year);
      });
    } catch {
      return null;
    }
  }
  return { lookup, discovery, artwork, rating, trailer };
}
export const { lookup, discovery, artwork, rating, trailer } = createMetadata();
