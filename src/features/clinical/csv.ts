// Parser CSV/TSV mínimo pero correcto (comillas, delimitador auto) para importar terminologías.
// ponytail: parsea el archivo completo en memoria; suficiente hasta ~100 MB (LOINC). Si algún
// día se cargan archivos mayores (SNOMED RF2 completo), pasar a parseo por chunks.

export function detectDelimiter(headerLine: string): string {
  const candidates = ["\t", ";", ","];
  return candidates.find((d) => headerLine.includes(d)) ?? ",";
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const rows: string[][] = [];
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || undefined);
  const delim = delimiter ?? detectDelimiter(firstLine);
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}

/** Ubica las columnas código/nombre por encabezado (LOINC, CIE, SNOMED o genérico).
 *  Los patrones se prueban en orden de prioridad: en SNOMED RF2 debe ganar conceptId sobre id. */
export function codeColumns(header: string[]): { code: number; display: number } {
  const lower = header.map((h) => h.trim().toLowerCase());
  const byPriority = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const index = lower.findIndex((h) => pattern.test(h));
      if (index >= 0) return index;
    }
    return -1;
  };
  const code = byPriority([/^loinc_num$/, /^conceptid$/, /^c[oó]digo$/, /^code$/, /^clave$/, /^id$/]);
  const display = byPriority([/^long_common_name$/, /^term$/, /^title$/, /descripci[oó]n/, /^description$/, /^display$/, /^nombre$/, /^glosa$/]);
  return { code: code >= 0 ? code : 0, display: display >= 0 ? display : (code === 0 ? 1 : Math.max(1, code + 1)) };
}

export type LoincImportRow = {
  code: string; display: string; component: string; property: string; timeAspect: string;
  specimen: string; scaleType: string; methodType: string; className: string; status: string;
  exampleUcumUnits: string;
};

export type LoincDesignationImportRow = { code: string; languageVariant: string; display: string; searchText: string };

/** Convierte una fila de xxYY##LinguisticVariant.csv oficial en un alias del LOINC canónico. */
export function loincDesignationImportRow(header: string[], row: string[], filename: string): LoincDesignationImportRow {
  const indexes = new Map(header.map((name, index) => [name.trim().toUpperCase(), index]));
  const value = (name: string) => (row[indexes.get(name) ?? -1] ?? "").trim();
  const languageVariant = filename.match(/(es[A-Z]{2})\d*LinguisticVariant/i)?.[1] ?? "es";
  const fields = ["LINGUISTICVARIANTDISPLAYNAME", "LONG_COMMON_NAME", "SHORTNAME", "COMPONENT", "SYSTEM", "TIME_ASPCT", "PROPERTY", "SCALE_TYP", "METHOD_TYP", "RELATEDNAMES2"]
    .map(value).filter(Boolean);
  const searchText = [...new Set(fields)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return { code: value("LOINC_NUM"), languageVariant, display: fields[0] ?? "", searchText };
}

/** Extrae del Loinc.csv oficial sólo los campos usados por búsqueda, categorías y tendencias. */
export function loincImportRow(header: string[], row: string[]): LoincImportRow {
  const indexes = new Map(header.map((name, index) => [name.trim().toUpperCase(), index]));
  const value = (name: string) => (row[indexes.get(name) ?? -1] ?? "").trim();
  return {
    code: value("LOINC_NUM"), display: value("LONG_COMMON_NAME"), component: value("COMPONENT"),
    property: value("PROPERTY"), timeAspect: value("TIME_ASPCT"), specimen: value("SYSTEM"),
    scaleType: value("SCALE_TYP"), methodType: value("METHOD_TYP"), className: value("CLASS"),
    status: value("STATUS"), exampleUcumUnits: value("EXAMPLE_UCUM_UNITS"),
  };
}
