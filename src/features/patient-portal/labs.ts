import { convertLabValue, labFlag, parseLabNumber, parseLabReference, type LabFlag, type LoincMetadata } from "../reports/lab-observations.ts";

export type PhrLabResult = {
  id: string; documentId: string; analyte: string; loincCode: string; valueNum: number | null; valueText: string;
  unit: string; refLow: number | null; refHigh: number | null; refText: string; flag: LabFlag; observedAt: string;
  source: "ocr" | "ai"; sourceSentence?: string; reviewStatus: "suggested" | "confirmed"; loincMetadata?: LoincMetadata;
  canonicalAnalyte?: string; suggestedLoincCode?: string; codingConfidence?: number | null;
};

export type PhrLabDraft = { analyte: string; value: string; unit: string; reference: string; observedAt: string };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const term = (value: string) => plain(value).replace(/[^a-z0-9]+/g, " ").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const firstValidPhrLabDate = (values: string[]) => values.find(validDate) ?? "";

const unitKey = (value = "") => plain(value)
  .replace(/[µμ]/g, "u")
  .replace(/\bgr\b/g, "g")
  .replace(/[^a-z0-9%/^*]+/g, "")
  .replace(/^meg\/l$/, "meq/l");

// Equivalencias locales verificadas contra las seis partes LOINC. Se aplican sólo
// cuando nombre y unidad identifican una observación individual inequívoca.
const vettedLoinc: ReadonlyArray<{ names: RegExp; units?: RegExp; code: string; trendKey: string }> = [
  { names: /^(?:glicemia|glucosa) basal$/, units: /^mg\/dl$/, code: "1558-6", trendKey: "fasting-glucose" },
  { names: /^(?:glicemia|glucosa) (?:60 min|1 h|1 hora)$/, units: /^mg\/dl$/, code: "20438-8", trendKey: "glucose-60-min" },
  { names: /^(?:glicemia|glucosa) (?:120 min|2 h|2 horas)$/, units: /^mg\/dl$/, code: "20436-2", trendKey: "glucose-120-min" },
  { names: /^(?:glicemia|glucosa)$/, units: /^(?:mg\/dl|g\/l)$/, code: "2345-7", trendKey: "blood-glucose" },
  { names: /^(?:acido urico|uricemia)$/, units: /^mg\/dl$/, code: "3084-1", trendKey: "uric-acid" },
  { names: /^(?:bilirrubina|bilurrubina) total$/, units: /^mg\/dl$/, code: "1975-2", trendKey: "total-bilirubin" },
  { names: /^bilirrubina directa$/, units: /^mg\/dl$/, code: "1968-7", trendKey: "direct-bilirubin" },
  { names: /^calcio$/, units: /^mg\/dl$/, code: "17861-6", trendKey: "calcium" },
  { names: /^colesterol total$/, units: /^mg\/dl$/, code: "2093-3", trendKey: "total-cholesterol" },
  { names: /^colesterol hdl$/, units: /^mg\/dl$/, code: "2085-9", trendKey: "hdl-cholesterol" },
  { names: /^colesterol ldl$/, units: /^mg\/dl$/, code: "2089-1", trendKey: "ldl-cholesterol" },
  { names: /^(?:colesterol vldl|vldl colesterol)$/, units: /^mg\/dl$/, code: "13458-5", trendKey: "vldl-cholesterol" },
  { names: /^(?:ind(?:ice)? )?col total col hdl$/, units: /^$/, code: "9830-1", trendKey: "total-hdl-cholesterol-ratio" },
  { names: /^trigliceridos$/, units: /^mg\/dl$/, code: "2571-8", trendKey: "triglycerides" },
  { names: /^(?:fosforo|fosfato)$/, units: /^mg\/dl$/, code: "2777-1", trendKey: "phosphate" },
  { names: /^(?:nitrogeno ureico|n ureico)$/, units: /^mg\/dl$/, code: "3094-0", trendKey: "urea-nitrogen" },
  { names: /^(?:urea|uremia|urenia)$/, units: /^(?:mg\/dl|g\/l)$/, code: "3091-6", trendKey: "urea" },
  { names: /^(?:prot c reactiva|proteina c reactiva|pcr)$/, units: /^(?:mg\/dl|mg\/l)$/, code: "1988-5", trendKey: "c-reactive-protein" },
  { names: /^(?:proteinas totales|total proteinas)$/, units: /^g\/dl$/, code: "2885-2", trendKey: "total-protein" },
  { names: /^albumina$/, units: /^g\/dl$/, code: "1751-7", trendKey: "albumin" },
  { names: /^(?:fosfatasa alcalina|fosf alcalinas|f alcalinas)$/, units: /^u\/l$/, code: "6768-6", trendKey: "alkaline-phosphatase" },
  { names: /^(?:transaminasa got|sgot|got|ast)$/, units: /^u\/l$/, code: "1920-8", trendKey: "ast" },
  { names: /^(?:transaminasa gpt|gpt|alt)$/, units: /^u\/l$/, code: "1742-6", trendKey: "alt" },
  { names: /^(?:gamma gt|ggt)$/, units: /^u\/l$/, code: "2324-2", trendKey: "ggt" },
  { names: /^(?:creatinina|creatininemia)$/, units: /^mg\/dl$/, code: "2160-0", trendKey: "creatinine" },
  { names: /^(?:beta 2 microglobulinas?|beta 2 microglobulina)$/, units: /^mg\/l$/, code: "1952-1", trendKey: "beta-2-microglobulin" },
  { names: /^sodio$/, units: /^(?:meq|mmol)\/l$/, code: "2951-2", trendKey: "sodium" },
  { names: /^potasio$/, units: /^(?:meq|mmol)\/l$/, code: "2823-3", trendKey: "potassium" },
  { names: /^(?:cloruro|cloro)$/, units: /^(?:meq|mmol)\/l$/, code: "2075-0", trendKey: "chloride" },
  { names: /^(?:eritrocitos|erimrocitos|eritrofocitos|eritrocpto)$/, units: /^(?:m\/ul|x?10(?:\^|\*)?6\/?ul)$/, code: "789-8", trendKey: "erythrocytes" },
  { names: /^hemoglobina$/, units: /^g\/dl$/, code: "718-7", trendKey: "hemoglobin" },
  { names: /^hematocrito$/, units: /^%$/, code: "4544-3", trendKey: "hematocrit" },
  { names: /^(?:v c m|vcm)$/, units: /^fl$/, code: "787-2", trendKey: "mcv" },
  { names: /^(?:h c m|hcm)$/, units: /^pg$/, code: "785-6", trendKey: "mch" },
  { names: /^(?:c h c m|chcm)$/, units: /^g\/dl$/, code: "786-4", trendKey: "mchc" },
  { names: /^(?:r d w|rdw)$/, units: /^%$/, code: "30385-9", trendKey: "rdw" },
  { names: /^leucocitos$/, units: /^(?:k\/ul|x?10(?:\^|\*)?3\/?ul)$/, code: "6690-2", trendKey: "leukocytes" },
  { names: /^(?:rcto de plaquetas|plaquetas)$/, units: /^(?:k\/ul|x?10(?:\^|\*)?3\/?ul)$/, code: "777-3", trendKey: "platelets" },
  { names: /^(?:v p m|vpm|volumen plaquetario medio)$/, units: /^fl$/, code: "28542-9", trendKey: "mean-platelet-volume" },
  { names: /^(?:segmentados|segmentados neut|neutrofilos|neutrofilos segmentados)$/, units: /^%$/, code: "770-8", trendKey: "neutrophils-percent" },
  { names: /^linfocitos$/, units: /^%$/, code: "736-9", trendKey: "lymphocytes-percent" },
  { names: /^monocitos$/, units: /^%$/, code: "5905-5", trendKey: "monocytes-percent" },
  { names: /^eosinofilos$/, units: /^%$/, code: "713-8", trendKey: "eosinophils-percent" },
  { names: /^basofilos$/, units: /^%$/, code: "706-2", trendKey: "basophils-percent" },
  { names: /^(?:baciliformes|baciliformes neut)$/, units: /^%$/, code: "26508-2", trendKey: "band-neutrophils-percent" },
  { names: /^blastos$/, units: /^%$/, code: "26446-5", trendKey: "blasts-percent" },
  { names: /^mielocitos(?: neut)?$/, units: /^%$/, code: "26498-6", trendKey: "myelocytes-percent" },
  { names: /^promielocitos$/, units: /^%$/, code: "26524-9", trendKey: "promyelocytes-percent" },
  { names: /^vhs$/, units: /^mm\/?h(?:r)?$/, code: "30341-2", trendKey: "erythrocyte-sedimentation-rate" },
  { names: /^(?:r a n|r a n rcto absoluto de neu)$/, units: /^(?:ul|x?10(?:\^|\*)?3\/(?:ul|mm(?:\^|\*)?3))$/, code: "751-8", trendKey: "absolute-neutrophils" },
  { names: /^rcto absoluto de eosinofilo$/, units: /^(?:ul|x?10(?:\^|\*)?3\/(?:ul|mm(?:\^|\*)?3))$/, code: "711-2", trendKey: "absolute-eosinophils" },
  { names: /^r a eosinofilos?$/, units: /^(?:ul|x?10(?:\^|\*)?3\/(?:ul|mm(?:\^|\*)?3))$/, code: "26449-9", trendKey: "absolute-eosinophils" },
  { names: /^r a linfocitos?$/, units: /^(?:ul|x?10(?:\^|\*)?3\/(?:ul|mm(?:\^|\*)?3))$/, code: "26474-7", trendKey: "absolute-lymphocytes" },
  { names: /^r a neutrofilos?$/, units: /^(?:ul|x?10(?:\^|\*)?3\/(?:ul|mm(?:\^|\*)?3))$/, code: "26499-4", trendKey: "absolute-neutrophils" },
  { names: /^(?:t de tromboplastina parcial|tiempo de tromboplastina parcial|ptt|ttpa)$/, units: /^(?:s|seg|seg\.)$/, code: "14979-9", trendKey: "aptt" },
  { names: /^tiempo protrombina$/, units: /^(?:s|seg|seg\.)$/, code: "5902-2", trendKey: "prothrombin-time" },
  { names: /^inr$/, units: /^$/, code: "6301-6", trendKey: "inr" },
  { names: /^protrombina$/, units: /^%$/, code: "3289-6", trendKey: "prothrombin-activity" },
  { names: /^(?:porcentaje )?saturacion (?:de )?transferrin(?:a)?$/, units: /^%$/, code: "2502-3", trendKey: "iron-saturation" },
  { names: /^(?:25 oh vitamina d|25 hidroxivitamina d(?: total)?|vitamina d total)$/, units: /^ng\/ml$/, code: "62292-8", trendKey: "vitamin-d-25oh-total" },
  { names: /^(?:hemoglobina glicosilada|hemoglobina glicada|hba1c)$/, units: /^%$/, code: "4548-4", trendKey: "hba1c" },
  { names: /^(?:glicemia|glucosa) media estimada$/, units: /^mg\/dl$/, code: "27353-2", trendKey: "estimated-average-glucose" },
  { names: /^(?:tsh|tsh ultrasensible|hormona estimulante de la tiroides tsh)$/, units: /^(?:miu\/l|miiu\/l|uiu\/ml|uui\/ml)$/, code: "3016-3", trendKey: "tsh" },
  { names: /^(?:t4 libre|tiroxina libre(?: t4l| ft4)?)$/, units: /^ng\/dl$/, code: "3024-7", trendKey: "free-t4" },
  { names: /^insulina$/, units: /^(?:uiu\/ml|uu\/ml)$/, code: "20448-7", trendKey: "insulin" },
  { names: /^prolactina$/, units: /^ng\/ml$/, code: "2842-3", trendKey: "prolactin" },
  { names: /^ferritina$/, units: /^ng\/ml$/, code: "2276-4", trendKey: "ferritin" },
  { names: /^(?:ferremia|hierro)$/, units: /^ug\/dl$/, code: "2498-4", trendKey: "serum-iron" },
  { names: /^(?:capacidad fijacion (?:de )?(?:fierro|fe|hierro)|capacidad total de fijacion (?:de )?(?:fierro|hierro))$/, units: /^ug\/dl$/, code: "2500-7", trendKey: "iron-binding-capacity" },
  { names: /^transferrina$/, units: /^mg\/dl$/, code: "3034-6", trendKey: "transferrin" },
  { names: /^(?:vitamina b 12|vitamina b12)$/, units: /^pg\/ml$/, code: "2132-9", trendKey: "vitamin-b12" },
  { names: /^troponina i$/, units: /^(?:ug\/l|ng\/ml)$/, code: "10839-9", trendKey: "cardiac-troponin-i" },
  { names: /^testosterona total$/, units: /^nmol\/l$/, code: "14913-8", trendKey: "total-testosterone" },
  { names: /^cortisol$/, units: /^nmol\/l$/, code: "14675-3", trendKey: "cortisol" },
  { names: /^vfg mdrd idms raza blanca$/, code: "48642-3", trendKey: "egfr-mdrd-non-black" },
  { names: /^vfg mdrd idms raza negra$/, code: "48643-1", trendKey: "egfr-mdrd-black" },
  { names: /^vfg ckd epi raza blanca$/, code: "88294-4", trendKey: "egfr-ckd-epi-non-black" },
  { names: /^vfg ckd epi raza negra$/, code: "88293-6", trendKey: "egfr-ckd-epi-black" },
];

