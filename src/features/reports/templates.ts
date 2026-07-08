import { supabase } from "@/lib/supabase-client";

export type ReportTemplate = {
  id: string;
  name: string;
  category: "consultation" | "imaging" | "laboratory" | "pathology" | "procedure";
  modality: string;
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  active: boolean;
};

const columns = "id, name, category, modality, technique, comparison, findings, impression, active";
const legacyColumns = "id, name, modality, technique, comparison, findings, impression, active";

const mapTemplate = (item: Partial<ReportTemplate>): ReportTemplate => ({ category: "imaging", ...item } as ReportTemplate);

export async function fetchTemplates() {
  const { data, error } = await supabase.from("report_templates").select(columns).order("modality").order("name");
  if (error && error.message.includes("category")) {
    const fallback = await supabase.from("report_templates").select(legacyColumns).order("modality").order("name");
    if (fallback.error) throw fallback.error;
    return (fallback.data as Partial<ReportTemplate>[]).map(mapTemplate);
  }
  if (error) throw error;
  return (data as Partial<ReportTemplate>[]).map(mapTemplate);
}

export async function createTemplate(template: Omit<ReportTemplate, "id">) {
  const { data, error } = await supabase.from("report_templates").insert(template).select(columns).single();
  if (error && error.message.includes("category")) {
    const { category, ...legacy } = template;
    void category;
    const fallback = await supabase.from("report_templates").insert(legacy).select(legacyColumns).single();
    if (fallback.error) throw fallback.error;
    return mapTemplate(fallback.data as Partial<ReportTemplate>);
  }
  if (error) throw error;
  return mapTemplate(data as Partial<ReportTemplate>);
}

export async function updateTemplate(template: ReportTemplate) {
  const { id, ...fields } = template;
  const { error } = await supabase.from("report_templates").update(fields).eq("id", id);
  if (error && error.message.includes("category")) {
    const { category, ...legacy } = fields;
    void category;
    const fallback = await supabase.from("report_templates").update(legacy).eq("id", id);
    if (fallback.error) throw fallback.error;
    return;
  }
  if (error) throw error;
}
