import assert from "node:assert/strict";
import test from "node:test";
import { countReviewedFindings, dedupeFindings, visibleFindings } from "./finding-display.ts";

type F = Parameters<typeof visibleFindings>[0][number];
const finding = (overrides: Partial<F>): F => ({
  reportId: "r1", normalizedText: "nodulo pulmonar", status: "present", codingStatus: "suggested",
  createdAt: "2026-07-01T10:00:00Z", exam: { reportStatus: "final" }, ...overrides,
});

test("rechazados nunca se muestran, para ningún rol", () => {
  const rejected = [finding({ codingStatus: "rejected" })];
  assert.equal(visibleFindings(rejected, true).length, 0);
  assert.equal(visibleFindings(rejected, false).length, 0);
});

test("suggested no es visible para operator", () => {
  assert.equal(visibleFindings([finding({ codingStatus: "suggested" })], false).length, 0);
});

test("suggested es visible para admin/radiologist", () => {
  assert.equal(visibleFindings([finding({ codingStatus: "suggested" })], true).length, 1);
  assert.equal(visibleFindings([finding({ codingStatus: "suggested", exam: { reportStatus: "draft" } })], true).length, 1);
});

test("operator solo ve confirmed/corrected de informes finales", () => {
  const items = [
    finding({ codingStatus: "confirmed", exam: { reportStatus: "final" } }),
    finding({ codingStatus: "corrected", exam: { reportStatus: "final" }, normalizedText: "otro" }),
    finding({ codingStatus: "confirmed", exam: { reportStatus: "draft" } }),
    finding({ codingStatus: "suggested", exam: { reportStatus: "final" }, normalizedText: "tercero" }),
    finding({ codingStatus: "confirmed", exam: {} }),
  ];
  const visible = visibleFindings(items, false);
  assert.equal(visible.length, 2);
  assert.ok(visible.every((item) => item.exam.reportStatus === "final"));
});

test("dedupe prefiere confirmed/corrected sobre suggested", () => {
  const kept = dedupeFindings([
    finding({ codingStatus: "suggested", createdAt: "2026-07-05T10:00:00Z" }),
    finding({ codingStatus: "confirmed", createdAt: "2026-07-01T10:00:00Z" }),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].codingStatus, "confirmed");
});

test("dedupe prefiere el más reciente a igual estado de revisión", () => {
  const kept = dedupeFindings([
    finding({ codingStatus: "suggested", createdAt: "2026-07-01T10:00:00Z" }),
    finding({ codingStatus: "suggested", createdAt: "2026-07-03T10:00:00Z" }),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].createdAt, "2026-07-03T10:00:00Z");
});

test("polaridad distinta del mismo texto no es duplicado: absent se conserva aparte", () => {
  const kept = dedupeFindings([
    finding({ status: "present" }),
    finding({ status: "absent" }),
  ]);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((item) => item.status === "absent"));
});

test("hallazgos revisados cuenta solo confirmed/corrected", () => {
  assert.equal(countReviewedFindings([
    { codingStatus: "confirmed" }, { codingStatus: "corrected" }, { codingStatus: "suggested" }, { codingStatus: "not_required" },
  ]), 2);
  assert.equal(countReviewedFindings([]), 0);
});
