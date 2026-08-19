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
