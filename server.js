import express from "express";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { catalogue, options, preview, resolveMedia } from "./providers.js";
import { lookup, discovery, rating, trailer, artwork } from "./metadata.js";
import { movieFrom, sign, unpack } from "./links.js";
import { origins, posterUrl, mediaKind } from "./sources.js";

const publicDir = fileURLToPath(new URL("public/", import.meta.url));
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
  return {
    title,
    year,
    provider,
    quality: movie.quality || null,
    kind: mediaKind(movie),
    poster: posterUrl(movie),
    url:
      "/movie/" +
      sign("movie-details", [movie.url, title, year, mediaKind(movie)]),
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
  },
) {
  const app = express();
  app.disable("x-powered-by");
  const visits = new Map();
  let activeLookups = 0;
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cache-Control": "no-store",
    });
    if (process.env.NODE_ENV === "production")
      res.set("Strict-Transport-Security", "max-age=31536000");
    if (!trusted.has((req.hostname || "").toLowerCase()))
      return res.sendStatus(400);
    if (req.originalUrl.length > 6144) return res.sendStatus(414);
    next();
  });
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use(
    express.static(publicDir, { index: false, dotfiles: "deny", maxAge: "5m" }),
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
  const shell = (req, res) =>
    res.sendFile(fileURLToPath(new URL("public/index.html", import.meta.url)));
  app.get(["/", "/movies", "/series", "/search"], shell);
  app.param("token", (req, res, next, token) => {
    try {
      req.movie = movieFrom(token);
      next();
    } catch {
      res.status(404).send("This movie link is invalid.");
    }
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
    res.json(result);
  });
  app.get("/movie/:token/options", async (req, res) => {
    let result;
    try {
      result = await services.options(req.movie);
    } catch {
      result = { options: [], unavailable: true };
    }
    res.json({
      ...result,
      options: result.options.map(({ page, ...option }) => {
        const id = sign("movie-download", [page, req.params.token]);
        return {
          ...option,
          watch: "/watch/" + id,
          download: "/download/" + id,
        };
      }),
    });
  });
  app.get(["/watch/:id", "/download/:id"], async (req, res) => {
    let page, movieToken;
    try {
      [page, movieToken] = unpack("movie-download", req.params.id);
      const movie = movieFrom(movieToken);
      if (new URL(page).origin !== new URL(movie.url).origin) throw new Error();
    } catch {
      return res.sendStatus(404);
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
  app.use((req, res) =>
    res
      .status(404)
      .type("html")
      .send('<h1>Page not found</h1><a href="/">Browse movies</a>'),
  );
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
  app.listen(port, host, () =>
    console.log(`Afterframe is listening on http://${host}:${port}`),
  );
}
