try { process.loadEnvFile?.(); } catch {}
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { catalogue, options, preview, resolveMedia } from "./providers.js";
import { lookup, discovery, rating, trailer, artwork, seasonDetails } from "./metadata.js";
import { movieFrom, sign, unpack } from "./links.js";
import { approved, updateOrigins, origins, posterUrl, mediaKind } from "./sources.js";
import adminRouter from "./admin.js";
import { configEpoch, loadConfig } from './admin-store.js';
const publicDir = fileURLToPath(new URL("public/", import.meta.url));
const notFoundPage = fileURLToPath(new URL("public/404.html", import.meta.url));
const guidePath = "/moviesda-isaidub-alternatives";
const guideTemplate = readFileSync(new URL("./views/viewing-guide.html", import.meta.url), "utf8");

function siteOrigin(value) {
  if (!value || !/^https:\/\/[a-z0-9.-]+\/?$/i.test(value)) return null;
  return URL.parse(value)?.origin ?? null;
}

const trusted = new Set(
  [
    ...(process.env.TRUSTED_HOSTS || "localhost,127.0.0.1,[::1]").split(","),
    process.env.RENDER_EXTERNAL_HOSTNAME,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .filter(Boolean)
    .map((host) => host.trim().toLowerCase()),
);
const asText = (value) =>
  typeof value === "string" ? value.trim().slice(0, 120) : "";
const number = (value, max) =>
  Math.min(max, Math.max(1, parseInt(value, 10) || 1));
function card(movie) {
  const { title, year, provider } = movie;
  const kind = mediaKind(movie);
  const payload = [movie.url, title, year, kind];
  const entries = movie.seriesEntries?.map(entry =>
    Array.isArray(entry) ? entry : [entry.url, entry.year, entry.seasons]);
  const grouped = entries?.length > 1 ? sign("movie-details", [...payload, entries]) : null;
  return {
    title,
    year,
    provider,
    quality: movie.quality || null,
    kind,
    ...(grouped && grouped.length <= 4096 && {
      seasons: entries.flatMap(([, releaseYear, numbers]) => numbers.map(number => ({ number, year: releaseYear })))
        .sort((a, b) => a.number - b.number),
    }),
    poster: posterUrl(movie),
    url: provider === "Custom" ? movie.url :
      "/movie/" +
      (grouped && grouped.length <= 4096 ? grouped : sign("movie-details", payload)),
  };
}
export function createApp(
  services = {
    catalogue,
    options,
    preview,
    resolveMedia,
    lookup,
    discovery,
    rating,
    trailer,
    artwork,
    seasonDetails,
  },
) {
  const app = express();
  app.disable("x-powered-by");
  const origin = siteOrigin(process.env.SITE_URL || (
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  ));
  const canonical = origin && `${origin}${guidePath}`;
  const canonicalHost = origin && new URL(origin).hostname;
  const guide = guideTemplate.replace("<!-- canonical -->", canonical
    ? `<link rel="canonical" href="${canonical}" />`
    : "");
  const visits = new Map();
  let activeLookups = 0;
  let configAttempt, configFreshUntil = 0, lastConfigEpoch = -1;
  function ensureOrigins() {
    const epoch = configEpoch();
    if (!process.env.EXPRESS_DATABASE_URL ||
        (epoch === lastConfigEpoch && Date.now() < configFreshUntil)) return;
    if (!configAttempt) {
      lastConfigEpoch = epoch;
      configAttempt = loadConfig().then(config => {
        updateOrigins(config);
        configFreshUntil = Date.now() + 30_000;
      }).catch(err => {
        configFreshUntil = Date.now() + 5_000;
        console.warn("[origins] Delayed init error:", err.message);
      }).finally(() => { configAttempt = undefined; });
    }
    return configAttempt;
  }

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cache-Control": "no-store",
    });
    if (process.env.NODE_ENV === "production")
      res.set("Strict-Transport-Security", "max-age=31536000");
    const host = (req.hostname || "").toLowerCase();
    if (!trusted.has(host) && host !== canonicalHost && !host.endsWith(".vercel.app"))
      return res.sendStatus(400);
    if (req.originalUrl.length > 6144) return res.sendStatus(414);
    next();
  });
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  const sendNotFound = (req, res) => {
    res.status(404).set("X-Robots-Tag", "noindex");
    if (/^\/(?:admin\/)?api(?:\/|$)/i.test(req.path)) {
      return res.json({ error: "Not found" });
    }
    return res.type("html").sendFile(notFoundPage);
  };
  app.get("/404.html", sendNotFound);
  app.get(guidePath, (req, res) => {
    if (req.path !== guidePath) return res.redirect(301, guidePath);
    res.type("html").send(guide);
  });
  app.get("/robots.txt", (req, res) => {
    const sitemap = origin ? `\nSitemap: ${origin}/sitemap.xml\n` : "";
    res.type("text/plain").send(`User-agent: *\nDisallow:\n${sitemap}`);
  });
  app.get("/sitemap.xml", (req, res) => {
    if (!canonical) return sendNotFound(req, res);
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${canonical}</loc></url>\n</urlset>\n`,
    );
  });
  app.use(
    express.static(publicDir, {
      index: false,
      dotfiles: "deny",
      setHeaders: (res, path) => {
        if (!path.endsWith(".html")) res.setHeader("Cache-Control", "public, max-age=60");
      },
    }),
  );
  app.use((req, res, next) => {
    const now = Date.now(),
      key = req.socket.remoteAddress;
    let visit = visits.get(key);
    if (!visit || visit.until <= now) {
      if (visits.size >= 4096) visits.delete(visits.keys().next().value);
      visit = { count: 0, until: now + 60000 };
      visits.set(key, visit);
    }
    if (++visit.count > 180)
      return res
        .set("Retry-After", "60")
        .status(429)
        .json({ error: "Please try again in a minute." });
    const costly =
      req.path === "/api/catalogue" ||
      req.path === "/api/suggestions" ||
      req.path.startsWith("/watch/") ||
      req.path.startsWith("/download/") ||
      req.path.endsWith("/options");
    if (costly) {
      if (activeLookups >= 8)
        return res
          .set("Retry-After", "3")
          .status(503)
          .json({ error: "The catalogues are busy. Try again shortly." });
      activeLookups++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          activeLookups--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
    }
    next();
  });
  // Assets, health checks and plain browse shells don't need a database
  // round trip when a Vercel instance starts.
  app.use(async (req, res, next) => {
    if (/^\/(?:api\/(?:catalogue|suggestions)(?:\/|$)|(?:movie|trailer|watch|download)\/|admin\/dashboard(?:\/|$))/i.test(req.path))
      await ensureOrigins();
    next();
  });
  // Admin routes (before static/shell so /admin/* isn't caught by static)
  app.use("/admin", adminRouter);

  const shell = (req, res) =>
    res.sendFile(fileURLToPath(new URL("public/index.html", import.meta.url)));
  app.get(["/", "/movies", "/series", "/search"], shell);
  app.param("token", (req, res, next, token) => {
    try {
      req.movie = movieFrom(token);
    } catch {
      if (!/^\/movie\/[^/]+(?:\/(?:watch|downloads))?\/?$/i.test(req.path)) {
        return res.status(404).set("X-Robots-Tag", "noindex").json({ error: "Title not found" });
      }
      return sendNotFound(req, res);
    }
    next();
  });
  app.get(
    ["/movie/:token", "/movie/:token/watch", "/movie/:token/downloads"],
    shell,
  );
  app.get(["/api/catalogue", "/api/suggestions"], async (req, res) => {
    const q = asText(req.query.q),
      suggest = req.path.endsWith("suggestions");
    const params = {
      q,
      category: req.query.category === "series" ? "series" : "",
      suggest,
      source: Object.hasOwn(origins, req.query.source) ? req.query.source : "",
      page: number(req.query.page, 500),
      scan: number(req.query.scan, 42),
      sort: req.query.sort === "title" ? "title" : "latest",
    };
    if (suggest && q.length < 2)
      return res.json({ items: [], available: true });
    let data;
    try {
      data = await services.catalogue(params);
    } catch {
      data = { items: [], unavailable: true };
    }
    if (params.sort === "title")
      data.items.sort((a, b) => a.title.localeCompare(b.title));
    
    // Include approved curated links from PostgreSQL.
    if (!params.source && !params.category) {
      const customLinks = process.env.EXPRESS_DATABASE_URL
        ? await loadConfig({ cachedOnly: true }).then(config => config.customLinks ?? [])
        : [];
      const filteredCustom = customLinks.filter(l => approved(l.url) && (!q || l.label.toLowerCase().includes(q.toLowerCase())));
      const customItems = filteredCustom.map(l => ({
        title: l.label,
        year: new Date().getFullYear(),
        provider: "Custom",
        quality: l.notes || "HD",
        url: l.url,
        kind: "movie",
      }));
      data.items = [...customItems, ...data.items];
    }

    if (q && !suggest) {
      data.total = data.items.length;
      data.pages = Math.ceil(data.total / 24);
      data.items = data.items.slice((params.page - 1) * 24, params.page * 24);
      data.more = data.more && params.scan < 42;
    }
    res.json({
      ...data,
      items: (suggest ? data.items.slice(0, 6) : data.items).map(card),
      available: !data.unavailable,
    });
  });
  app.get(["/api/discovery", "/api/discover"], async (req, res) =>
    res.json(await services.discovery()),
  );
  app.get("/movie/:token/info", (req, res) =>
    res.json({
      ...card(req.movie),
      url: "/movie/" + req.params.token,
      sourceUrl: req.movie.url,
    }),
  );
  app.get("/movie/:token/preview", async (req, res) =>
    res.json(await services.preview(req.movie)),
  );
  app.get("/movie/:token/metadata", async (req, res) =>
    res.json((await services.lookup(req.movie)) || {}),
  );
  app.get("/movie/:token/season/:num", async (req, res) => {
    const seasonNum = parseInt(req.params.num, 10) || 1;
    res.json((await services.seasonDetails(req.movie, seasonNum)) || {});
  });
  app.get("/movie/:token/rating", async (req, res) =>
    res.json({ rating: await services.rating(req.movie) }),
  );
  app.get(["/movie/:token/trailer", "/trailer/:token"], async (req, res) =>
    res.json({ video: await services.trailer(req.movie) }),
  );
  app.get("/poster-artwork", async (req, res) => {
    const title = asText(req.query.title),
      year = Number(req.query.year) || null;
    if (
      !title ||
      (year && (!Number.isInteger(year) || year < 1888 || year > 2099))
    )
      return res.sendStatus(400);
    const result = await services.artwork(
      title,
      year,
      req.query.kind === "tv" ? "tv" : "movie",
    );
    if (!result) return res.sendStatus(404);
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.json(result);
  });
  app.get("/movie/:token/options", async (req, res) => {
    const movie = req.movie;
    const grouped = movie.seriesEntries.length > 1;
    const entries = grouped ? movie.seriesEntries : [movie];
    const results = await Promise.all(entries.map(async (entry) => {
      const member = { ...movie, ...entry };
      const token = grouped
        ? sign("movie-details", [member.url, member.title, member.year, member.kind])
        : req.params.token;
      try {
        const result = await services.options(member);
        return {
          ...result,
          options: result.options.map(option => ({
            ...option,
            season: option.season ?? (entry.seasons?.length === 1 ? entry.seasons[0] : null),
            token,
          })),
        };
      } catch {
        return { options: [], unavailable: true };
      }
    }));
    const unique = new Map();
    for (const result of results) {
      for (const option of result.options) {
        const key = JSON.stringify([option.season, option.episode, option.resolution, option.page]);
        if (!unique.has(key)) unique.set(key, option);
      }
    }
    res.json({
      quality: results.find(result => result.quality)?.quality,
      unavailable: results.some(result => result.unavailable),
      options: [...unique.values()].map(({ page, token, ...option }) => {
        const id = sign("movie-download", [page, token]);
        return {
          ...option,
          watch: "/watch/" + id,
          download: "/download/" + id,
        };
      }),
    });
  });
  app.get(["/watch/:id", "/download/:id"], async (req, res) => {
    let page, movieToken, movie;
    try {
      [page, movieToken] = unpack("movie-download", req.params.id);
      movie = movieFrom(movieToken);
      const pageUrl = new URL(page);
      const movieUrl = new URL(movie.url);
      if (pageUrl.origin !== movieUrl.origin) {
        if (
          // Allow mirror domains for the same source family (admin may have changed the URL)
          Object.entries(origins).some(([k, o]) => {
            if (k !== movie.source) return false;
            return new URL(o).hostname === pageUrl.hostname;
          })
        ) {
          page = new URL(pageUrl.pathname + pageUrl.search, movieUrl.origin).href;
        } else {
          throw new Error("Invalid origin");
        }
      }
    } catch {
      return sendNotFound(req, res);
    }
    const target = await services.resolveMedia(
      page,
      req.path.startsWith("/watch/"),
    );
    if (!target || new URL(target).protocol !== "https:")
      return res
        .status(502)
        .type("html")
        .send(
          '<p>This version is currently unavailable.</p><a href="/movie/' +
            encodeURIComponent(movieToken) +
            '">Return to movie</a>',
        );
    res.redirect(target);
  });
  app.use(sendNotFound);
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status === 400 ? 400 : 503).json({
      error: "This information is temporarily unavailable. Please try again.",
    });
  });
  return app;
}
const app = createApp();
export default app;

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 5050);
  const host =
    process.env.HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  if (!process.env.EXPRESS_DATABASE_URL && process.env.NODE_ENV === "production") {
    throw new Error("EXPRESS_DATABASE_URL is required in production");
  } else if (!process.env.EXPRESS_DATABASE_URL) {
    console.warn("[startup] EXPRESS_DATABASE_URL not set — admin dashboard requires it.");
  }
  app.listen(port, host, () =>
    console.log(`AfterShow is listening on http://${host}:${port}`),
  );
}
