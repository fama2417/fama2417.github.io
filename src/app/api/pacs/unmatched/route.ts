import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dicomTimeRange, mapOrthancStudy, type OrthancStudy } from "@/lib/orthanc";
import { effectiveTenantId } from "@/lib/tenant";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";
const modalities = new Set(["US", "DX", "CT", "MR", "MG"]);

async function context(request: NextRequest) {
  if (!supabaseUrl || !serviceKey || !orthancUrl || !orthancCreds) return { error: NextResponse.json({ error: "Falta configuración del servidor." }, { status: 501 }) };
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return { error: NextResponse.json({ error: "Sesión inválida." }, { status: 401 }) };
  const { data: profile } = await admin.from("profiles").select("role, platform, tenant_id, active_tenant_id").eq("id", caller.user.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores." }, { status: 403 }) };
  const tenantId = effectiveTenantId(profile);
  const { data: tenant } = await admin.from("tenants").select("pacs_institution").eq("id", tenantId).single();
  return { admin, callerId: caller.user.id, tenantId, pacsInstitution: tenant?.pacs_institution?.trim() ?? "" };
}

const orthanc = (path: string) => fetch(`${orthancUrl}${path}`, { headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}` } });
const sameInstitution = (left: string, right: string) => left.trim().toLocaleLowerCase("es-CL") === right.trim().toLocaleLowerCase("es-CL");

export async function GET(request: NextRequest) {
  const auth = await context(request);
  if ("error" in auth) return auth.error;
  if (!auth.pacsInstitution) return NextResponse.json({ error: "Configura la Institución PACS antes de revisar estudios sin vincular." }, { status: 409 });

  const [upstream, linked] = await Promise.all([orthanc("/studies?expand"), auth.admin.from("imaging_studies").select("orthanc_study_id, study_instance_uid")]);
  if (!upstream.ok) return NextResponse.json({ error: `PACS no disponible (${upstream.status}).` }, { status: 502 });
  if (linked.error) return NextResponse.json({ error: linked.error.message }, { status: 500 });
  const used = new Set((linked.data ?? []).flatMap((row) => [row.orthanc_study_id, row.study_instance_uid].filter(Boolean)));
  // ponytail: se revisan los últimos 100; paginar cuando un PACS mantenga más estudios sin vincular.
  const studies = ((await upstream.json()) as OrthancStudy[]).map(mapOrthancStudy)
    .filter((study) => study.studyInstanceUid && sameInstitution(study.institution, auth.pacsInstitution) && !used.has(study.id) && !used.has(study.studyInstanceUid))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  return NextResponse.json({ configured: true, filtered: true, studies });
}

export async function POST(request: NextRequest) {
  const auth = await context(request);
  if ("error" in auth) return auth.error;
  if (!auth.pacsInstitution) return NextResponse.json({ error: "Configura la Institución PACS antes de vincular estudios." }, { status: 409 });
  const { studyId, appointmentId, patientId } = await request.json().catch(() => ({}));
  if (typeof studyId !== "string" || (!appointmentId && !patientId)) return NextResponse.json({ error: "Selecciona un estudio y una cita o paciente." }, { status: 400 });

  const upstream = await orthanc(`/studies/${encodeURIComponent(studyId)}`);
  if (!upstream.ok) return NextResponse.json({ error: "Estudio PACS inexistente." }, { status: 404 });
  const raw = await upstream.json() as OrthancStudy;
  const study = mapOrthancStudy(raw);
  if (!study.studyInstanceUid || !sameInstitution(study.institution, auth.pacsInstitution)) return NextResponse.json({ error: "El estudio no pertenece a la institución activa." }, { status: 403 });
  if ((await auth.admin.from("imaging_studies").select("id").or(`orthanc_study_id.eq.${study.id},study_instance_uid.eq.${study.studyInstanceUid}`).maybeSingle()).data) return NextResponse.json({ error: "El estudio ya está vinculado." }, { status: 409 });

  let targetAppointmentId = typeof appointmentId === "string" ? appointmentId : "";
  let createdAppointment = false;
  if (targetAppointmentId) {
    const appointment = await auth.admin.from("appointments").select("id, study:imaging_studies(id)").eq("id", targetAppointmentId).eq("tenant_id", auth.tenantId).maybeSingle();
    if (!appointment.data || appointment.data.study) return NextResponse.json({ error: "La cita no existe o ya tiene imágenes." }, { status: 400 });
  } else {
    const patient = await auth.admin.from("patients").select("id").eq("id", patientId).eq("tenant_id", auth.tenantId).maybeSingle();
    if (!patient.data) return NextResponse.json({ error: "Paciente inexistente." }, { status: 404 });
    if (!modalities.has(study.modality)) return NextResponse.json({ error: `La modalidad ${study.modality} requiere crear la cita manualmente antes de vincular.` }, { status: 400 });
    const [start, end] = dicomTimeRange(raw.MainDicomTags?.StudyTime);
    const appointment = await auth.admin.from("appointments").insert({ tenant_id: auth.tenantId, patient_id: patientId, appointment_date: study.date, start_time: start, end_time: end, practitioner_name: raw.MainDicomTags?.ReferringPhysicianName?.replaceAll("^", " ") || "Sin informar", location_name: raw.MainDicomTags?.StationName || "PACS", modality: study.modality, reason: study.description, status: "completed", origin_type: "externa", origin_desc: "PACS / ORM", created_by: auth.callerId }).select("id").single();
    if (appointment.error) return NextResponse.json({ error: appointment.error.message }, { status: 400 });
    targetAppointmentId = appointment.data.id; createdAppointment = true;
  }

  const link = await auth.admin.from("imaging_studies").insert({ tenant_id: auth.tenantId, appointment_id: targetAppointmentId, orthanc_study_id: study.id, study_instance_uid: study.studyInstanceUid });
  if (link.error) {
    if (createdAppointment) await auth.admin.from("appointments").delete().eq("id", targetAppointmentId);
    return NextResponse.json({ error: link.error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, appointmentId: targetAppointmentId });
}