export function phrSpecimenClass(value = "") {
  const specimen = term(value);
  if (/\b(?:urine|orina|urin)\b/.test(specimen)) return "urine";
  if (/\b(?:ser plas|serum|plasma|suero|bld|blood|sangre)\b/.test(specimen)) return "blood";
  return "";
}

const urinePresenceLoinc = new Map([
  ["proteinas", { code: "2887-8", trendKey: "urine-protein-presence" }],
  ["proteina", { code: "2887-8", trendKey: "urine-protein-presence" }],
  ["glucosa", { code: "2349-9", trendKey: "urine-glucose-presence" }],
  ["nitritos", { code: "32710-6", trendKey: "urine-nitrite-presence" }],
  ["nitrito", { code: "32710-6", trendKey: "urine-nitrite-presence" }],
  ["cetonas", { code: "33903-6", trendKey: "urine-ketones-presence" }],
  ["bilirrubina", { code: "1977-8", trendKey: "urine-bilirubin-presence" }],
  ["hemoglobina", { code: "725-2", trendKey: "urine-hemoglobin-presence" }],
  ["leucocitos", { code: "33052-2", trendKey: "urine-leukocytes-presence" }],
]);

const urineLoinc = new Map([
  ["ph", { code: "2756-5", trendKey: "urine-ph" }],
  ["densidad", { code: "2965-2", trendKey: "urine-specific-gravity" }],
  ["aspecto", { code: "5767-9", trendKey: "urine-appearance" }],
  ["color", { code: "5778-6", trendKey: "urine-color" }],
  ["urobilinogeno", { code: "13658-0", trendKey: "urine-urobilinogen" }],
]);

