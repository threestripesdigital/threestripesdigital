// Keyword Scout model: niche-agnostic commercial-intent scoring for any
// website's ranked keywords. Used only by the password-gated internal tool
// (api/scout.js). Deliberately separate from _rankmodel.js, which encodes
// law-firm-specific money keyword rules for the public funnel.
// Underscore-prefixed: Pages Functions does not route this as an endpoint.

const DFS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";

// Google markets the tool can query. Keys are what the page sends; codes are
// DataForSEO location/language codes.
export const LOCATIONS = {
  us: { location_code: 2840, language_code: "en", label: "United States" },
  ca: { location_code: 2124, language_code: "en", label: "Canada" },
  gb: { location_code: 2826, language_code: "en", label: "United Kingdom" },
  au: { location_code: 2036, language_code: "en", label: "Australia" },
  nz: { location_code: 2554, language_code: "en", label: "New Zealand" },
  ie: { location_code: 2372, language_code: "en", label: "Ireland" },
  in: { location_code: 2356, language_code: "en", label: "India" },
  sg: { location_code: 2702, language_code: "en", label: "Singapore" },
  ph: { location_code: 2608, language_code: "en", label: "Philippines" },
  za: { location_code: 2710, language_code: "en", label: "South Africa" },
  ae: { location_code: 2784, language_code: "en", label: "United Arab Emirates" },
  de: { location_code: 2276, language_code: "de", label: "Germany" },
  fr: { location_code: 2250, language_code: "fr", label: "France" },
  es: { location_code: 2724, language_code: "es", label: "Spain" },
  it: { location_code: 2380, language_code: "it", label: "Italy" },
  nl: { location_code: 2528, language_code: "nl", label: "Netherlands" },
  se: { location_code: 2752, language_code: "sv", label: "Sweden" },
  br: { location_code: 2076, language_code: "pt", label: "Brazil" },
  mx: { location_code: 2484, language_code: "es", label: "Mexico" },
  jp: { location_code: 2392, language_code: "ja", label: "Japan" },
};

export const DEFAULT_LOCATION = "us";

export function resolveLocation(key) {
  const k = String(key || DEFAULT_LOCATION).toLowerCase();
  return LOCATIONS[k] ? { key: k, ...LOCATIONS[k] } : null;
}

// Positions 2-50 are where a rank boost moves the needle: already on
// Google's radar, not yet taking the clicks.
export const BOOST_MIN = 2;
export const BOOST_MAX = 50;

export function isBoostPosition(position) {
  const p = Number(position) || 0;
  return p >= BOOST_MIN && p <= BOOST_MAX;
}

// --- Intent signals (any niche) ------------------------------------------
// Questions, learning and freebie queries: someone researching, not buying.
const INFO_RE =
  /^(how|what|when|why|where|who|which|can|do|does|is|are|will|should|did|was|were)\b|\b(definition|meaning|wiki|wikipedia|examples?|ideas|tutorials?|guide|guides|tips|diy|pdf|download|salary|salaries|jobs?|careers?|recipes?|lyrics|images?|photos?|pictures?|memes?|history|facts|quotes|template|templates|free|samples?|symptoms|causes)\b/i;
// Words people use when they are ready to pay someone or buy something.
const TRANSACTIONAL_RE =
  /\b(buy|order|purchase|for sale|hire|quote|quotes|estimate|estimates|book|booking|near me|price|prices|cost|costs|cheap|affordable|rental|rentals|rent|deal|deals|discount|discounts|coupon|coupons|shop|store|online|delivery|subscribe|subscription|pricing|plans?|installation|install|repair|repairs|replacement|service|services|company|companies|agency|agencies|firm|firms|contractor|contractors|provider|providers|supplier|suppliers|manufacturer|manufacturers|wholesale|dealer|dealers|clinic|clinics|lawyer|lawyers|attorney|attorneys|dentist|dentists|doctor|doctors|plumber|plumbers|electrician|electricians|roofer|roofers|roofing|landscaper|landscaping|consultant|consultants|specialist|specialists|experts?|professionals?)\b/i;
// Comparison and shortlist queries: late-stage research with money behind it.
const COMMERCIAL_RE =
  /\b(best|top|reviews?|vs|versus|alternatives?|comparison|compare|software|tools?|platform|platforms|solutions?|app|apps|packages?|options?|rated|recommended|brands?)\b/i;
// Domain tokens that are too generic to identify a brand.
const GENERIC_TOKENS = new Set([
  "www", "com", "net", "org", "shop", "store", "online", "group", "digital",
  "media", "global", "world", "home", "site", "web", "blog", "news", "the",
  "and", "best", "top", "free", "app", "apps", "tech", "labs", "studio",
]);

const INTENT_BASE = {
  transactional: 45,
  commercial: 35,
  navigational: 10,
  informational: 0,
};

