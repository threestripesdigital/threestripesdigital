// Shared rank-check model. Imported by the public funnel endpoint
// (api/check.js) and the password-gated partner lookup (api/partner.js) so
// the keyword filter and the opportunity math can never drift apart between
// what a prospect sees and what the partner agency sees.
// Underscore-prefixed: Pages Functions does not route this as an endpoint.

const DFS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";

// --- Commercial-intent filter --------------------------------------------
const INFO_RE =
  /^(how|what|when|why|where|who|can|do|does|is|are|will|should)\b|process|processing|time(s)?\b|requirement|checklist|definition|meaning|salary|difference|\bvs\b|form(s)?$|\bfree\b|pro bono|sample|template/i;
const SERVICE_RE =
  /(lawyer|attorney|law firm|law office|legal)\b|(dui|dwi|divorce|custody|injury|accident|criminal|immigration|malpractice|wrongful death|estate planning|probate|traffic ticket|defense)\b/i;
const GENERIC_TOKENS = new Set([
  "law", "laws", "legal", "lawyer", "lawyers", "attorney", "attorneys",
  "firm", "firms", "group", "office", "offices", "associates", "justice", "injury",
]);
// A money keyword must name an actual practice area. This keeps firm-name
// searches ("costas law firm", "carlos cruz attorney") out even when the
// brand token cannot be matched against a concatenated domain.
const PRACTICE_RE =
  /(dui|dwi|divorce|custody|family|injury|accident|criminal|immigration|visa|green card|deportation|asylum|citizenship|naturalization|malpractice|wrongful death|estate|probate|traffic|speeding|defense|employment|discrimination|bankruptcy|workers.?comp|domestic violence|tax)/i;
// Legal-entity suffixes and "the X law office" style queries are someone
// searching for a specific firm by name: navigational, not a case lead.
const ENTITY_RE = /\b(llc|pllc|llp|p\.?c\.?\b|esq|law offices? of)\b|^the\b/i;
// And it must actually ask for a lawyer: keeps org/acronym searches
// ("lhsc immigration") out even when they name a practice area.
const LAWYER_RE = /(lawyer|attorney|law firm|law office|legal aid|legal help|legal services)/i;

// True commercial-intent test, bound to a domain so the firm's own brand
// searches are excluded along with informational and non-service queries.
export function moneyKeywordTest(domain) {
  const brandTokens = (domain || "")
    .split(".")[0]
    .split(/[^a-z]+/i)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t.toLowerCase()))
    .map((t) => t.toLowerCase());
  return function isMoneyKeyword(kw) {
    const k = (kw || "").toLowerCase();
    if (INFO_RE.test(k)) return false;
    if (!SERVICE_RE.test(k)) return false;
    if (!PRACTICE_RE.test(k)) return false;
    if (!LAWYER_RE.test(k)) return false;
    if (ENTITY_RE.test(k)) return false;
    if (brandTokens.some((t) => k.includes(t))) return false;
    return true;
  };
}

// --- Money model ---------------------------------------------------------
// Average revenue per signed case by practice area. Values set by Bilal
// Aug 2026, sanity-checked against national fee guides (divorce $8-15K
// uncontested per lawful.com/attorneyreview; DUI first offense $1.5-3.5K
// per nationalduiauthority; criminal $5-25K+; immigration $1.5-15K; PI on
// contingency ~33% of settlement). DUI must match before the criminal
// bucket so "dui lawyer" prices as DUI, not criminal.
export function caseValueFor(kw) {
  const k = (kw || "").toLowerCase();
  if (/(injury|accident|malpractice|wrongful death)/.test(k)) return 50000;
  if (/(traffic ticket|speeding)/.test(k)) return 500;
  if (/(dui|dwi)/.test(k)) return 3000;
  if (/(divorce|custody|family)/.test(k)) return 10000;
  if (/(criminal|defense|domestic violence)/.test(k)) return 10000;
  if (/(immigration|visa|green card)/.test(k)) return 5000;
  if (/(employment|discrimination)/.test(k)) return 10000;
  if (/(estate|probate|will)/.test(k)) return 5000;
  return 5000;
}

