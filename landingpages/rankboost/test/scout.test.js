import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  brandTokensFor,
  buildScoutRows,
  isBoostPosition,
  isBrandQuery,
  resolveLocation,
  scoreKeyword,
} from "../functions/api/_scoutmodel.js";
import { onRequestPost as scoutPost } from "../functions/api/scout.js";
import { onRequest as middleware, DEFAULT_SCOUT_HOST } from "../functions/_middleware.js";

function run(url, env) {
  const seen = [];
  const assets = { fetch: async (req) => { seen.push("asset:" + new URL(req.url).pathname); return new Response("scout page"); } };
  return middleware({
    request: new Request(url),
    env: { ASSETS: assets, ...(env || {}) },
    next: async () => { seen.push("next"); return new Response("next"); },
  }).then((res) => ({ res, seen }));
}

test("scout host serves the tool at its root and nothing else", async () => {
  const root = await run("https://" + DEFAULT_SCOUT_HOST + "/");
  assert.equal(root.res.status, 200);
  assert.deepEqual(root.seen, ["asset:/scout"]);
  assert.equal(root.res.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");

  const script = await run("https://" + DEFAULT_SCOUT_HOST + "/scout.js");
  assert.deepEqual(script.seen, ["next"]);
  const api = await run("https://" + DEFAULT_SCOUT_HOST + "/api/scout");
  assert.deepEqual(api.seen, ["next"]);

  for (const path of ["/index.html", "/scout", "/scout.html"]) {
    const r = await run("https://" + DEFAULT_SCOUT_HOST + path);
    assert.equal(r.res.status, 301, path);
    assert.equal(r.res.headers.get("Location"), "https://" + DEFAULT_SCOUT_HOST + "/");
  }
  for (const path of ["/thank-you", "/partner", "/book.js", "/api/check", "/api/partner", "/api/leads"]) {
    const r = await run("https://" + DEFAULT_SCOUT_HOST + path);
    assert.equal(r.res.status, 404, path);
    assert.deepEqual(r.seen, [], path);
  }
});

test("scout files do not exist on the funnel hosts", async () => {
  for (const host of ["tsd-law-firm-rank-boost.pages.dev", "threestripesdigital.com"]) {
    for (const path of ["/scout", "/scout.html", "/scout.js", "/api/scout"]) {
      const r = await run("https://" + host + path);
      assert.equal(r.res.status, 404, host + path);
      assert.deepEqual(r.seen, []);
    }
    const lp = await run("https://" + host + "/");
    assert.deepEqual(lp.seen, ["next"]);
    assert.equal(lp.res.headers.get("X-Robots-Tag"), null);
  }
});

test("scout host can be overridden by SCOUT_HOST", async () => {
  const r = await run("https://scout.example.test/", { SCOUT_HOST: "scout.example.test" });
  assert.deepEqual(r.seen, ["asset:/scout"]);
});

function item(keyword, position, extra = {}) {
  return {
    keyword_data: {
      keyword,
      keyword_info: { search_volume: extra.volume || 100, cpc: extra.cpc || 0, competition: extra.competition || 0 },
      search_intent_info: extra.intent ? { main_intent: extra.intent, foreign_intent: extra.foreign || [] } : undefined,
    },
    ranked_serp_element: {
      serp_item: { rank_absolute: position, url: extra.url || "https://example.com/" + position, type: "organic" },
    },
  };
}

test("boost window is positions 2 through 50", () => {
  assert.equal(isBoostPosition(1), false);
  assert.equal(isBoostPosition(2), true);
  assert.equal(isBoostPosition(50), true);
  assert.equal(isBoostPosition(51), false);
  assert.equal(isBoostPosition(0), false);
});

test("commercial scoring ranks buying queries above research queries in any niche", () => {
  const buy = scoreKeyword("emergency plumber near me", { cpc: 12, competition: 0.9 }, { main_intent: "transactional" });
  const compare = scoreKeyword("best crm software for small business", { cpc: 6 }, { main_intent: "commercial" });
  const learn = scoreKeyword("how to unclog a drain", { cpc: 0.3 }, { main_intent: "informational" });
  assert.ok(buy.score > compare.score, "transactional beats commercial");
  assert.ok(compare.score > learn.score, "commercial beats informational");
  assert.equal(buy.intent, "transactional");
  assert.equal(learn.intent, "informational");
});

test("intent falls back to wording when the provider gives none", () => {
  assert.equal(scoreKeyword("buy running shoes online").intent, "transactional");
  assert.equal(scoreKeyword("best running shoes 2026").intent, "commercial");
  assert.equal(scoreKeyword("what is a running shoe drop").intent, "informational");
});

test("own-brand keywords are demoted and flagged", () => {
  const tokens = brandTokensFor("acmewidgets.co.uk");
  assert.deepEqual(tokens, ["acmewidgets"]);
  const branded = scoreKeyword("acmewidgets login", {}, {}, tokens);
  const generic = scoreKeyword("widgets login", {}, {}, tokens);
  assert.equal(branded.brand, true);
  assert.ok(branded.score < generic.score);
});

test("compound domains catch their leading brand piece without eating generic words", () => {
  const nobs = brandTokensFor("nobsroutines.com");
  assert.equal(isBrandQuery("nobs toothpaste", nobs), true);
  assert.equal(isBrandQuery("toothpaste tablets", nobs), false);
  const hq = brandTokensFor("toothpastehq.com");
  assert.equal(isBrandQuery("toothpaste tablets", hq), false);
  const bb = brandTokensFor("bestbuyonline.com");
  assert.equal(isBrandQuery("best toothpaste", bb), false);
});

test("rows are deduped per keyword, sorted by score, and flag boosts", () => {
  const rows = buildScoutRows([
    item("dentist near me", 7, { cpc: 9, intent: "transactional", volume: 5000 }),
    item("dentist near me", 12, { cpc: 9, intent: "transactional", volume: 5000 }),
    item("how to floss", 1, { intent: "informational", volume: 20000 }),
    item("teeth whitening cost", 44, { cpc: 4, intent: "commercial", volume: 800 }),
    item("dental implants", 61, { cpc: 15, intent: "transactional", volume: 3000 }),
  ], "brightsmiledental.com");
  assert.equal(rows.length, 4);
  assert.equal(rows[0].keyword, "dentist near me");
  assert.equal(rows[0].position, 7);
  assert.equal(rows[0].boost, true);
  const byName = Object.fromEntries(rows.map((r) => [r.keyword, r]));
  assert.equal(byName["how to floss"].boost, false);
  assert.equal(byName["teeth whitening cost"].boost, true);
  assert.equal(byName["dental implants"].boost, false);
  assert.equal(rows[rows.length - 1].keyword, "how to floss");
});

test("locations resolve to DataForSEO codes with a US default", () => {
  assert.equal(resolveLocation(undefined).location_code, 2840);
  assert.equal(resolveLocation("GB").location_code, 2826);
  assert.equal(resolveLocation("de").language_code, "de");
  assert.equal(resolveLocation("zz"), null);
});

test("scout endpoint refuses a wrong code and spends nothing", async () => {
  let fetched = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error("must not call"); };
  try {
    const response = await scoutPost({
      request: new Request("https://example.test/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "wrong", website_url: "example.com" }),
      }),
      env: { SCOUT_ACCESS_CODE: "right", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" },
    });
    assert.equal(response.status, 403);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("scout endpoint is a 503 until its access code secret exists", async () => {
  const response = await scoutPost({
    request: new Request("https://example.test/api/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "x", website_url: "example.com" }),
    }),
    env: {},
  });
  assert.equal(response.status, 503);
});

test("scout page is noindex, session-only, and never enters the funnel", async () => {
  const html = await readFile(new URL("../public/scout.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive" \/>/);
  assert.doesNotMatch(html, /meta\.js|fbq\(|wistia|calendly/i);
  const source = await readFile(new URL("../public/scout.js", import.meta.url), "utf8");
  assert.match(source, /sessionStorage\.getItem\("tsd_scout_code"\)/);
  assert.match(source, /sessionStorage\.setItem\("tsd_scout_code", code\)/);
  assert.doesNotMatch(source, /localStorage/);
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /\/scout\n\s+X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(headers, /\/scout\.html\n\s+X-Robots-Tag: noindex, nofollow, noarchive/);
});

test("scout results use boost status, sortable headers, and sticky table headings", async () => {
  const source = await readFile(new URL("../public/scout.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/scout.html", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Lookup cost/);
  assert.doesNotMatch(source, /<th[^>]*>Priority<\/th>/);
  for (const key of ["boost", "position", "volume", "cpc", "keyword"]) {
    assert.match(source, new RegExp('data-sort="' + key + '"'));
  }
  assert.match(source, /sc-boost/);
  assert.match(html, /position:\s*sticky/);
  assert.doesNotMatch(source, /sc-sort/);
});
