import assert from "node:assert/strict";
import test from "node:test";
import { canRunAiExtraction } from "./ai-budget.ts";

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
