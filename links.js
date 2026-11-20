import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { inflateSync } from "node:zlib";
import { origins } from "./sources.js";

function getSecret() {
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.MOVIE_SECRET?.length || 0) < 32
  ) {
    throw new Error(
      "Set MOVIE_SECRET to at least 32 random characters for production.",
    );
  }
  if (process.env.MOVIE_SECRET) return process.env.MOVIE_SECRET;
  return randomBytes(32);
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
  const data = unpack("movie-details", token);
  const [url, title, year, kind] = data;
  const parsed = new URL(url);
  const source = Object.keys(origins).find(
    (key) => origins[key] === parsed.origin,
  );
  if (
    !source ||
    parsed.username ||
    parsed.password ||
    typeof title !== "string" ||
    !Number.isInteger(year)
  )
    throw new Error("Invalid movie");
  return {
    url,
    title,
    year,
    source,
    kind: kind === "tv" ? "tv" : undefined,
    provider: source === "isaidub" ? "Isaidub" : "Moviezda",
  };
}