// Expected CTR by Google position, following the shape of published
// click-curve studies (FirstPageSage / Advanced Web Ranking): ~40% at #1,
// steep decay through page 1, under 1% anywhere on page 2, near zero on
// pages 3-5. Powers the before/after comparison.
export function ctrFor(position) {
  const p = Number(position) || 50;
  if (p <= 1) return 0.4;
  if (p === 2) return 0.18;
  if (p === 3) return 0.1;
  if (p === 4) return 0.07;
  if (p === 5) return 0.05;
  if (p <= 7) return 0.035;
  if (p <= 10) return 0.02;
  if (p <= 15) return 0.008;
  if (p <= 20) return 0.005;
  if (p <= 30) return 0.003;
  if (p <= 40) return 0.0015;
  return 0.001;
}

// Opportunity at #1: 40% CTR, 10% visit-to-inquiry, 1 in 5 signed,
// practice-area average fee. Monthly $ rounded to the nearest $100.
export function opportunityFor(keyword, volume) {
  const vol = Number(volume) || 0;
  const clicks = Math.round(vol * 0.4);
  const leads = clicks * 0.1;
  const cases = leads * 0.2;
  const caseValue = caseValueFor(keyword);
  const monthly = Math.round((cases * caseValue) / 100) * 100;
  return { clicks, leads, cases, caseValue, monthly };
}

// Same funnel run at the position they hold today, for before/after.
export function currentValueFor(keyword, volume, position) {
  const caseValue = caseValueFor(keyword);
  const ctr = ctrFor(position);
  const clicks = Math.round((Number(volume) || 0) * ctr);
  const leads = clicks * 0.1;
  const cases = leads * 0.2;
  return {
    ctr, clicks, leads, cases, caseValue,
    monthly: Math.round((cases * caseValue) / 100) * 100,
  };
}

// --- Keyword grouping ----------------------------------------------------
// Collapse near-duplicate keywords ("immigration lawyer/attorney/law firm
// philadelphia [pa]") into one group; surface the BEST-ranking keyword of
// each group so prospects see distinct opportunities, not five spellings.
const STOP = new Set(["in", "the", "a", "an", "of", "for", "near", "me", "best", "top", "good"]);
const SYN = {
  attorney: "lawyer", attorneys: "lawyer", lawyers: "lawyer",
  firm: "lawyer", firms: "lawyer", law: "lawyer",
};
const PHRASES = [
  ["law firms", " lawyer "],
  ["law firm", " lawyer "],
  ["new jersey", " nj "],
  ["new york", " ny "],
  ["oklahoma city", " okc "],
  ["philly", " philadelphia "],
];

function signature(keyword) {
  let s = " " + keyword.toLowerCase() + " ";
  for (const [from, to] of PHRASES) s = s.split(from).join(to);
  const uniq = new Set(
    s.split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).map((t) => SYN[t] || t)
  );
  // Drop trailing state codes ("pa", "il") only when enough context remains
  // to identify the group without them.
  for (const t of Array.from(uniq)) {
    if (t.length <= 2 && uniq.size - 1 >= 3) uniq.delete(t);
  }
  return Array.from(uniq).sort().join(" ");
}

