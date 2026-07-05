import assert from "node:assert/strict";
import test from "node:test";

process.env.CRON_SECRET = "clave-de-prueba";
const { signPacsCookie, verifyPacsCookie } = await import("./auth.ts");

test("acepta cookie firmada vigente y rechaza vencida, adulterada o vacía", () => {
  const valid = signPacsCookie(Date.now() + 60_000);
  assert.equal(verifyPacsCookie(valid), true);
  assert.equal(verifyPacsCookie(signPacsCookie(Date.now() - 1_000)), false);
  assert.equal(verifyPacsCookie(`${Date.now() + 60_000}.${"0".repeat(64)}`), false);
  assert.equal(verifyPacsCookie(undefined), false);
});
