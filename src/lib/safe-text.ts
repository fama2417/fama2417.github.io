import type { PDFFont } from "pdf-lib";

export const pdfSafeText = (font: PDFFont, value: string) => [...value].map((character) => {
  try { font.encodeText(character); return character; } catch { return "?"; }
}).join("");

export const csvCell = (value: unknown) => {
  const text = String(value);
  const safe = /^[\t\r\n ]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
