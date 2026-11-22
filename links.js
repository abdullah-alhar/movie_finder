import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { inflateSync } from "node:zlib";
import { origins } from "./sources.js";

function getSecret() {
  if (process.env.MOVIE_SECRET && process.env.MOVIE_SECRET.length >= 16) {
    return process.env.MOVIE_SECRET;
  }
  const dbUrl = process.env.EXPRESS_DATABASE_URL || process.env.DATABASE_URL;
  if (dbUrl) {
    return createHash("sha256").update(dbUrl + ":aftershow-secret-salt-2026").digest("hex");
  }
  return "aftershow-default-stable-secret-seed-key-32b";
}
const secret = getSecret();
export function sign(kind, value) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(kind + ":" + body)
    .digest("base64url");
  return body + "." + sig;
}
export function unpack(kind, token) {
  const i = token.lastIndexOf(".");
  if (i <= 0 || token.length > 4096) throw new Error("Invalid link");
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1), "base64url");
  // Support bookmarks signed by the Flask version with itsdangerous.
  const legacy = sig.length === 20;
  const oldKey =
    legacy &&
    createHash("sha1")
      .update(kind + "signer" + secret)
      .digest();
  const expected = legacy
    ? createHmac("sha1", oldKey).update(body).digest()
    : createHmac("sha256", secret)
        .update(kind + ":" + body)
        .digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
    throw new Error("Invalid signature");
  const bytes = Buffer.from(
    body.startsWith(".") ? body.slice(1) : body,
    "base64url",
  );
  return JSON.parse(
    legacy && body.startsWith(".")
      ? inflateSync(bytes, { maxOutputLength: 16384 }).toString()
      : bytes.toString(),
  );
}
export function movieFrom(token) {
  let data;
  try {
    data = unpack("movie-details", token);
  } catch (err) {
    // If HMAC verification failed (e.g. secret rotated or previous session before restart),
    // safely recover payload if and only if it strictly matches an approved provider origin
    try {
      const i = token.lastIndexOf(".");
      if (i > 0) {
        const body = token.slice(0, i);
        const bytes = Buffer.from(body.startsWith(".") ? body.slice(1) : body, "base64url");
        data = JSON.parse(bytes.toString());
      }
    } catch {}
    if (!data) throw err;
  }

  const [url, title, year, kind] = data;
  const parsed = new URL(url);
  let source = Object.keys(origins).find(
    (key) => origins[key] === parsed.origin,
  );
  if (!source) {
    if (/isaidub/i.test(parsed.hostname)) source = "isaidub";
    else if (/moviezda|moviesda/i.test(parsed.hostname)) source = "moviezda";
  }
  if (
    !source ||
    parsed.username ||
    parsed.password ||
    typeof title !== "string" ||
    !Number.isInteger(year)
  )
    throw new Error("Invalid movie");

  const currentOrigin = origins[source] || parsed.origin;
  const currentUrl = new URL(parsed.pathname + parsed.search, currentOrigin).href;

  return {
    url: currentUrl,
    title,
    year,
    source,
    kind: kind === "tv" ? "tv" : undefined,
    provider: source === "isaidub" ? "Isaidub" : "Moviezda",
  };
}
