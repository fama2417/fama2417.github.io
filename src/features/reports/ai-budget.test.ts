import assert from "node:assert/strict";
import test from "node:test";
import { aiConfig, canRunAiExtraction } from "./ai-budget.ts";

const supabase = {} as never;

test("bloquea extraccion si AI_EXTRACTION_ENABLED no es true", async () => {
  const before = process.env.AI_EXTRACTION_ENABLED;
  process.env.AI_EXTRACTION_ENABLED = "false";
  const result = await canRunAiExtraction({ tenantId: "t", reportId: "r", supabase });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "AI extraction disabled");
  process.env.AI_EXTRACTION_ENABLED = before;
});

test("bloquea extraccion si falta OPENAI_API_KEY", async () => {
  const beforeEnabled = process.env.AI_EXTRACTION_ENABLED;
  const beforeKey = process.env.OPENAI_API_KEY;
  process.env.AI_EXTRACTION_ENABLED = "true";
  delete process.env.OPENAI_API_KEY;
  const result = await canRunAiExtraction({ tenantId: "t", reportId: "r", supabase });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "Missing OPENAI_API_KEY");
  process.env.AI_EXTRACTION_ENABLED = beforeEnabled;
  if (beforeKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = beforeKey;
});

test("usa minimos seguros para salida y timeout de IA", () => {
  const beforeOutput = process.env.AI_MAX_OUTPUT_TOKENS;
  const beforeTimeout = process.env.AI_TIMEOUT_MS;
  process.env.AI_MAX_OUTPUT_TOKENS = "1200";
  process.env.AI_TIMEOUT_MS = "25000";
  assert.equal(aiConfig().maxOutputTokens, 4000);
  assert.equal(aiConfig().timeoutMs, 45000);
  if (beforeOutput === undefined) delete process.env.AI_MAX_OUTPUT_TOKENS; else process.env.AI_MAX_OUTPUT_TOKENS = beforeOutput;
  if (beforeTimeout === undefined) delete process.env.AI_TIMEOUT_MS; else process.env.AI_TIMEOUT_MS = beforeTimeout;
});

test("habilita IA en Render si existe OPENAI_API_KEY", () => {
  const beforeEnabled = process.env.AI_EXTRACTION_ENABLED;
  const beforeRender = process.env.RENDER;
  const beforeKey = process.env.OPENAI_API_KEY;
  process.env.AI_EXTRACTION_ENABLED = "false";
  process.env.RENDER = "true";
  process.env.OPENAI_API_KEY = "test-key";
  assert.equal(aiConfig().enabled, true);
  if (beforeEnabled === undefined) delete process.env.AI_EXTRACTION_ENABLED; else process.env.AI_EXTRACTION_ENABLED = beforeEnabled;
  if (beforeRender === undefined) delete process.env.RENDER; else process.env.RENDER = beforeRender;
  if (beforeKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = beforeKey;
});
