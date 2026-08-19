import test from "node:test";
import assert from "node:assert/strict";

import {
  bearerToken,
  createLeadToken,
  fromTrustedRouter,
  verifyLeadToken,
} from "../functions/api/_security.js";

test("lead attribution token verifies before expiry", async () => {
  const token = await createLeadToken("test-secret", "lead-ref", 60, 1_000_000);
  assert.deepEqual(await verifyLeadToken("test-secret", token, 1_030_000), {
    ref: "lead-ref",
    exp: 1060,
  });
});

test("lead attribution token rejects tampering and expiry", async () => {
  const token = await createLeadToken("test-secret", "lead-ref", 60, 1_000_000);
  assert.equal(await verifyLeadToken("test-secret", token + "x", 1_030_000), null);
  assert.equal(await verifyLeadToken("test-secret", token, 1_061_000), null);
});

test("router and admin credentials are read from headers", () => {
  const request = new Request("https://example.test/", {
    headers: {
      Authorization: "Bearer admin-secret",
      "X-Router-Token": "router-secret",
    },
  });
  assert.equal(bearerToken(request), "admin-secret");
  assert.equal(fromTrustedRouter(request, { ROUTER_TOKEN: "router-secret" }), true);
  assert.equal(fromTrustedRouter(request, { ROUTER_TOKEN: "wrong" }), false);
  assert.equal(fromTrustedRouter(request, {}), false);
});
