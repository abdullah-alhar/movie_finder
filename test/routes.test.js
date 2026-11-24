import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.MOVIE_SECRET = "offline-test-secret";
const { createApp } = await import("../server.js");
const fixture = {
  title: "Dune",
  year: 2021,
  provider: "Isaidub",
  url: "https://isaidub.green/movie/dune-2021-tamil-dubbed-movie/",
};
const page = "https://isaidub.green/download/page/1/";
const services = {
  catalogue: async () => ({
    items: [fixture],
    unavailable: false,
    more: false,
  }),
  options: async () => ({
    options: [{ page, label: "1080p" }],
    unavailable: false,
  }),
  resolveMedia: async (value, watch) =>
    value === page
      ? "https://example.org/" + (watch ? "movie.mp4" : "download")
      : null,
  lookup: async () => ({ title: "Dune" }),
  discovery: async () => ({ Trending: [] }),
  rating: async () => null,
  trailer: async () => "rPqTIibDpq4",
  artwork: async () => null,
};
test("robots and sitemap expose only the public pages", async (t) => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://aftershow.example/";
  const app = createApp(services);
  if (previous === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previous;

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  const base = "http://127.0.0.1:" + server.address().port;

  const robots = await fetch(base + "/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  assert.match(await robots.text(), /^User-agent: \*\nDisallow:\n\nSitemap: https:\/\/aftershow\.example\/sitemap\.xml\n$/);

  const sitemap = await fetch(base + "/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /^application\/xml/);
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  assert.deepEqual(urls, [
    "https://aftershow.example/",
    "https://aftershow.example/movies",
    "https://aftershow.example/series",
  ]);

  const removed = await fetch(base + "/moviesda-isaidub-alternatives");
  assert.equal(removed.status, 404);
  assert.equal(removed.headers.get("x-robots-tag"), "noindex");
});

test("web analytics loads only on production public pages", async (t) => {
  const saved = { env: process.env.VERCEL_ENV, path: process.env.ANALYTICS_SCRIPT_PATH };
  process.env.VERCEL_ENV = "production";
  process.env.ANALYTICS_SCRIPT_PATH = "/aftershow-insights/script.js";
  const app = createApp(services);
  process.env.VERCEL_ENV = "preview";
  delete process.env.ANALYTICS_SCRIPT_PATH;
  const local = createApp(services);
  for (const [key, value] of Object.entries(saved)) {
    const name = key === "env" ? "VERCEL_ENV" : "ANALYTICS_SCRIPT_PATH";
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  const server = app.listen(0, "127.0.0.1");
  const dev = local.listen(0, "127.0.0.1");
  await Promise.all([once(server, "listening"), once(dev, "listening")]);
  t.after(() => Promise.all([
    new Promise((done) => server.close(done)),
    new Promise((done) => dev.close(done)),
  ]));
  const base = "http://127.0.0.1:" + server.address().port;
  const devBase = "http://127.0.0.1:" + dev.address().port;

  for (const path of ["/", "/movies", "/series"]) {
    const html = await (await fetch(base + path)).text();
    assert.ok(html.includes('<script defer src="/analytics.js"></script>'), path);
    assert.ok(html.includes('<script defer src="/aftershow-insights/script.js"></script>'), path);
    assert.ok(!html.includes("<!-- web analytics -->"), path);
  }
  const notFound = await (await fetch(base + "/missing")).text();
  assert.ok(!notFound.includes("/analytics.js"));
  const devHtml = await (await fetch(devBase)).text();
  assert.ok(!devHtml.includes("/analytics.js"));

  const script = await fetch(base + "/analytics.js");
  assert.equal(script.status, 200);
  const code = await script.text();
  assert.ok(code.includes("beforeSend"));
  assert.ok(code.includes('"/movie/title"'));
});

test("missing pages render the branded 404 without changing API response types", async (t) => {
  const server = createApp(services).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  const base = "http://127.0.0.1:" + server.address().port;
  for (const path of ["/missing", "/movie/not-a-token", "/watch/not-a-token", "/404.html"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.match(await response.text(), /<h1 id="title">Page not found<\/h1>/);
  }
  for (const path of ["/api/missing", "/movie/not-a-token/info"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.match((await response.json()).error, /not found/i);
  }
});

test("grouped series keeps seasons, episode numbers, and playable qualities separate", async (t) => {
  const s2 = fixture.url.replace("dune-2021", "heart-beat-2025");
  const s3 = s2.replace("2025", "2026");
  const server = createApp({
    ...services,
    catalogue: async () => ({
      items: [{
        ...fixture, url: s3, title: "Heart Beat", year: 2026, kind: "tv",
        seriesEntries: [[s3, 2026, [3]], [s2, 2025, [2]]],
      }],
    }),
    options: async (movie) => ({
      options: (movie.year === 2025 ? [720] : [720, 1080]).map(resolution => ({
        page: new URL(`/download/heart-${movie.year}-${resolution}/`, movie.url).href,
        episode: 1, resolution,
      })),
    }),
    resolveMedia: async (url) => url.includes("heart-2025-720") ? "https://example.org/season-two.mp4" : null,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  const base = "http://127.0.0.1:" + server.address().port;
  const json = async (path) => (await fetch(base + path)).json();
  const { items: [series] } = await json("/api/catalogue?category=series");
  const seasons = [{ number: 2, year: 2025 }, { number: 3, year: 2026 }];
  assert.deepEqual(series.seasons, seasons);
  assert.deepEqual((await json(series.url + "/info")).seasons, seasons);
  const { options } = await json(series.url + "/options");
  assert.deepEqual(options.map(({ season, episode, resolution }) => [season, episode, resolution]), [
    [3, 1, 720], [3, 1, 1080], [2, 1, 720],
  ]);
  const playback = await fetch(base + options.at(-1).watch, { redirect: "manual" });
  assert.equal(playback.status, 302);
  assert.equal(playback.headers.get("location"), "https://example.org/season-two.mp4");
});

test("catalogue, bookmarks, playback and downloads use compatible signed links", async (t) => {
  const server = createApp(services).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  const base = "http://127.0.0.1:" + server.address().port;
  const get = (path) => fetch(base + path, { redirect: "manual" });
  const json = async (path) => (await get(path)).json();
  assert.equal((await json("/health")).status, "ok");
  const { items } = await json("/api/catalogue?q=dune");
  const detail = items[0].url;
  assert.equal((await json(detail + "/info")).sourceUrl, fixture.url);
  const { options } = await json(detail + "/options");
  for (const [key, path] of [
    ["watch", "movie.mp4"],
    ["download", "download"],
  ]) {
    const response = await get(options[0][key]);
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "https://example.org/" + path,
    );
  }
  const old =
    ".eJx1jDsOgCAMQO_SmVpldHbxDMYBQlUSQCPg-UVZXJzfZ4ItpSP2RDYqa7Ju1pM5kN8vy2RyYJSt7DApbx0WrtlghSBgKBzEI4ifT-3exTeOpV6UiyxgrD7MN-ZNLsE.oRzR3CMWImSQqMBCW2V54BWwcI4";
  assert.equal((await json("/movie/" + old + "/info")).title, "Dune");
  assert.equal((await get(detail + "invalid/info")).status, 404);
  assert.equal((await get("/poster-artwork")).status, 400);
  assert.equal((await json(detail + "/trailer")).video, "rPqTIibDpq4");
  assert.equal((await json("/api/catalogue?cached=1&q=Dune")).items[0].title, "Dune");
});
