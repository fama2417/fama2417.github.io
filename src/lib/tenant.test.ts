import assert from "node:assert/strict";
import test from "node:test";
import { effectiveTenantId } from "./tenant.ts";

test("solo el superadmin usa la institución activa", () => {
  assert.equal(effectiveTenantId({ tenant_id: "base", active_tenant_id: "otra" }), "base");
  assert.equal(effectiveTenantId({ tenant_id: "base", platform: true }), "base");
  assert.equal(effectiveTenantId({ tenant_id: "base", active_tenant_id: "otra", platform: true }), "otra");
});
