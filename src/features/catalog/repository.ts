import { supabase } from "@/lib/supabase-client";

export const CATALOG_CATEGORIES = {
  sucursal: "Sucursales",
  servicio: "Servicios",
  especialidad: "Especialidades",
  profesional: "Profesionales",
  sala: "Salas / equipos",
  prestacion: "Prestaciones",
  etiqueta: "Etiquetas de cita",
} as const;

export type CatalogCategory = keyof typeof CATALOG_CATEGORIES;

export type CatalogItem = {
  id: string;
  category: CatalogCategory;
  code: string;
  label: string;
  active: boolean;
  sort: number;
};

const columns = "id, category, code, label, active, sort";

export async function fetchCatalog() {
  const { data, error } = await supabase.from("catalog_items").select(columns).order("category").order("sort").order("label");
  if (error) throw error;
  return data as CatalogItem[];
}

export async function createCatalogItem(item: Omit<CatalogItem, "id">) {
  const { data, error } = await supabase.from("catalog_items").insert(item).select(columns).single();
  if (error) throw error;
  return data as CatalogItem;
}

export async function updateCatalogItem(item: CatalogItem) {
  const { error } = await supabase.from("catalog_items").update({ code: item.code, label: item.label, active: item.active, sort: item.sort }).eq("id", item.id);
  if (error) throw error;
}

/** Opciones activas de una categoría, listas para un <select>. */
export const activeOptions = (catalog: CatalogItem[], category: CatalogCategory) =>
  catalog.filter((item) => item.category === category && item.active);
