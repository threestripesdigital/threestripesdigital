// Maps threestripesdigital.com/rank-boost/<vertical>/* onto the vertical's
// Pages project. One entry per vertical; unknown paths fall through to the
// default vertical.

const VERTICALS = {
  "law-firms": "tsd-law-firm-rank-boost.pages.dev",
  // "medical-clinics": "tsd-medical-rank-boost.pages.dev",
  // "ecom": "tsd-ecom-rank-boost.pages.dev",
};

const DEFAULT_VERTICAL = "law-firms";
const JOB_PROCESSOR_TIMEOUT_MS = 28000;

export default {
  async fetch(request, env) {
    if (!env.ROUTER_TOKEN) {
      return new Response("Router not configured", { status: 503 });
    }
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["rank-boost", vertical, ...rest]

    const vertical = parts[1];
    const origin = VERTICALS[vertical];

    // /rank-boost, /rank-boost/, or unknown vertical -> default vertical.
    if (!origin) {
      return Response.redirect(
        url.origin + "/rank-boost/" + DEFAULT_VERTICAL + "/" + url.search,
        308
      );
    }

    // Canonical trailing slash on the vertical root so relative URLs resolve.
    if (url.pathname === "/rank-boost/" + vertical) {
      return Response.redirect(
        url.origin + "/rank-boost/" + vertical + "/" + url.search,
        308
      );
    }

    const upstream = new URL(url);
    upstream.hostname = origin;
    upstream.pathname = "/" + parts.slice(2).join("/");

    // Preserve the real visitor for rate limiting and lead records; the
    // direct CF headers on the subrequest describe this Worker hop instead.
    const headers = new Headers(request.headers);
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) headers.set("X-Forwarded-Client-IP", ip);
    else headers.delete("X-Forwarded-Client-IP");
    const country = request.cf && request.cf.country;
    if (country) headers.set("X-Forwarded-Client-Country", country);
    else headers.delete("X-Forwarded-Client-Country");
    // Geo for Meta CAPI match quality (ct/st/zp). Same trust model as IP/country.
    const geo = [
      ["X-Forwarded-Client-City", request.cf && request.cf.city],
      ["X-Forwarded-Client-Region", request.cf && request.cf.regionCode],
      ["X-Forwarded-Client-Postal", request.cf && request.cf.postalCode],
    ];
    for (const [header, value] of geo) {
      if (value) headers.set(header, String(value));
      else headers.delete(header);
    }
    // Proves to the origin that the forwarded headers came from this router,
    // not a direct pages.dev request spoofing them.
    headers.set("X-Router-Token", env.ROUTER_TOKEN);

    return fetch(new Request(upstream, { ...requestInit(request), headers }));
  },

  scheduled(_controller, env, context) {
    const processorToken = env.JOB_PROCESSOR_TOKEN || env.JOBS_TOKEN;
    if (!processorToken) {
      console.log("integration_job_cron_not_configured");
      return;
    }
    const origins = [...new Set(Object.values(VERTICALS))];
    context.waitUntil(
      Promise.all(origins.map((origin) =>
        processIntegrationJobs(origin, processorToken)
      ))
    );
  },
};

async function processIntegrationJobs(origin, processorToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_PROCESSOR_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${origin}/api/process-jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${processorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "process",
        limit: 4,
        budget_ms: 10000,
        no_show_limit: 4,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.log("integration_job_cron_http_error", origin, response.status);
    }
  } catch (error) {
    console.log(
      error && error.name === "AbortError"
        ? "integration_job_cron_timeout"
        : "integration_job_cron_network_error",
      origin
    );
  } finally {
    clearTimeout(timer);
  }
}

function requestInit(request) {
  return {
    method: request.method,
    body: request.body,
    redirect: "manual",
  };
}
