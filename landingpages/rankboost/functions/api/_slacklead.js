import { moneyKeywordTest, opportunityFor, ctrFor } from "./_rankmodel.js";

// Plain text for supplied values prevents names/keywords from injecting mentions.
const plain = (text) => ({ type: "plain_text", text: String(text).slice(0, 1900), emoji: true });
const value = (text) => String(text || "Not provided").replace(/[\r\n\t]+/g, " ").slice(0, 300);

export function slackJobForLead(lead, leadRef) {
  if (["rate_limited", "not_configured", "missing_email"].includes(lead.status)) return;
  const internal = lead.source === "partner";
  const qualified = Boolean(lead.qualified);
  const website = lead.status === "no_fit";
  const result = qualified ? "✅ Qualified for Rank Boost" : website ? "🌐 Website offer" : "⚠️ Scan needs review";
  const title = internal ? "🔎 Partner lookup (internal)" : `New lead: ${result}`;
  const next = internal ? "Internal lookup only. This is not an inbound lead."
    : qualified ? "Next step: Rank Boost booking. A scan is not a booked call."
    : website ? "Next step: website consultation. A scan is not a booked call."
    : "Next step: review the scan manually before recommending an offer.";
  const fields = internal ? [plain(`Looked up by\n${value(lead.partner)}`)]
    : [plain(`Name\n${value(lead.name)}`), plain(`Phone\n${value(lead.phone)}`), plain(`Email\n${value(lead.email)}`)];
  fields.push(plain(`Website\n${value(lead.domain)}`));
  const scan = qualified ? `${Number(lead.total) || 0} eligible keywords found`
    : website ? "No eligible Rank Boost keywords found in this scan"
    : `Scan incomplete: ${value(lead.status).replace(/_/g, " ")}`;
  const isMoney = moneyKeywordTest(lead.domain);
  const money = (lead.keywords || []).filter(k => isMoney(k.keyword));
  const shown = (money.length ? money : lead.keywords || []).slice(0, 3);
  const keywords = shown.map(k => `${value(k.keyword)}\nPosition ${Number(k.position) || 0} • ${(Number(k.volume) || 0).toLocaleString("en-US")} searches/month`);
  const blocks = [
    { type: "header", text: plain(title) },
    { type: "section", fields },
    { type: "section", text: plain(`${internal ? result + "\n" : ""}${scan}\n${next}`) },
  ];
  if (shown.length) {
    blocks.push({ type: "divider" }, { type: "section", text: plain(`Top keywords\n${keywords.join("\n\n")}`) });
    let gap = 0;
    for (const k of shown) {
      const opp = opportunityFor(k.keyword, k.volume);
      const now = Math.round(((Number(k.volume) || 0) * ctrFor(k.position) * 0.1 * 0.2 * opp.caseValue) / 100) * 100;
      gap += Math.max(0, opp.monthly - now);
    }
    if (gap > 0) blocks.push({ type: "context", elements: [plain(`Modeled opportunity: $${gap.toLocaleString("en-US")}/month across these ${shown.length} keywords. Estimate, not actual revenue or a forecast.`)] });
  }
  blocks.push({ type: "context", elements: [plain(`Lead reference: ${value(leadRef)}`)] });
  // Complete fallback for notifications, accessibility and clients without blocks.
  const text = [title, ...fields.map(f => f.text.replace("\n", ": ")), scan, next,
    ...(keywords.length ? ["Top keywords", ...keywords] : []), `Lead reference: ${value(leadRef)}`].join("\n")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { leadRef, kind: "slack.webhook", dedupeKey: `lead:${leadRef}:slack`,
    payload: { text, blocks, destination: internal ? "partner" : "leads", unfurl_links: false, unfurl_media: false } };
}
