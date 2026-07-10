import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../../supabase/migrations/202607100001_critical_communication_report_scope.sql", import.meta.url);

test("la migración conserva legacy y vincula solo comunicaciones inequívocas", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /add column if not exists report_id uuid;/);
  assert.doesNotMatch(sql, /report_id uuid not null/i);
  assert.match(sql, /on delete set null/i);
  assert.doesNotMatch(sql, /report_communications_report_id_fkey[\s\S]*?on delete cascade/i);
  assert.match(sql, /c\.created_at >= r\.created_at/);
  assert.match(sql, /select count\(\*\)[\s\S]*?candidate\.appointment_id = c\.appointment_id/);
});

test("la base exige informe y cita compatibles y firma por el informe exacto", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const signatureSql = sql.slice(sql.indexOf("create or replace function private.protect_final_report"));
  assert.match(sql, /if new\.report_id is null[\s\S]*?tg_op = 'INSERT'[\s\S]*?raise exception/);
  assert.match(sql, /r\.id = new\.report_id[\s\S]*?r\.appointment_id = new\.appointment_id[\s\S]*?r\.tenant_id = new\.tenant_id/);
  assert.match(signatureSql, /c\.report_id = new\.id[\s\S]*?c\.urgency = 'critical' and c\.acknowledged/);
  assert.doesNotMatch(signatureSql, /c\.report_id is null/);
});

test("el repositorio lee y crea comunicaciones con report_id", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  const fetchSource = source.slice(source.indexOf("export async function fetchCommunications"), source.indexOf("export async function addCommunication"));
  const addSource = source.slice(source.indexOf("export async function addCommunication"), source.indexOf("type AddendumRow"));
  assert.match(fetchSource, /\.eq\("report_id", reportId\)/);
  assert.match(addSource, /insert\(\{ report_id: reportId, appointment_id: appointmentId, urgency: "critical"/);
});
