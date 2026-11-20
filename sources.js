import { isIP } from "node:net";

export const names = { isaidub: "Isaidub", moviezda: "Moviezda" };
export const origins = {};
for (const [key, domain] of Object.entries({
  isaidub: "isaidub.green",
  moviezda: "moviezda.co",
})) {
  const url = new URL(
    process.env[key.toUpperCase() + "_URL"] || "https://" + domain,
  );
  if (
    url.protocol !== "https:" ||
    url.host !== url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    isIP(url.hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      url.hostname,
    )
  ) {
    throw new Error("Invalid source domain for " + key);
  }
  origins[key] = url.origin;
}

export function mediaKind(movie) {
  const marker =
    /(?:^|[ /(-])(?:series|season[ -]*\d+|s\d{1,2}(?:e\d+)?)(?=$|[ /)-])/i;
  return movie.kind === "tv" ||
    marker.test(movie.url) ||
    marker.test(movie.title)
    ? "tv"
    : "movie";
}

export function posterUrl(movie) {
  if (movie.poster) return movie.poster;
  const url = new URL(movie.url);
  if (url.origin === origins.isaidub) return null;
  const slug = url.pathname.split("/").filter(Boolean).at(-1) || "";
  const name = slug.match(
    /^([a-z0-9-]+-\d{4})(?:-tamil(?:-dubbed)?)?-(?:movie|(?:web-?)?series)(?:-\d+|-moviesda)?$/i,
  )?.[1];
  if (!name) return null;
  const filename = name.replace(
    "spiderman-no-way-home-2021",
    "spider-man-no-way-home-2021",
  );
  return new URL("/uploads/posters/" + filename + ".jpg", url).href;
}
