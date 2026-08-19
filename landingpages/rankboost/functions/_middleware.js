const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://assets.calendly.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' https://threestripesdigital.com",
  "frame-src https://calendly.com https://*.calendly.com",
  "connect-src 'self' https://www.facebook.com https://*.facebook.com https://connect.facebook.net https://calendly.com https://*.calendly.com",
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
