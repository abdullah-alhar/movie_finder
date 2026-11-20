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
