const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://www.facebook.com https://*.facebook.com",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://assets.calendly.com https://static.cloudflareinsights.com https://*.wistia.com https://*.wistia.net https://src.litix.io https://browser.sentry-cdn.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com blob: https://fast.wistia.com",
  "font-src 'self' data: https://fonts.gstatic.com https://*.wistia.com",
  "img-src 'self' data: https:",
  "media-src 'self' https://threestripesdigital.com blob: data: https://*.wistia.com https://*.wistia.net",
  "worker-src 'self' blob:",
  "frame-src https://www.facebook.com https://*.facebook.com https://calendly.com https://*.calendly.com https://fast.wistia.com https://fast.wistia.net",
  "connect-src 'self' https://www.facebook.com https://*.facebook.com https://connect.facebook.net https://calendly.com https://*.calendly.com https://cloudflareinsights.com https://*.cloudflareinsights.com https://*.wistia.com https://*.wistia.net https://*.litix.io",
  "upgrade-insecure-requests",
].join("; ");

export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  const pathname = context.request
    ? new URL(context.request.url).pathname
    : "";
  if (/(^|\/)api(?:\/|$)/.test(pathname)) {
    headers.set("Cache-Control", "no-store");
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