const bloodMorphologyLoinc = new Map([
  ["globulos rojos", { code: "6742-1", trendKey: "erythrocyte-morphology" }],
  ["globulos blancos", { code: "11156-7", trendKey: "leukocyte-morphology" }],
  ["plaquetas", { code: "11125-2", trendKey: "platelet-morphology" }],
]);

const electrophoresisLoinc = new Map([
  ["albumina|%", { code: "35706-1", trendKey: "electrophoresis-albumin-percent" }],
  ["albumina|g/dl", { code: "2862-1", trendKey: "electrophoresis-albumin" }],
  ["alfa 1|%", { code: "13978-2", trendKey: "electrophoresis-alpha-1-percent" }],
  ["alfa 1|g/dl", { code: "2865-4", trendKey: "electrophoresis-alpha-1" }],
  ["alfa 2|%", { code: "13981-6", trendKey: "electrophoresis-alpha-2-percent" }],
  ["alfa 2|g/dl", { code: "2868-8", trendKey: "electrophoresis-alpha-2" }],
  ["beta 1|%", { code: "32732-0", trendKey: "electrophoresis-beta-1-percent" }],
  ["beta 1|g/dl", { code: "32730-4", trendKey: "electrophoresis-beta-1" }],
  ["beta 2|%", { code: "32733-8", trendKey: "electrophoresis-beta-2-percent" }],
  ["beta 2|g/dl", { code: "32731-2", trendKey: "electrophoresis-beta-2" }],
  ["gamma|%", { code: "13983-2", trendKey: "electrophoresis-gamma-percent" }],
  ["gamma|g/dl", { code: "2874-6", trendKey: "electrophoresis-gamma" }],
  ["ratio a g|", { code: "44429-9", trendKey: "electrophoresis-albumin-globulin-ratio" }],
]);

