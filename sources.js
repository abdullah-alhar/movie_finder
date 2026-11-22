import { isIP } from "node:net";

// Origins loaded from the database via updateOrigins(). Checked dynamically so
// that an admin URL change is reflected immediately without a server restart.
export const origins = {};

// approved() validates a URL for use as a provider origin or custom link.
// Enforces:
// 1. Valid HTTPS protocol (no http:, file:, javascript:)
// 2. No embedded credentials (username/password)
// 3. Standard HTTPS port only (no arbitrary ports)
// 4. Public FQDN only (blocks private IP ranges, localhost, loopbacks, SSRF)
export function approved(value) {
  try {
    if (!value || typeof value !== 'string') return false;
    const url = new URL(value.startsWith('http') ? value : 'https://' + value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    if (isIP(url.hostname) || url.hostname.startsWith('[') || url.hostname === 'localhost') return false;
    // Must be a valid public domain name with at least one dot (e.g. isaidub.green, moviesda36.com)
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)) return false;
    return true;
  } catch { return false; }
}

export const names = { isaidub: "Isaidub", moviezda: "Moviezda" };

// Known source keys — must match what the DB config stores as <key>_url
const SOURCE_KEYS = ['isaidub', 'moviezda'];

// Dev/test fallback domains — ONLY used when not in production and DB hasn't loaded yet.
// In production, origins MUST come from the DB (admin dashboard).
const DEV_FALLBACK_DOMAINS = {
  isaidub: 'https://isaidub.green',
  moviezda: 'https://moviezda.co',
};

export function updateOrigins(customConfig = null) {
  const cfg = customConfig || {};
  for (const key of SOURCE_KEYS) {
    const rawVal = cfg[key + "_url"] || "";
    if (!rawVal) {
      if (process.env.NODE_ENV !== 'production') {
        // Dev/test: use fallback so tests and local dev work without a DB
        origins[key] = DEV_FALLBACK_DOMAINS[key];
      } else {
        // Production: no DB value means this source is unavailable
        delete origins[key];
      }
      continue;
    }
    try {
      const url = new URL(rawVal.startsWith("http") ? rawVal : "https://" + rawVal);
      if (approved(url.href)) {
        origins[key] = url.origin;
      } else {
        delete origins[key];
      }
    } catch {
      delete origins[key];
    }
  }
}

// Initialize with dev fallbacks so tests and local dev work before DB loads.
// In production, server.js will immediately overwrite this with DB values.
updateOrigins();

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
  if (movie.poster && !movie.poster.includes("moviesda") && !movie.poster.includes("isaidub")) {
    return movie.poster;
  }
  return null;
}
