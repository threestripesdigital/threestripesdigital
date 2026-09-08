const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://www.facebook.com https://*.facebook.com",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://assets.calendly.com https://static.cloudflareinsights.com https://*.wistia.com https://*.wistia.net https://src.litix.io https://browser.sentry-cdn.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com blob: https://fast.wistia.com",
  "font-src 'self' data: https://fonts.gstatic.com https://*.wistia.com https://fast.wistia.net",
  "img-src 'self' data: https:",
  "media-src 'self' https://threestripesdigital.com blob: data: https://*.wistia.com https://*.wistia.net",
  "worker-src 'self' blob:",
  "frame-src https://www.facebook.com https://*.facebook.com https://calendly.com https://*.calendly.com https://fast.wistia.com https://fast.wistia.net",
  "connect-src 'self' https://www.facebook.com https://*.facebook.com https://connect.facebook.net https://calendly.com https://*.calendly.com https://cloudflareinsights.com https://*.cloudflareinsights.com https://*.wistia.com https://*.wistia.net https://*.litix.io",
  "upgrade-insecure-requests",
].join("; ");

// The internal Keyword Scout lives on its own hostname (a custom domain on
// this Pages project). On that host the root serves scout.html and only the
// files the page needs are reachable; on every other host the scout files
// do not exist, so the tool never shows up under the law-firm funnel URL.
export const DEFAULT_SCOUT_HOST = "rb.threestripesdigital.com";
const SCOUT_ONLY_PATHS = new Set(["/scout", "/scout.html", "/scout.js", "/api/scout"]);
const SCOUT_HOST_ALLOWED = new Set([
  "/scout.js",
  "/styles.css",
  "/favicon.svg",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/privacy.html",
  "/api/scout",
]);

function scoutHostFor(env) {
  return (env && env.SCOUT_HOST) || DEFAULT_SCOUT_HOST;
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const PUBLIC_FUNNEL_API_PATHS = new Set(["/api/check", "/api/booking", "/api/track"]);
const PRODUCTION_FUNNEL_ORIGIN = "https://tsd-law-firm-rank-boost.pages.dev";

async function route(context, url) {
  // Preview frontends share the configured production API, keeping signing
  // keys and provider credentials in one environment. Never proxy admin APIs.
  if (context.env && context.env.FUNNEL_API_ORIGIN === PRODUCTION_FUNNEL_ORIGIN &&
      url.hostname.endsWith(".tsd-law-firm-rank-boost.pages.dev") &&
      PUBLIC_FUNNEL_API_PATHS.has(url.pathname) && context.request.method === "POST") {
    const headers = new Headers(context.request.headers);
    for (const name of [...headers.keys()]) {
      if (name.toLowerCase().startsWith("x-forwarded-client-") ||
          ["x-router-token", "authorization", "cookie"].includes(name.toLowerCase())) headers.delete(name);
    }
    return fetch(new Request(PRODUCTION_FUNNEL_ORIGIN + url.pathname, {
      method: "POST", headers, body: context.request.body, redirect: "manual",
    }));
  }
  const onScoutHost = url.hostname === scoutHostFor(context.env);
  const path = url.pathname;

  if (!onScoutHost) {
    if (SCOUT_ONLY_PATHS.has(path)) return notFound();
    return context.next();
  }

  // One canonical URL for the tool: the root of its host.
  if (path === "/scout" || path === "/scout.html" || path === "/index.html") {
    return Response.redirect(url.origin + "/" + url.search, 301);
  }
  if (path === "/") {
    const assets = context.env && context.env.ASSETS;
    if (!assets) return notFound();
    const scoutUrl = new URL("/scout", url);
    return assets.fetch(new Request(scoutUrl.toString(), context.request));
  }
  if (SCOUT_HOST_ALLOWED.has(path)) return context.next();
  return notFound();
}

export async function onRequest(context) {
  const url = context.request ? new URL(context.request.url) : null;
  const response = url ? await route(context, url) : await context.next();
  const headers = new Headers(response.headers);
  const pathname = url ? url.pathname : "";
  if (/(^|\/)api(?:\/|$)/.test(pathname)) {
    headers.set("Cache-Control", "no-store");
  }
  if (url && url.hostname === scoutHostFor(context.env)) {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-XSS-Protection", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
