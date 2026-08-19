const META_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 15000;

export class IntegrationError extends Error {
  constructor(
    message,
    {
      status = null,
      retryable = true,
      retryAfterSeconds = 0,
      deliveryUnknown = false,
    } = {}
  ) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    this.deliveryUnknown = deliveryUnknown;
  }
}

function missing(name) {
  return new IntegrationError("missing_" + name.toLowerCase(), {
    status: 503,
    retryable: false,
  });
}

function retryAfterSeconds(response) {
  const value = response.headers.get("Retry-After") || "";
  if (/^\d+$/.test(value)) return Math.min(Number(value), 3600);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.min(Math.ceil((timestamp - Date.now()) / 1000), 3600));
}

async function request(url, options, policy = {}) {
  const remaining = policy.deadlineAt
    ? Math.max(0, policy.deadlineAt - Date.now())
    : REQUEST_TIMEOUT_MS;
  const timeoutMs = Math.max(
    250,
    Math.min(Number(policy.timeoutMs) || REQUEST_TIMEOUT_MS, remaining)
  );
  if (remaining < 250) {
    throw new IntegrationError("provider_deadline_exhausted", {
      retryable: true,
      deliveryUnknown: false,
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.ok) return response;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new IntegrationError(`provider_http_${response.status}`, {
      status: response.status,
      retryable,
      retryAfterSeconds: retryAfterSeconds(response),
      deliveryUnknown: policy.deliveryUnknown === true &&
        (response.status === 408 || response.status >= 500),
    });
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(
      error && error.name === "AbortError" ? "provider_timeout" : "provider_network_error",
      {
        retryable: true,
        deliveryUnknown: policy.deliveryUnknown === true,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function slackMessage(env, payload, options) {
  const partner = payload.destination === "partner";
  const webhook = partner
    ? env.SLACK_WEBHOOK_URL_PARTNER || env.SLACK_WEBHOOK_URL
    : env.SLACK_WEBHOOK_URL;
  const message = {
    text: payload.text,
    unfurl_links: payload.unfurl_links === true,
    unfurl_media: payload.unfurl_media === true,
  };
  let webhookError = null;
  if (webhook) {
    try {
      await request(
        webhook,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        },
        { ...options, deliveryUnknown: true }
      );
      return;
    } catch (error) {
      // Never switch transports when delivery may have occurred or a retry is
      // appropriate. A definitive non-retryable webhook rejection can safely
      // use the configured bot transport instead.
      if (!(error instanceof IntegrationError) || error.deliveryUnknown || error.retryable) {
        throw error;
      }
      webhookError = error;
    }
  }
  const channel = partner
    ? env.SLACK_CHANNEL_ID_PARTNER || env.SLACK_CHANNEL_ID
    : env.SLACK_CHANNEL_ID;
  if (!env.SLACK_BOT_TOKEN || !channel) {
    throw webhookError || missing("SLACK_WEBHOOK_URL");
  }
  const response = await request(
    "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, ...message }),
    },
    { ...options, deliveryUnknown: true }
  );
  const result = await response.json().catch(() => ({}));
  if (!result.ok) {
    throw new IntegrationError("slack_api_error", {
      status: 502,
      retryable: false,
    });
  }
}

async function metaEvents(env, payload, options) {
  if (!env.META_CAPI_TOKEN) throw missing("META_CAPI_TOKEN");
  if (!env.META_DATASET_ID) throw missing("META_DATASET_ID");
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/${env.META_DATASET_ID}/events` +
    `?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`;
  await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: payload.events || [] }),
  }, options);
}

async function kitUpsertTag(env, payload, options) {
  if (!env.KIT_API_KEY) throw missing("KIT_API_KEY");
  const headers = {
    "X-Kit-Api-Key": env.KIT_API_KEY,
    "Content-Type": "application/json",
  };
  await request("https://api.kit.com/v4/subscribers", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email_address: payload.email,
      first_name: payload.first_name || "",
      ...(payload.fields ? { fields: payload.fields } : {}),
    }),
  }, options);
  await request(`https://api.kit.com/v4/tags/${payload.tag_id}/subscribers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email_address: payload.email }),
  }, options);
}

async function kitTagExisting(env, payload, options) {
  if (!env.KIT_API_KEY) throw missing("KIT_API_KEY");
  const headers = {
    "X-Kit-Api-Key": env.KIT_API_KEY,
    "Content-Type": "application/json",
  };
  const lookup = await request(
    "https://api.kit.com/v4/subscribers?email_address=" +
      encodeURIComponent(String(payload.email || "").trim().toLowerCase()),
    { headers },
    options
  );
  const data = await lookup.json().catch(() => ({}));
  if (!(data.subscribers || []).length) {
    throw new IntegrationError("kit_subscriber_not_found", {
      status: 404,
      retryable: true,
    });
  }
  await request(`https://api.kit.com/v4/tags/${payload.tag_id}/subscribers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email_address: payload.email }),
  }, options);
}

async function roezanSms(env, payload, options) {
  if (!env.ROEZAN_API_KEY) throw missing("ROEZAN_API_KEY");
  await request(
    "https://app.roezan.com/api/integrations/message/send",
    {
      method: "POST",
      headers: {
        "X-Api-Key": env.ROEZAN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: payload.phone,
        message: payload.message,
        firstName: payload.first_name || "",
      }),
    },
    { ...options, deliveryUnknown: true }
  );
}

export async function dispatchIntegrationJob(env, kind, payload, options = {}) {
  if (kind === "slack.webhook") return slackMessage(env, payload, options);
  if (kind === "meta.events") return metaEvents(env, payload, options);
  if (kind === "kit.upsert_tag") return kitUpsertTag(env, payload, options);
  if (kind === "kit.tag_existing") return kitTagExisting(env, payload, options);
  if (kind === "roezan.sms") return roezanSms(env, payload, options);
  throw new IntegrationError("unknown_job_kind", {
    status: 400,
    retryable: false,
  });
}