export function vettedPhrLabIdentity(input: { analyte: string; unit?: string; specimen?: string; valueText?: string; sourceSentence?: string }) {
  const specimen = phrSpecimenClass(input.specimen);
  const analyte = term(input.analyte), unit = unitKey(input.unit);
  if (specimen === "urine") {
    const identity = urineLoinc.get(analyte);
    if (identity) return identity;
    if (unit || !/^(?:negativo|positivo|indicio|trazas?|ausente|presente)$/.test(term(input.valueText ?? ""))) return null;
    return urinePresenceLoinc.get(analyte) ?? null;
  }
  if (specimen === "blood" && /^normales?\.?$/.test(plain(input.valueText ?? ""))) {
    const identity = bloodMorphologyLoinc.get(analyte);
    if (identity) return identity;
  }
  if (/Panel:\s*Electroforesis de prote[ií]nas/i.test(input.sourceSentence ?? "")) {
    const identity = electrophoresisLoinc.get(`${analyte}|${unit}`);
    if (identity) return identity;
  }
  return vettedLoinc.find((rule) => rule.names.test(analyte) && (!rule.units || rule.units.test(unit))) ?? null;
}

/** Posibles equivalencias que conservan una ambigüedad implícita del informe. */
export function reviewPhrLabIdentity(input: { analyte: string; unit?: string; specimen?: string; valueText?: string; sourceSentence?: string }) {
  const analyte = term(input.analyte), unit = unitKey(input.unit), value = plain(input.valueText ?? "");
  if (phrSpecimenClass(input.specimen) === "urine" && /Panel:\s*Sedimento urinario/i.test(input.sourceSentence ?? "") && /^\s*\d+\s*-\s*\d+/.test(value)) {
    if (analyte === "leucocitos") return { code: "105104-4", trendKey: "urine-leukocytes-hpf" };
    if (/^(?:glob rojos|globulos rojos|eritrocitos)$/.test(analyte)) return { code: "105107-7", trendKey: "urine-erythrocytes-hpf" };
  }
  if (phrSpecimenClass(input.specimen) === "blood" && analyte === "juveniles neut" && unit === "%") {
    return { code: "28541-1", trendKey: "metamyelocytes-percent" };
  }
  if (phrSpecimenClass(input.specimen) !== "urine" && /^(?:ldh|desh lactica total ldh)$/.test(analyte) && unit === "u/l") {
    return { code: "32324-6", trendKey: "lactate-dehydrogenase-unspecified-specimen" };
  }
  return null;
}

