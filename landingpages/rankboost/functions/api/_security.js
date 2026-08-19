function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function sameValue(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function createLeadToken(secret, leadRef, ttlSeconds = 7200, now = Date.now()) {
  if (!secret || !leadRef) throw new Error("missing_signing_input");
  const claims = JSON.stringify({ ref: leadRef, exp: Math.floor(now / 1000) + ttlSeconds });
  const payload = base64Url(new TextEncoder().encode(claims));
  const signature = base64Url(await hmac(secret, payload));
  return payload + "." + signature;
}

export async function verifyLeadToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = base64Url(await hmac(secret, parts[0]));
  if (!sameValue(expected, parts[1])) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    if (!claims.ref || !Number.isFinite(claims.exp)) return null;
    if (claims.exp < Math.floor(now / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function fromTrustedRouter(request, env) {
  const supplied = request.headers.get("X-Router-Token") || "";
  return Boolean(env.ROUTER_TOKEN && sameValue(supplied, env.ROUTER_TOKEN));
}

export async function authFailureStatus(request, env, endpoint, limit = 8) {
  const forwarded = fromTrustedRouter(request, env)
    ? request.headers.get("X-Forwarded-Client-IP") || ""
    : "";
  const ip = forwarded || request.headers.get("CF-Connecting-IP") || "unknown";
  if (!env.LEADS_DB) return 403;
  try {
    await env.LEADS_DB.batch([
      env.LEADS_DB
        .prepare(
          "DELETE FROM auth_attempts WHERE created_at < datetime('now', '-1 day')"
        ),
      env.LEADS_DB
        .prepare(
          "INSERT INTO auth_attempts (endpoint, ip) VALUES (?1, ?2)"
        )
        .bind(endpoint, ip),
    ]);
    const row = await env.LEADS_DB
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_attempts
         WHERE endpoint = ?1 AND ip = ?2
           AND created_at > datetime('now', '-15 minutes')`
      )
      .bind(endpoint, ip)
      .first();
    return Number(row && row.count) > limit ? 429 : 403;
  } catch {
    return 403;
  }
}

function allowedFunnelHostname(hostname) {
  return hostname === "threestripesdigital.com" ||
    hostname === "www.threestripesdigital.com" ||
    hostname === "tsd-law-firm-rank-boost.pages.dev" ||
    hostname.endsWith(".tsd-law-firm-rank-boost.pages.dev");
}

function allowedFunnelUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (
      url.hostname === "threestripesdigital.com" ||
      url.hostname === "www.threestripesdigital.com"
    ) {
      return url.pathname === "/rank-boost/law-firms" ||
        url.pathname.startsWith("/rank-boost/law-firms/");
    }
    return allowedFunnelHostname(url.hostname);
  } catch {
    return false;
  }
}

export function validFunnelOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !allowedFunnelHostname(url.hostname)) return false;
  const site = request.headers.get("Sec-Fetch-Site") || "";
  return !site || site === "same-origin" || site === "same-site";
}

export function validFunnelPageUrl(value) {
  return allowedFunnelUrl(String(value || ""));
}
