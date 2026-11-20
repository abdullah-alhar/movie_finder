import test from "node:test";
import assert from "node:assert/strict";
import { createProviders, readHTML } from "../providers.js";

const site = "https://isaidub.green";
const film = site + "/movie/dune-2021-tamil-dubbed-movie/";
const download = site + "/download/page/123/";
function fixture(pages) {
  const calls = [];
  const services = createProviders(async (url) => {
    calls.push(url);
    assert.ok(Object.hasOwn(pages, url), "Unexpected source " + url);
    return { html: pages[url], url };
  });
  return { ...services, calls };
}

test("search refreshes listing requests and handles typos, aliases and years", async () => {
  const listing = site + "/tamil-atoz-dubbed-movies/d";
  const service = fixture({
    [listing]:
      '<a href="/movie/dune-2021-tamil-dubbed-movie/">Dune (2021)</a><a href="/movie/dune-2-movie/">Dune Part Two (2024)</a>',
  });
  const search = (q) => service.catalogue({ q, source: "isaidub" });
  for (const q of ["Dune Part One", "Dune Part I", "Duen 2021", "Dune 2021"]) {
    assert.equal((await search(q)).items[0]?.url, film);
  }
  assert.deepEqual(
    (await search("Dune 2")).items.map((x) => x.year),
    [2024],
  );
  assert.equal(service.calls.filter((url) => url === listing).length, 5);
});

test("search continuation fetches only the next window", async () => {
  const listing = site + "/tamil-atoz-dubbed-movies/d";
  function body(n) {
    return (
      '<span id="currentPage">' +
      n +
      '</span><span id="totalPages">14</span><a href="/movie/dune-movie/">Dune (2021)</a>'
    );
  }
  const service = fixture({
    [site + "/tamil-dubbed-web-series/"]: body(1).replace(">14<", ">1<"),
    [listing]: body(1),
    [listing + "/13"]: body(13),
    [listing + "/14"]: body(14),
  });
  const result = await service.catalogue({
    q: "Dune",
    source: "isaidub",
    scan: 2,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.more, false);
  assert.equal(result.unavailable, false);
  assert.deepEqual(
    service.calls.filter((url) => url.startsWith(listing)),
    [listing, listing + "/13", listing + "/14"],
  );
});

test("episodes retain parent season, quality, and file-specific size", async () => {
  const seasonFolder = site + "/movie/123/",
    qualityFolder = site + "/movie/456/";
  const service = fixture({
    [film]: '<a href="/movie/123/">Season 02</a>',
    [seasonFolder]: '<a href="/movie/456/">720p Original</a>',
    [qualityFolder]:
      '<ul><li><a href="/download/page/123/">Episode 06</a></li><li>File Size: 333.97 MB</li></ul><a href="/download/sample/">Sample</a>',
  });
  const { options, unavailable } = await service.options({ url: film });
  assert.equal(unavailable, false);
  assert.deepEqual(
    options.map(({ label, season, episode, size, page }) => [
      label,
      season,
      episode,
      size,
      page,
    ]),
    [["720p", 2, 6, "333.97 MB", download]],
  );
});

test("file downloads and video sources follow separate verified handoffs", async () => {
  const handoff = "https://dubpage.xyz/download/view/123";
  const player = "https://play.onestream.today/stream/page/123";
  const file = "https://download.isaidub.dad/download.php?url=fixture";
  const video = "https://cdn.uptodub.ch/open.php?dl=fixture";
  const service = fixture({
    [download]: '<a href="' + handoff + '">Download</a>',
    [handoff]:
      '<a href="' +
      file +
      '">Download</a><a href="' +
      player +
      '">Watch Online</a>',
    [player]:
      '<video><source src="https://example.org/file" type="video/mp4"><source src="' +
      video +
      '"></video>',
  });
  assert.equal(await service.resolveMedia(download, false), file);
  assert.equal(await service.resolveMedia(download, true), video);
  assert.equal(
    await service.resolveMedia("https://example.org/download/page/123", false),
    null,
  );
});

test("outbound requests require a DNS hostname and clean HTTPS origin", async () => {
  for (const invalid of [
    "data:text/plain,demo",
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user@example.com",
  ]) {
    await assert.rejects(readHTML(invalid), /Invalid URL/);
  }
});

test("live series listings, posters and later episode pages stay reachable", async () => {
  const origin = "https://moviezda.co";
  const directory = origin + "/tamil-web-series-download/";
  const path = "/the-court-2026-tamil-web-series/";
  const season = "/the-court-season-01-web-series/";
  const hd = "/the-court-season-01-720p-web-series/";
  const listing = '<a href="' + path + '">The Court (2026)</a>';
  const page = (n) =>
    '<span id="currentPage">' + n + '</span><span id="totalPages">2</span>';
  const responses = {
    [directory]:
      page(1) + '<a href="/another-2025-tamil-movie/">Another (2025)</a>',
    [directory + "?get-page=2"]: page(2) + listing,
    [origin + path]:
      '<strong>Quality:</strong><span>Original HD</span><a href="' +
      season +
      '">Season 01</a>',
    [origin + season]: '<a href="' + hd + '">Season 01 (720p HD)</a>',
    [origin + hd]:
      '<a href="/download/first/">Episode 01</a><a href="?page=2">2</a>',
    [origin + hd + "?page=2"]: '<a href="/download/second/">Episode 02</a>',
  };
  const service = fixture(responses);
  const params = { source: "moviezda", category: "series" };
  assert.equal((await service.catalogue(params)).items[0].kind, "tv");
  const [item] = (await service.catalogue({ ...params, q: "The Court" })).items;
  assert.equal(item.poster, origin + "/uploads/posters/the-court-2026.jpg");
  const info = await service.preview(item);
  assert.equal(info.quality, "Original HD");
  responses[origin + path] = responses[origin + path].replace(
    "Original HD",
    "PreDVD",
  );
  assert.equal((await service.preview(item)).quality, "PreDVD");
  const versions = await service.options(item);
  assert.equal(versions.unavailable, false);
  assert.deepEqual(
    versions.options.map((o) => o.episode),
    [1, 2],
  );
});
