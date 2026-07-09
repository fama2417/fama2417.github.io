const stripMarks = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function normalizeClinicalText(value: string) {
  return stripMarks(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalizeCandidateKey = normalizeClinicalText;
export const normalizeLocalCodeName = normalizeClinicalText;
