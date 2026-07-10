/** Mínimo de búsqueda para staff no-admin: evita listar el padrón completo sin un término razonable. */
export function hasMinimumPatientSearch(query: string, minimum = 3) {
  return query.trim().length >= minimum;
}

/** Filtro PostgREST `or` para buscar por nombre, identificador crudo o identificador normalizado (identifier_key: minúsculas sin puntos/guiones/espacios). */
export function patientSearchFilter(search: string | undefined): string | null {
  const clean = search?.replace(/[,()%\\]/g, " ").trim();
  if (!clean) return null;
  const filters = [`full_name.ilike.%${clean}%`, `identifier.ilike.%${clean}%`];
  const key = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key) filters.push(`identifier_key.ilike.%${key}%`);
  return filters.join(",");
}
