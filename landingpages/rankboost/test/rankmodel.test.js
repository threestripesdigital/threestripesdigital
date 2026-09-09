import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThemes,
  moneyKeywordTest,
  normalizeDomain,
  projectKeywords,
} from "../functions/api/_rankmodel.js";

function item(keyword, position, volume) {
  return {
    keyword_data: { keyword, keyword_info: { search_volume: volume } },
    ranked_serp_element: { serp_item: { rank_absolute: position, url: "https://example.com/" + position } },
  };
}

test("money keyword filter rejects informational and branded queries", () => {
  const isMoney = moneyKeywordTest("acme-law.com");
  assert.equal(isMoney("divorce lawyer chicago"), true);
  assert.equal(isMoney("how long does divorce take"), false);
  assert.equal(isMoney("acme divorce lawyer"), false);
});

test("theme representative keeps rank, volume, and URL from one keyword", () => {
  const themes = buildThemes([
    item("divorce attorney chicago", 18, 900),
    item("divorce lawyer chicago", 12, 100),
  ]);
  assert.equal(themes.length, 1);
  assert.deepEqual(
    { keyword: themes[0].keyword, position: themes[0].position, volume: themes[0].volume, url: themes[0].url },
    { keyword: "divorce lawyer chicago", position: 12, volume: 100, url: "https://example.com/12" }
  );
});

test("qualification never falls back to non-money themes", () => {
  const themes = buildThemes([item("how long does divorce take", 12, 500)]);
  const result = projectKeywords("example.com", themes);
  assert.deepEqual(result.keywords, []);
  assert.deepEqual(result.displayThemes, []);
});

test("domain normalization accepts public hosts and rejects ambiguous targets", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path?q=1"), "example.com");
  assert.equal(normalizeDomain("example.com"), "example.com");
  assert.equal(normalizeDomain("https://user:pass@example.com"), "");
  assert.equal(normalizeDomain("https://example.com:8443"), "");
  assert.equal(normalizeDomain("http://127.0.0.1"), "");
  assert.equal(normalizeDomain("localhost"), "");
  assert.equal(normalizeDomain("javascript:alert(1)"), "");
});

test("page-one positions below number one remain eligible for the main offer", () => {
  for (let position = 2; position <= 10; position++) {
    assert.equal(projectKeywords("example.com", buildThemes([item("divorce lawyer chicago", position, 100)])).keywords.length, 1);
  }
});

test("provider request includes page one and retains volume and organic filters", async () => {
  const { fetchRankedKeywords } = await import("../functions/api/_rankmodel.js");
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => { request = JSON.parse(options.body)[0]; return Response.json({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }); };
  try {
    await fetchRankedKeywords({ DATAFORSEO_LOGIN: "test", DATAFORSEO_PASSWORD: "test" }, "example.com");
    assert.ok(request.filters.some(f => Array.isArray(f) && f[0].endsWith("rank_absolute") && f[1] === ">=" && f[2] === 1));
    assert.ok(request.filters.some(f => Array.isArray(f) && f[2] === "organic"));
    assert.ok(request.filters.some(f => Array.isArray(f) && f[0].endsWith("search_volume") && f[2] === 10));
  } finally { globalThis.fetch = original; }
});

 test("boost candidates exclude first and out-of-range ranks while keeping eligible variants", () => {
  assert.equal(projectKeywords("example.com", buildThemes([item("divorce lawyer chicago", 1, 100)])).keywords.length, 0);
  for (const position of [0, 51]) assert.equal(projectKeywords("example.com", buildThemes([item("divorce lawyer chicago", position, 100)])).keywords.length, 0);
  const result = projectKeywords("example.com", buildThemes([
    item("divorce lawyer chicago", 1, 1000), item("divorce attorney chicago", 2, 300),
    item("criminal lawyer chicago", 50, 100)
  ]));
  assert.deepEqual(result.keywords.map(k => k.position), [2, 50]);
  assert.equal(result.keywords[0].url, "https://example.com/2");
});
