"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CATALOG_CATEGORIES, createCatalogItem, fetchCatalog, updateCatalogItem, type CatalogCategory, type CatalogItem } from "./repository";

export function CatalogManager() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [category, setCategory] = useState<CatalogCategory>("profesional");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCatalog().then(setCatalog).catch(() => setError("No fue posible cargar los catálogos.")).finally(() => setLoading(false)); }, []);

  const items = useMemo(() => catalog.filter((item) => item.category === category), [catalog, category]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const label = String(form.get("label")).trim();
    if (!label) return;
    try {
      const durationMin = category === "prestacion" ? Number(form.get("duration")) || 30 : undefined;
      const item = await createCatalogItem({ category, code: String(form.get("code")).trim(), label, active: true, sort: items.length + 1, durationMin });
      setCatalog((current) => [...current, item]);
      formElement.reset();
      setError("");
    } catch {
      setError("No fue posible guardar. Revisa que el valor no exista y que tu perfil tenga permisos.");
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editing.label.trim()) return;
    try {
      await updateCatalogItem(editing);
      setCatalog((current) => current.map((entry) => entry.id === editing.id ? editing : entry));
      setEditing(null);
      setError("");
    } catch {
      setError("No fue posible guardar la corrección.");
    }
  }

  async function toggleItem(item: CatalogItem) {
    const next = { ...item, active: !item.active };
    try {
      await updateCatalogItem(next);
      setCatalog((current) => current.map((entry) => entry.id === item.id ? next : entry));
    } catch {
      setError("No fue posible actualizar el valor.");
    }
  }

  return (
    <section className="card" aria-label="Parámetros de la agenda">
      <div className="card-heading"><h3>Otros parámetros</h3><span className="phase-state">Autoservicio</span></div>
      <p>Profesionales, etiquetas y previsiones siguen siendo catálogos simples. La oferta clínica se administra arriba.</p>
      <div className="catalog-layout">
        <nav className="catalog-tabs" aria-label="Categorías">
          {Object.entries(CATALOG_CATEGORIES).filter(([value]) => ["profesional", "etiqueta", "prevision"].includes(value)).map(([value, label]) => (
            <button key={value} type="button" className={value === category ? "active" : ""} onClick={() => setCategory(value as CatalogCategory)}>{label}</button>
          ))}
        </nav>
        <div>
          <form className="catalog-form" onSubmit={addItem}>
            <label>Código (opcional)<input name="code" placeholder="Ej: 04.04.001.101" /></label>
            <label>Nombre<input name="label" required placeholder={`Nueva opción de ${CATALOG_CATEGORIES[category].toLowerCase()}`} /></label>
            {category === "prestacion" && <label>Duración (min)<input name="duration" type="number" min="5" step="5" defaultValue={30} /></label>}
            <button className="button primary" type="submit">Agregar</button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
          <ul className="catalog-list">
            {items.map((item) => (
              <li key={item.id} className={item.active ? "" : "inactive"}>
                {editing?.id === item.id
                  ? <form className="catalog-form" onSubmit={saveEdit}>
                      <label>Código<input value={editing.code} onChange={(event) => setEditing({ ...editing, code: event.target.value })} /></label>
                      <label>Nombre<input value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} required /></label>
                      {editing.category === "prestacion" && <label>Duración (min)<input type="number" min="5" step="5" value={editing.durationMin ?? 30} onChange={(event) => setEditing({ ...editing, durationMin: Number(event.target.value) || 30 })} /></label>}
                      <button className="button primary" type="submit">Guardar</button>
                      <button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
                    </form>
                  : <>
                      <span>{item.code && <code>{item.code}</code>} {item.label}{item.category === "prestacion" && <small className="empty-inline"> · {item.durationMin ?? 30} min</small>}</span>
                      <span>
                        {item.category === "profesional" && <button className="text-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("schedule-target", { detail: { kind: "practitioner", name: item.label } }))}>Horario semanal</button>}
                        <button className="text-button" type="button" onClick={() => setEditing(item)}>Editar</button>
                        <button className="text-button" type="button" onClick={() => toggleItem(item)}>{item.active ? "Desactivar" : "Activar"}</button>
                      </span>
                    </>}
              </li>
            ))}
            {!loading && !items.length && <li className="inactive"><span>Sin valores. Agrega el primero.</span></li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