export function brandTokensFor(domain) {
  return (domain || "")
    .toLowerCase()
    .split(".")
    .slice(0, -1) // drop the TLD
    .join(" ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
}

// Ordinary words that also start compound domain names ("bestbuy",
// "homedepot"): never treat them as the brand on their own.
const COMMON_PREFIXES = new Set([
  "best", "cheap", "free", "online", "shop", "store", "local", "near", "good",
  "home", "city", "north", "south", "east", "west", "smart", "easy", "quick",
  "fast", "super", "pro", "true", "real", "first", "your", "my", "get", "the",
]);

// A query is branded when it contains a whole brand token ("acmewidgets") or,
// for compound domains ("nobsroutines"), a distinctive leading piece of one
// ("nobs toothpaste"). The piece must be at least four letters and the token
// must carry at least four more, so "toothpaste" on toothpastehq.com is not
// mistaken for the brand.
export function isBrandQuery(keyword, brandTokens) {
  const k = String(keyword || "").toLowerCase();
  if (!brandTokens || !brandTokens.length) return false;
  if (brandTokens.some((t) => k.includes(t))) return true;
  const words = k.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !COMMON_PREFIXES.has(w));
  return brandTokens.some((t) =>
    t.length >= 8 && words.some((w) => t.length >= w.length + 4 && t.startsWith(w))
  );
}

// Returns { score 0-100, intent, signals[] }. Intent comes from DataForSEO's
// search_intent_info when present, else from the keyword's own wording.
export function scoreKeyword(keyword, info = {}, intentInfo = {}, brandTokens = []) {
  const k = String(keyword || "").toLowerCase();
  const signals = [];
  let intent = String((intentInfo && intentInfo.main_intent) || "").toLowerCase();
  const foreign = Array.isArray(intentInfo && intentInfo.foreign_intent)
    ? intentInfo.foreign_intent.map((s) => String(s).toLowerCase())
    : [];

  const tx = TRANSACTIONAL_RE.test(k);
  const cx = COMMERCIAL_RE.test(k);
  const inf = INFO_RE.test(k);

  if (!(intent in INTENT_BASE)) {
    intent = tx ? "transactional" : cx ? "commercial" : inf ? "informational" : "unknown";
  }
  let score = intent in INTENT_BASE ? INTENT_BASE[intent] : 20;
  if (foreign.includes("transactional") || foreign.includes("commercial")) {
    score += 8;
    signals.push("secondary buying intent");
  }
  if (tx) { score += 20; signals.push("buying words"); }
  if (cx) { score += 10; signals.push("comparison words"); }
  if (inf) { score -= 25; signals.push("research words"); }

  const cpc = Number(info && info.cpc) || 0;
  if (cpc > 0) {
    score += Math.min(20, cpc * 4);
    signals.push("cpc $" + cpc.toFixed(2));
  }
  const competition = Number(info && info.competition) || 0;
  if (competition > 0) score += competition * 10;

  const brand = isBrandQuery(k, brandTokens);
  if (brand) { score -= 35; signals.push("own brand"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, intent, brand, signals };
}

// DataForSEO items -> flat, scored, sorted rows. One row per keyword (the
// best-ranking URL wins when a site ranks twice for the same term).
export function buildScoutRows(items, domain) {
  const brandTokens = brandTokensFor(domain);
  const byKeyword = new Map();
  for (const item of items || []) {
    const kd = item.keyword_data || {};
    const keyword = kd.keyword || "";
    if (!keyword) continue;
    const info = kd.keyword_info || {};
    const serp = (item.ranked_serp_element && item.ranked_serp_element.serp_item) || {};
    const position = Number(serp.rank_absolute) || Number(serp.rank_group) || 0;
    const scored = scoreKeyword(keyword, info, kd.search_intent_info || {}, brandTokens);
    const row = {
      keyword,
      position,
      volume: Number(info.search_volume) || 0,
      cpc: Number(info.cpc) || 0,
      competition: Number(info.competition) || 0,
      intent: scored.intent,
      score: scored.score,
      brand: scored.brand,
      signals: scored.signals,
      boost: isBoostPosition(position),
      url: serp.url || "",
      etv: Number(serp.etv) || 0,
    };
    const existing = byKeyword.get(keyword.toLowerCase());
    if (!existing || (position && (!existing.position || position < existing.position))) {
      byKeyword.set(keyword.toLowerCase(), row);
    }
  }
  return Array.from(byKeyword.values()).sort(
    (a, b) => b.score - a.score || b.volume - a.volume || a.position - b.position
  );
}

// Top 100 organic keywords by search volume for any target, in one market.
// Resolves { items, total, cost } or throws with a status string.
export async function fetchScoutKeywords(env, domain, location) {
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
      location_code: location.location_code,
      language_code: location.language_code,
      item_types: ["organic"],
      filters: [
        ["ranked_serp_element.serp_item.type", "=", "organic"],
        "and",
        ["keyword_data.keyword_info.search_volume", ">", 0],
      ],
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      limit: 100,
    },
  ];

  let data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
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
  const cost = Number(task.cost || data.cost || 0) || 0;
  return { items, total: (result && result.total_count) || items.length, cost };
}
