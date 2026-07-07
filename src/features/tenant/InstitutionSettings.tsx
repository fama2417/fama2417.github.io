"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { fetchMyTenant, HEADER_VARIABLES, renderHeader, updateTenant, uploadLogo, type Tenant } from "./repository";

const variableLabels: Record<(typeof HEADER_VARIABLES)[number], string> = { paciente: "Paciente", id: "Identificador", medico: "Médico", examen: "Examen", fecha: "Fecha", institucion: "Institución" };
const simpleHeader = "Paciente: {{paciente}} · ID: {{id}}\nExamen: {{examen}} · Fecha: {{fecha}}\nMédico solicitante: {{medico}}";

export function InstitutionSettings() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const headerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { fetchMyTenant().then(setTenant).catch(() => setError("No fue posible cargar la institución.")); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    setError("");
    setNotice("");
    try {
      await updateTenant(tenant);
      setNotice("Datos de la institución guardados.");
    } catch {
      setError("No fue posible guardar. Solo administradores pueden editar la institución.");
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !tenant) return;
    setError("");
    try {
      const logoUrl = await uploadLogo(tenant.id, file);
      setTenant({ ...tenant, logoUrl });
      setNotice("Logo subido. Guarda para confirmar.");
    } catch {
      setError("No fue posible subir el logo.");
    }
  }

  function insertVariable(name: (typeof HEADER_VARIABLES)[number]) {
    if (!tenant) return;
    const token = `{{${name}}}`;
    const start = headerRef.current?.selectionStart ?? tenant.reportHeader.length;
    const end = headerRef.current?.selectionEnd ?? start;
    const reportHeader = tenant.reportHeader.slice(0, start) + token + tenant.reportHeader.slice(end);
    setTenant({ ...tenant, reportHeader });
    requestAnimationFrame(() => { headerRef.current?.focus(); headerRef.current?.setSelectionRange(start + token.length, start + token.length); });
  }

  if (!tenant) return error ? <section className="card"><p className="form-error" role="alert">{error}</p></section> : null;

  return (
    <section className="card" aria-label="Datos de la institución">
      <div className="card-heading"><h3>Institución</h3>{tenant.logoUrl && <img src={tenant.logoUrl} alt="Logo institucional" style={{ height: 40 }} />}</div>
      <p>Estos datos encabezan el informe radiológico impreso.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <form className="clinical-form" onSubmit={save}>
        <label>Nombre<input value={tenant.name} onChange={(event) => setTenant({ ...tenant, name: event.target.value })} required /></label>
        <label>RUT<input value={tenant.rut} onChange={(event) => setTenant({ ...tenant, rut: event.target.value })} /></label>
        <label>Dirección<input value={tenant.address} onChange={(event) => setTenant({ ...tenant, address: event.target.value })} /></label>
        <label>Teléfono<input value={tenant.phone} onChange={(event) => setTenant({ ...tenant, phone: event.target.value })} /></label>
        <label>Logo (PNG/JPG)<input type="file" accept="image/*" onChange={(event) => pickLogo(event.target.files?.[0])} /></label>
        <label>Institución PACS<input value={tenant.pacsInstitution} onChange={(event) => setTenant({ ...tenant, pacsInstitution: event.target.value })} placeholder="Valor DICOM InstitutionName" /><span className="empty-inline">Separa los estudios entrantes de cada cliente para FixUp.</span></label>
        <div className="span-2 template-builder">
          <div className="card-heading"><strong>Encabezado del informe</strong><button className="text-button" type="button" onClick={() => setTenant({ ...tenant, reportHeader: simpleHeader })}>Usar formato simple</button></div>
          <p>Escribe texto normal e inserta datos del informe con un clic.</p>
          <div className="preset-row" aria-label="Datos disponibles">{HEADER_VARIABLES.map((name) => <button className="tag" type="button" key={name} onClick={() => insertVariable(name)}>+ {variableLabels[name]}</button>)}</div>
          <textarea ref={headerRef} value={tenant.reportHeader} onChange={(event) => setTenant({ ...tenant, reportHeader: event.target.value })} placeholder="Ej.: Paciente: [inserta Paciente]" />
          <aside className="template-preview"><strong>Vista previa</strong><p>{renderHeader(tenant.reportHeader || simpleHeader, { paciente: "María González", id: "12.345.678-9", medico: "Dra. Pérez", examen: "TC de tórax", fecha: new Date().toLocaleDateString("es-CL"), institucion: tenant.name }).split("\n").map((line, index) => <span key={index}>{line}<br /></span>)}</p></aside>
        </div>
        <button className="button primary" type="submit">Guardar institución</button>
      </form>
    </section>
  );
}
