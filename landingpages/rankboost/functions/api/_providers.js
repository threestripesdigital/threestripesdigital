import { WEBSITE_TAG_IDS } from "./_offers.js";
import { WEBSITE_EMAILS } from "./_websiteemailconfig.js";
import { qualifiedReminderEmailFields } from "./_emailfields.js";
import { APPOINTMENT_EMAILS } from './_appointmentconfig.js';
import { lifecycleEnabled, registerAppointment, normalizedPhone, localSmsHour, appointmentCurrent } from './_appointments.js';
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
    ...(Array.isArray(payload.blocks) ? { blocks: payload.blocks } : {}),
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
  const fields = payload.qualified_call_start
    ? { ...payload.fields, ...qualifiedReminderEmailFields(payload.qualified_call_start) }
    : payload.fields;
  const subscriberResponse = await request("https://api.kit.com/v4/subscribers", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email_address: payload.email,
      ...(payload.first_name !== undefined ? { first_name: payload.first_name || "" } : {}),
      ...(fields ? { fields } : {}),
    }),
  }, options);
  const subscriberData = await subscriberResponse.json();
  // Kit retains an existing unsubscribe. Never enroll an inactive subscriber.
  const subscriber = subscriberData.subscriber;
  const website = Object.values(WEBSITE_TAG_IDS).includes(payload.tag_id) || Object.values(WEBSITE_EMAILS.tags).includes(payload.tag_id);
  if ((website || lifecycleEnabled(env)) && subscriber?.state && subscriber.state !== "active") return;
  const addTag = async (tagId) => request(`https://api.kit.com/v4/tags/${tagId}/subscribers`, { method:"POST", headers, body:JSON.stringify({email_address:payload.email}) }, options);
  const managedBooking=lifecycleEnabled(env)&&payload.appointment_invitee;
  if(managedBooking) {
    if(!APPOINTMENT_EMAILS.tags.managed)throw missing('APPOINTMENT_EMAIL_CONFIG');
    // Permanent suppression is applied before removing any old lifecycle tag.
    await addTag(APPOINTMENT_EMAILS.tags.managed);
    const remove=payload.website_call_start?[23211442,23211443,WEBSITE_EMAILS.tags.stop]:[22494650,22622480];
    payload={...payload,remove_tag_ids:[...new Set([...(payload.remove_tag_ids||[]),...remove,APPOINTMENT_EMAILS.tags.stop])]};
  }
  if (payload.tag_id === WEBSITE_TAG_IDS.booked) await addTag(WEBSITE_EMAILS.tags.everBooked);
  // The booked website state removes the unbooked state before enrollment.
  if (Array.isArray(payload.remove_tag_ids) && payload.remove_tag_ids.length) {
    const data = subscriberData;
    const subscriberId = Number(data.subscriber && data.subscriber.id);
    if (!Number.isSafeInteger(subscriberId) || subscriberId <= 0) throw new IntegrationError("kit_subscriber_id_missing");
    for (const tagId of payload.remove_tag_ids) {
      if (!Number.isSafeInteger(tagId) || tagId <= 0 || tagId === payload.tag_id) continue;
      try {
        await request(`https://api.kit.com/v4/tags/${tagId}/subscribers/${subscriberId}`, { method: "DELETE", headers }, options);
      } catch (error) { if (error.status !== 404) throw error; }
    }
  }
  await request(`https://api.kit.com/v4/tags/${payload.tag_id}/subscribers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email_address: payload.email }),
  }, options);
  if(managedBooking) {await registerAppointment(env,{...payload,kit_subscriber_id:subscriber.id});return;}
  const websiteCallExpired = payload.website_call_start && Date.parse(payload.website_call_start) <= Date.now() + 30 * 60000;
  if (websiteCallExpired) { await addTag(WEBSITE_EMAILS.tags.stop); return; }
  if (payload.website_sequence_id && (!subscriber?.fields?.website_call_date || !subscriber?.fields?.website_call_time)) throw new IntegrationError("website_booking_fields_missing", { retryable:true });
  const sequenceId = payload.website_sequence_id || (payload.tag_id === WEBSITE_TAG_IDS.lead ? WEBSITE_EMAILS.sequences.nurture : payload.tag_id === WEBSITE_TAG_IDS.booked ? WEBSITE_EMAILS.sequences.precall : payload.tag_id === WEBSITE_EMAILS.tags.longTerm ? WEBSITE_EMAILS.sequences.monthly : null);
  if (sequenceId) {
    if (!Object.values(WEBSITE_EMAILS.sequences).includes(sequenceId)) throw new IntegrationError("invalid_website_sequence", { retryable:false });
    await request(`https://api.kit.com/v4/sequences/${sequenceId}/subscribers`, {method:"POST",headers,body:JSON.stringify({email_address:payload.email})},options);
  }
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
  if(payload.fields)await request('https://api.kit.com/v4/subscribers',{method:'POST',headers,
    body:JSON.stringify({email_address:payload.email,fields:payload.fields})},options);
  await request(`https://api.kit.com/v4/tags/${payload.tag_id}/subscribers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email_address: payload.email }),
  }, options);
}

async function roezanSms(env, payload, options) {
  if (!env.ROEZAN_API_KEY) throw missing("ROEZAN_API_KEY");
  if(lifecycleEnabled(env)) {
    const phone=normalizedPhone(payload.phone);
    if(!/^\d{10,15}$/.test(phone))throw new IntegrationError('invalid_sms_phone',{retryable:false});
    const suppressed=await env.LEADS_DB.prepare('SELECT phone FROM sms_suppression WHERE phone=?1').bind(phone).first();
    if(suppressed)return;
    if(payload.email&&await appointmentSubscriberStopped(env,payload,options))return;
    let contact=null;
    try {
      const found=await request('https://app.roezan.com/api/integrations/contacts?phone='+encodeURIComponent(phone),{headers:{'X-Api-Key':env.ROEZAN_API_KEY}},options);
      contact=(await found.json()).contact;
    } catch(error) {if(error.status!==404)throw error;}
    if(contact&&(Number(contact.opted_in)===0||contact.opted_out_at||Number(contact.invalid)===1||Number(contact.deleted)===1))return;
    const hour=localSmsHour(payload.appointment_timezone||contact?.timezone||contact?.timezone_detected);
    // Unknown timezones use a conservative shared daytime window for US leads.
    const safe=hour===null?(new Date().getUTCHours()>=17&&new Date().getUTCHours()<20):(hour>=Math.max(9,Number(contact?.safe_sending_start_hour)||9)&&hour<Math.min(20,Number(contact?.safe_sending_end_hour)||20));
    if(!safe)throw new IntegrationError('sms_quiet_hours',{retryable:true,retryAfterSeconds:1800});
  }
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

async function appointmentSubscriberStopped(env,payload,options) {
  if(!env.KIT_API_KEY)throw missing('KIT_API_KEY');
  const headers={'X-Kit-Api-Key':env.KIT_API_KEY};
  const data=await(await request(payload.kit_subscriber_id?`https://api.kit.com/v4/subscribers/${payload.kit_subscriber_id}`:'https://api.kit.com/v4/subscribers?email_address='+encodeURIComponent(payload.email),{headers},options)).json();
  const subscriber=data.subscriber||data.subscribers?.[0];
  if(!subscriber)throw new IntegrationError('subscriber_sync_pending');
  if(subscriber.state!=='active')return true;
  const tags=await(await request(`https://api.kit.com/v4/subscribers/${subscriber.id}/tags`,{headers},options)).json();
  const stopIds=[23211559,22511246,23217410,23217411,23217412];
  if(payload.appointment_timer)stopIds.push(22494650,22622480,23211442,23211443,23217408,APPOINTMENT_EMAILS.tags.stop);
  const stopped=(tags.tags||[]).some(t=>stopIds.includes(t.id));
  if(stopped&&payload.appointment_invitee) await env.LEADS_DB.prepare("UPDATE appointment_followup SET stopped_at=CURRENT_TIMESTAMP,outcome='recorded_outcome' WHERE invitee_uri=?1 AND stopped_at IS NULL").bind(payload.appointment_invitee).run();
  return stopped;
}

