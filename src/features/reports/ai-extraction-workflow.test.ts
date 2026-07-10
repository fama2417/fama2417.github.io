import assert from "node:assert/strict";
import test from "node:test";
import { isAiOperationActive, runAiExtractionWorkflow, type AiOperationState } from "./ai-extraction-workflow.ts";

test("guarda antes de analizar y refrescar", async () => {
  const calls: string[] = [];
  const states: AiOperationState[] = [];
  const result = await runAiExtractionWorkflow({
    saveDraft: async () => { calls.push("save"); },
    analyze: async () => { calls.push("analyze"); },
    refresh: async () => { calls.push("refresh"); return "updated"; },
  }, (state) => states.push(state));
  assert.deepEqual(calls, ["save", "analyze", "refresh"]);
  assert.deepEqual(states, ["saving", "analyzing", "refreshing", "success"]);
  assert.deepEqual(result, { ok: true, value: "updated" });
});

test("un fallo de guardado impide iniciar el análisis", async () => {
  let analyzed = false;
  const states: AiOperationState[] = [];
  const result = await runAiExtractionWorkflow({
    saveDraft: async () => { throw new Error("save failed"); },
    analyze: async () => { analyzed = true; },
    refresh: async () => "unused",
  }, (state) => states.push(state));
  assert.equal(analyzed, false);
  assert.deepEqual(states, ["saving", "error"]);
  assert.deepEqual(result, { ok: false, phase: "saving" });
});

test("un fallo de análisis conserva el flujo en error sin refrescar", async () => {
  let refreshed = false;
  const states: AiOperationState[] = [];
  const result = await runAiExtractionWorkflow({
    saveDraft: async () => undefined,
    analyze: async () => { throw new Error("analysis failed"); },
    refresh: async () => { refreshed = true; return "unused"; },
  }, (state) => states.push(state));
  assert.equal(refreshed, false);
  assert.deepEqual(states, ["saving", "analyzing", "error"]);
  assert.deepEqual(result, { ok: false, phase: "analysis" });
});

test("solo los estados operativos bloquean acciones concurrentes", () => {
  assert.equal(isAiOperationActive("idle"), false);
  assert.equal(isAiOperationActive("saving"), true);
  assert.equal(isAiOperationActive("analyzing"), true);
  assert.equal(isAiOperationActive("refreshing"), true);
  assert.equal(isAiOperationActive("success"), false);
  assert.equal(isAiOperationActive("error"), false);
});