export function validatePhrLabDraft(input: PhrLabDraft) {
  const analyte = input.analyte.trim(), value = input.value.trim(), unit = input.unit.trim(), referenceText = input.reference.trim();
  if (!analyte || analyte.length > 160) return { error: "Indica un analito válido." } as const;
  if (!value || value.length > 80) return { error: "Indica un resultado válido." } as const;
  if (unit.length > 32 || referenceText.length > 120) return { error: "Unidad o referencia demasiado extensa." } as const;
  if (!validDate(input.observedAt)) return { error: "Fecha de resultado inválida." } as const;
  const valueNum = parseLabNumber(value), reference = parseLabReference(referenceText);
  return { value: { analyte, valueNum, valueText: valueNum === null ? value : "", unit, ...reference, flag: labFlag(valueNum, reference.refLow, reference.refHigh), observedAt: input.observedAt } } as const;
}

export const phrLabDraftOf = (result: PhrLabResult): PhrLabDraft => ({
  analyte: result.analyte, value: String(result.valueNum ?? result.valueText), unit: result.unit,
  reference: result.refLow !== null && result.refHigh !== null ? `${result.refLow}–${result.refHigh}`
    : result.refLow !== null ? `> ${result.refLow}` : result.refHigh !== null ? `< ${result.refHigh}` : result.refText,
  observedAt: result.observedAt.slice(0, 10),
});