export function buildThemes(items) {
  const groups = new Map();
  for (const item of items) {
    const kw = (item.keyword_data && item.keyword_data.keyword) || "";
    if (!kw) continue;
    const serpItem =
      (item.ranked_serp_element && item.ranked_serp_element.serp_item) || {};
    const entry = {
      keyword: kw,
      position: serpItem.rank_absolute || 0,
      volume:
        (item.keyword_data &&
          item.keyword_data.keyword_info &&
          item.keyword_data.keyword_info.search_volume) ||
        0,
      url: serpItem.url || serpItem.relative_url || "",
    };
    const sig = signature(kw);
    let group = groups.get(sig);
    if (!group) {
      group = {
        keyword: entry.keyword, position: entry.position,
        volume: entry.volume, url: entry.url, variants: [],
      };
      groups.set(sig, group);
    }
    group.variants.push(entry);
    // The group is fronted by its best-ranking keyword (lowest position;
    // volume breaks ties). The URL follows the fronting keyword: it is the
    // page the boost would push.
    if (
      entry.position < group.position ||
      (entry.position === group.position && entry.volume > group.volume)
    ) {
      group.keyword = entry.keyword;
      group.position = entry.position;
      group.volume = entry.volume;
      group.url = entry.url;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.volume - a.volume);
}

// Money keywords only, each carrying the full before/after math. Never fall
// back to branded or informational themes: an empty list is a truthful no-fit.
export function projectKeywords(domain, allThemes, limit = 8) {
  const isMoney = moneyKeywordTest(domain);
  const moneyThemes = allThemes.filter((t) => isMoney(t.keyword));
  const displayThemes = moneyThemes;
  const keywords = displayThemes.slice(0, limit).map(({ keyword, position, volume, url }) => {
    const opp = opportunityFor(keyword, volume);
    const now = currentValueFor(keyword, volume, position);
    return {
      keyword, position, volume, url,
      case_value: opp.caseValue,
      opp_clicks: opp.clicks,
      opp_leads: opp.leads,
      opp_cases: opp.cases,
      opp_value: opp.monthly,
      ctr_now: +(now.ctr * 100).toFixed(2),
      now_clicks: now.clicks,
      now_leads: +now.leads.toFixed(1),
      now_cases: +now.cases.toFixed(1),
      now_value: now.monthly,
    };
  });
  return { keywords, displayThemes };
}

// --- DataForSEO ----------------------------------------------------------
// Resolves { items, total } or throws with a status string suitable for the
// lead record.
export async function fetchRankedKeywords(env, domain) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    const err = new Error("not_configured");
    err.status = "not_configured";
    throw err;
  }
  const auth =
    "Basic " + btoa(env.DATAFORSEO_LOGIN + ":" + env.DATAFORSEO_PASSWORD);
  const payload = [
    {
      target: domain,
      location_code: 2840, // United States
      language_code: "en",
      filters: [
        ["ranked_serp_element.serp_item.rank_absolute", ">=", 1],
        "and",
        ["ranked_serp_element.serp_item.rank_absolute", "<=", 50],
        "and",
        ["ranked_serp_element.serp_item.type", "=", "organic"],
        "and",
        ["keyword_data.keyword_info.search_volume", ">=", 10],
      ],
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      limit: 100,
    },
  ];

  let data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(DFS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("dfs_http_" + res.status);
    data = await res.json();
  } catch {
    const err = new Error("check_failed");
    err.status = "check_failed";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const task = data && data.tasks && data.tasks[0];
  if (!task || task.status_code >= 40000) {
    const err = new Error("check_failed");
    err.status = "check_failed_" + (task ? task.status_code : "no_task");
    err.cost = Number((task && task.cost) || data.cost || 0) || 0;
    throw err;
  }
  const result = task.result && task.result[0];
  const items = (result && result.items) || [];
  // DataForSEO reports what the call actually billed; prefer the task's own
  // figure and fall back to the response total.
  const cost = Number(task.cost || data.cost || 0) || 0;
  return { items, total: (result && result.total_count) || items.length, cost };
}

export function normalizeDomain(raw) {
  if (!raw) return "";
  let value = String(raw).trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    return "";
  }
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return "";
    const host = (u.hostname || "")
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    if (!host || host.length > 253 || host.includes(":")) return "";
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "";
    const labels = host.split(".");
    if (labels.length < 2) return "";
    if (
      labels.some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9-]+$/.test(label) ||
          label.startsWith("-") ||
          label.endsWith("-")
      )
    ) return "";
    const tld = labels[labels.length - 1];
    if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{2,59}$/.test(tld)) {
      return "";
    }
    return host;
  } catch {
    return "";
  }
}
