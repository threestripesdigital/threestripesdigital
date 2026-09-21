// Static design review only. Never attach production bindings or routes here.
const csp = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-inline' https://*.wistia.com https://*.wistia.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com blob: https://fast.wistia.com; font-src 'self' data: https://fonts.gstatic.com https://*.wistia.com https://fast.wistia.net; img-src 'self' data: https://threestripesdigital.com https://*.wistia.com https://*.wistia.net; media-src 'self' https://threestripesdigital.com blob: data: https://*.wistia.com https://*.wistia.net; worker-src 'self' blob:; frame-src https://fast.wistia.com https://fast.wistia.net; connect-src 'self' https://*.wistia.com https://*.wistia.net; upgrade-insecure-requests";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method) || url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'design_preview_only', message: 'Design preview only. No details have been sent.' }, { status: 405, headers: { 'Cache-Control': 'no-store', 'X-Rankboost-Preview': 'isolated', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('X-Rankboost-Preview', 'isolated');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Cache-Control', /\/assets\/brand\/.*\.woff2$/.test(url.pathname) ? 'public, max-age=31536000, immutable' : /\.(webp|png|jpg|svg)$/.test(url.pathname) ? 'public, max-age=300' : 'no-store');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  }
};