export const phrLabTrendKey = (result: Pick<PhrLabResult, "loincCode" | "analyte"> & Partial<Pick<PhrLabResult, "unit" | "sourceSentence">>) => {
  const specimen = result.sourceSentence?.match(/(?:^|\|)\s*Muestra:\s*([^|]+?)(?:\||$)/i)?.[1]?.trim();
  return vettedPhrLabIdentity({ analyte: result.analyte, unit: result.unit, specimen })?.trendKey ?? (result.loincCode.trim() || plain(result.analyte));
};
// ponytail: overrides curados por código LOINC; agrega solo los que el componente deja poco claro (p.ej. índices del hemograma).
const LOINC_FRIENDLY_NAME: Record<string, string> = {
  "1558-6": "Glicemia en ayunas",
  "20436-2": "Glicemia a los 120 minutos",
  "20438-8": "Glicemia a los 60 minutos",
  "2345-7": "Glicemia",
  "27353-2": "Glicemia media estimada",
  "14913-8": "Testosterona total",
  "14979-9": "Tiempo de tromboplastina parcial (TTPa)",
  "1988-5": "Proteína C reactiva (PCR)",
  "2132-9": "Vitamina B12",
  "2885-2": "Proteínas totales",
  "3024-7": "Tiroxina libre (T4 libre)",
  "3016-3": "Hormona estimulante de tiroides (TSH)",
  "3084-1": "Ácido úrico",
  "32324-6": "Deshidrogenasa láctica (LDH)",
  "785-6": "Hemoglobina corpuscular media (HCM)",
  "786-4": "Concentración de hemoglobina corpuscular media (CHCM)",
  "787-2": "Volumen corpuscular medio (VCM)",
};
// El nombre LOINC completo trae 5 ejes ("Componente: Muestra. Tiempo. Propiedad. Escala. Método"); para el paciente basta el componente.
const loincComponent = (canonical: string) => canonical.split(":")[0].replace(/\s+/g, " ").trim();
export const phrLabDisplayName = (result: Pick<PhrLabResult, "analyte" | "canonicalAnalyte"> & Partial<Pick<PhrLabResult, "loincCode">>) =>
  (result.loincCode ? LOINC_FRIENDLY_NAME[result.loincCode] || (result.canonicalAnalyte?.trim() && loincComponent(result.canonicalAnalyte)) : "") || result.analyte;

export function preferredSpanishLoincNames(rows: { code: string; display: string; languageVariant: string }[]) {
  const rank = (language: string) => ["esCL", "esES", "esMX", "esAR"].indexOf(language);
  return new Map([...rows].filter((row) => rank(row.languageVariant) >= 0).sort((a, b) => rank(b.languageVariant) - rank(a.languageVariant)).map((row) => [row.code, row.display]));
}
export const phrLoincDecision = (semanticConfidence: number, lexicalSimilarity: number) => {
  const confidence = Math.round((semanticConfidence * .75 + lexicalSimilarity * .25) * 100) / 100;
  return { confidence, status: confidence >= .88 ? "matched" : confidence >= .55 ? "review" : "unmapped" } as const;
};

export function phrSpecimenLabel(metadata?: LoincMetadata, sourceSentence = "") {
  const sourceSpecimen = sourceSentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+?)(?:\||$)/i)?.[1] ?? "";
  const specimen = plain(sourceSpecimen || metadata?.specimen || "");
  if (/urine|orina|urin/.test(specimen)) return "Orina";
  if (/ser\/plas|serum|plasma|suero/.test(specimen)) return "Sangre (suero/plasma)";
  if (/\bbld\b|blood|whole blood|sangre/.test(specimen)) return "Sangre";
  return "Muestra no determinada";
}

export function reusedPhrLoinc(rows: (Pick<PhrLabResult, "analyte" | "unit"> & { specimen?: string })[], prior: (Pick<PhrLabResult, "analyte" | "unit" | "loincCode"> & { specimen?: string })[]) {
  const priorByKey = new Map<string, Set<string>>();
  for (const row of prior) {
    const key = `${plain(row.analyte)}|${plain(row.unit)}|${phrSpecimenClass(row.specimen)}`;
    priorByKey.set(key, (priorByKey.get(key) ?? new Set()).add(row.loincCode));
  }
  const reused = new Map<number, string>();
  rows.forEach((row, index) => { const codes = priorByKey.get(`${plain(row.analyte)}|${plain(row.unit)}|${phrSpecimenClass(row.specimen)}`); if (codes?.size === 1) reused.set(index, [...codes][0]); });
  return reused;
}

export function buildPhrLabTrend(results: PhrLabResult[]) {
  const numeric = results.filter((result) => result.reviewStatus === "confirmed" && result.valueNum !== null)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latest = numeric[0], key = latest ? phrLabTrendKey(latest) : "";
  if (!latest || !key) return null;
  const byDate = new Map<string, { id: string; date: string; value: number }>();
  for (const result of numeric) {
    if (phrLabTrendKey(result) !== key || byDate.has(result.observedAt)) continue;
    const value = convertLabValue(result.valueNum!, result.unit, latest.unit);
    if (value !== null) byDate.set(result.observedAt, { id: result.id, date: result.observedAt, value });
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  return points.length >= 2 ? { analyte: phrLabDisplayName(latest), unit: latest.unit, refLow: latest.refLow, refHigh: latest.refHigh, points } : null;
}
