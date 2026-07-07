import { supabase } from "@/lib/supabase-client";

export const CATALOG_CATEGORIES = {
  sucursal: "Sucursales",
  servicio: "Servicios",
  especialidad: "Especialidades",
  profesional: "Profesionales",
  sala: "Salas / equipos",
  prestacion: "Prestaciones",
  etiqueta: "Etiquetas de cita",
  prevision: "Previsiones",
} as const;

export type CatalogCategory = keyof typeof CATALOG_CATEGORIES;

export type CatalogItem = {
  id: string;
  category: CatalogCategory;
  code: string;
  label: string;
  active: boolean;
  sort: number;
  durationMin?: number | null;
};

const columns = "id, category, code, label, active, sort, duration_min";
const fromRow = ({ duration_min, ...row }: Record<string, unknown>) => ({ ...row, durationMin: duration_min }) as CatalogItem;

export async function fetchCatalog() {
  const { data, error } = await supabase.from("catalog_items").select(columns).order("category").order("sort").order("label");
  if (error) throw error;
  return data.map(fromRow);
}

export async function createCatalogItem(item: Omit<CatalogItem, "id">) {
  const row = { category: item.category, code: item.code, label: item.label, active: item.active, sort: item.sort, duration_min: item.durationMin ?? null };
  const { data, error } = await supabase.from("catalog_items").insert(row).select(columns).single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateCatalogItem(item: CatalogItem) {
  const { error } = await supabase.from("catalog_items").update({ code: item.code, label: item.label, active: item.active, sort: item.sort, duration_min: item.durationMin ?? null }).eq("id", item.id);
  if (error) throw error;
}

/** Opciones activas de una categoría, listas para un <select>. */
export const activeOptions = (catalog: CatalogItem[], category: CatalogCategory) =>
  catalog.filter((item) => item.category === category && item.active);
