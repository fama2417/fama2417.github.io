import { supabase } from "@/lib/supabase-client";

export type ReportTemplate = {
  id: string;
  name: string;
  modality: string;
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  active: boolean;
};

const columns = "id, name, modality, technique, comparison, findings, impression, active";

export async function fetchTemplates() {
  const { data, error } = await supabase.from("report_templates").select(columns).order("modality").order("name");
  if (error) throw error;
  return data as ReportTemplate[];
}

export async function createTemplate(template: Omit<ReportTemplate, "id">) {
  const { data, error } = await supabase.from("report_templates").insert(template).select(columns).single();
  if (error) throw error;
  return data as ReportTemplate;
}

export async function updateTemplate(template: ReportTemplate) {
  const { id, ...fields } = template;
  const { error } = await supabase.from("report_templates").update(fields).eq("id", id);
  if (error) throw error;
}
