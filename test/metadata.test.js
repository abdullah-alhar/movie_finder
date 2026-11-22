import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetadata } from "../metadata.js";

const dune = { title: "Dune 1080p", year: 2021 };
test("metadata searches the clean title, distinguishes remakes and shares concurrent requests", async () => {
  const calls = [];
  const service = createMetadata({
    env: { TMDB_API_KEY: "test" },
    read: async (request) => {
      const url = new URL(request);
      calls.push(url.pathname);
      if (url.pathname.includes("search")) {
        return JSON.stringify({
          results:
            url.searchParams.get("query") === "Dune"
              ? [
                  { id: 1, title: "Dune", release_date: "1984-12-14" },
                  { id: 2, title: "Dune", release_date: "2021-10-22" },
                ]
              : [],
        });
      }
      assert.equal(url.pathname, "/3/movie/2");
      return JSON.stringify({
        poster_path: "/dune.jpg",
        overview: "A desert planet.",
        vote_count: 2,
        vote_average: 8.1,
      });
    },
  });
  const [one, two] = await Promise.all([
    service.lookup(dune),
    service.lookup(dune),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.image, "https://image.tmdb.org/t/p/w780/dune.jpg");
  assert.equal(one.rating, 8.1);
  assert.deepEqual(calls, ["/3/search/movie", "/3/movie/2"]);
});

test("OMDb checks release and rating data", async () => {
  const data = {
    Title: "Dune",
    Year: "2021",
    imdbRating: "8.0",
    imdbVotes: "950,123",
    imdbID: "tt1160419",
  };
  const service = createMetadata({
    env: { OMDB_API_KEY: "test" },
    read: async () => JSON.stringify(data),
  });
  assert.deepEqual(await service.rating(dune), {
    id: "tt1160419",
    score: 8,
    votes: 950123,
    source: "IMDb",
  });
  assert.equal(await service.rating({ ...dune, year: 1984 }), null);
});
test("missing API keys skip discovery and metadata", async () => {
  const service = createMetadata({ env: {}, read: assert.fail });
  assert.deepEqual(await service.discovery(), {});
  assert.equal(await service.lookup(dune), null);
});

test("fallback artwork requires a matching title, release and Wikimedia image", async () => {
  const base = {
    title: "Example (2025 film)",
    thumbnail: {
      source: "https://upload.wikimedia.org/wikipedia/en/a/example.jpg",
    },
  };
  const json = JSON.stringify({
    query: {
      pages: [
        base,
        { ...base, title: "Example (1995 film)" },
        {
          ...base,
          thumbnail: { source: "https://example.com/wikipedia/fake.jpg" },
        },
      ],
    },
  });
  const data = await createMetadata({
    env: {},
    read: async () => json,
  }).artwork("Example", 2025);
  assert.equal(data.source, "Wikipedia");
  assert.equal(data.image, base.thumbnail.source);
});

test("trailer lookup rejects unofficial publishers even when the title matches", async () => {
  const movie = { title: "Example", year: 2021 };
  const video = (publisher) => ({
    videoRenderer: {
      title: { simpleText: "Example (2021) Official Trailer" },
      ownerText: { simpleText: publisher },
      videoId: publisher === "Netflix" ? "abcdefghijk" : "ABCDEFGHIJK",
    },
  });
  const html =
    "<script>var ytInitialData = " +
    JSON.stringify({ results: [video("Viewer"), video("Netflix")] }) +
    ";</script>";
  assert.equal(
    await createMetadata({ env: {}, read: async () => html }).trailer(movie),
    "abcdefghijk",
  );
});
