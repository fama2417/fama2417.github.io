import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? ""; // usuario:clave
const cronSecret = process.env.CRON_SECRET ?? "";

type OrthancStudy = { ID: string; MainDicomTags: { StudyInstanceUID: string; StudyDate?: string }; PatientMainDicomTags: { PatientID?: string } };

// Igual que la columna generada patients.identifier_key
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const isoDate = (dicomDate: string) => `${dicomDate.slice(0, 4)}-${dicomDate.slice(4, 6)}-${dicomDate.slice(6, 8)}`;
const dicomDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

/** Empareja estudios recientes de Orthanc con citas por ID de paciente + fecha y los registra en imaging_studies. */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceKey || !orthancUrl || !orthancCreds || !cronSecret) return NextResponse.json({ error: "Faltan variables de entorno (ORTHANC_URL, ORTHANC_CREDS, CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY)." }, { status: 501 });
  if (request.headers.get("x-cron-secret") !== cronSecret) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const since = new Date();
  since.setDate(since.getDate() - 7); // ponytail: ventana fija de 7 días; ampliar si se cargan estudios antiguos
  const findResponse = await fetch(`${orthancUrl}/tools/find`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ Level: "Study", Expand: true, Query: { StudyDate: `${dicomDate(since)}-${dicomDate(new Date())}` } }),
  });
  if (!findResponse.ok) return NextResponse.json({ error: `Orthanc respondió ${findResponse.status}.` }, { status: 502 });
  const studies = (await findResponse.json()) as OrthancStudy[];
  if (!studies.length) return NextResponse.json({ scanned: 0, linked: 0 });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const uids = studies.map((study) => study.MainDicomTags.StudyInstanceUID);
  const { data: existing } = await admin.from("imaging_studies").select("study_instance_uid").in("study_instance_uid", uids);
  const linkedUids = new Set((existing ?? []).map((row) => row.study_instance_uid));

  let linked = 0;
  const detail: string[] = [];
  for (const study of studies) {
    const uid = study.MainDicomTags.StudyInstanceUID;
    const patientId = study.PatientMainDicomTags.PatientID ?? "";
    const studyDate = study.MainDicomTags.StudyDate ?? "";
    if (linkedUids.has(uid) || !patientId || studyDate.length !== 8) continue;

    const { data: patients } = await admin.from("patients").select("id").eq("identifier_key", normalize(patientId));
    if (!patients?.length) continue;

    const { data: appointments } = await admin.from("appointments")
      .select("id, tenant_id, study:imaging_studies(appointment_id)")
      .in("patient_id", patients.map((patient) => patient.id))
      .eq("appointment_date", isoDate(studyDate))
      .not("status", "in", "(cancelled,no_show)")
      .order("start_time");
    const target = (appointments ?? []).find((appointment) => !appointment.study);
    if (!target) continue;

    const { error } = await admin.from("imaging_studies").insert({ appointment_id: target.id, orthanc_study_id: study.ID, study_instance_uid: uid, tenant_id: target.tenant_id });
    if (!error) {
      linked += 1;
      detail.push(`${patientId} ${isoDate(studyDate)}`);
    }
  }
  return NextResponse.json({ scanned: studies.length, linked, detail });
}