async function appointmentEmail(env,payload,options) {
  if(await appointmentSubscriberStopped(env,payload,options))return;
  const definition=[...Object.values(APPOINTMENT_EMAILS.boost),...Object.values(APPOINTMENT_EMAILS.website)].find(e=>e.id===payload.sequence_id);
  if(!definition)throw new IntegrationError('invalid_appointment_sequence',{retryable:false});
  const headers={'X-Kit-Api-Key':env.KIT_API_KEY,'Content-Type':'application/json'};
  if(!await appointmentCurrent(env.LEADS_DB,payload))return;
  // Each repeatable sequence contains one immediate email. The durable job
  // key controls repetitions; rescheduling cannot restart a multi-day sequence.
  await request(`https://api.kit.com/v4/sequences/${definition.id}/subscribers`,{
    method:'POST',headers,body:JSON.stringify({email_address:payload.email})
  },{...options,deliveryUnknown:true});
}

async function appointmentStop(env,payload,options) {
  if(!env.KIT_API_KEY)throw missing('KIT_API_KEY');
  await request(`https://api.kit.com/v4/tags/${APPOINTMENT_EMAILS.tags.stop}/subscribers`,{method:'POST',headers:{'X-Kit-Api-Key':env.KIT_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({email_address:payload.email})},options);
  await env.LEADS_DB.prepare("UPDATE appointment_followup SET stopped_at=CURRENT_TIMESTAMP,outcome=COALESCE(outcome,'appointment_cutoff') WHERE invitee_uri=?1 AND stopped_at IS NULL").bind(payload.appointment_invitee).run();
}

export async function dispatchIntegrationJob(env, kind, payload, options = {}) {
  if (kind === 'kit.appointment_email') return appointmentEmail(env,payload,options);
  if (kind === 'kit.appointment_stop') return appointmentStop(env,payload,options);
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
