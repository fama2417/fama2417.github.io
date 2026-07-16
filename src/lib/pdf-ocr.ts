import { createRequire } from "node:module";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { extractImages, getDocumentProxy, type StructuredTextItem } from "unpdf";

type TesseractLanguage = { code: string; gzip: boolean; langPath: string };
type Word = { block: number; paragraph: number; line: number; left: number; top: number; width: number; height: number; text: string };

const spanish = createRequire(import.meta.url)("@tesseract.js-data/spa") as TesseractLanguage;
const MAX_PAGES = 30;

function layoutFromTsv(tsv: string, sourceWidth: number, sourceHeight: number, scale: number): StructuredTextItem[] {
  const words = tsv.split("\n").slice(1).map((line) => line.split("\t")).filter((row) => row[0] === "5" && row[11]?.trim()).map((row) => ({
    block: Number(row[2]), paragraph: Number(row[3]), line: Number(row[4]), left: Number(row[6]), top: Number(row[7]), width: Number(row[8]), height: Number(row[9]), text: row.slice(11).join("\t").trim(),
  } satisfies Word));
  const lines = new Map<string, Word[]>();
  words.forEach((word) => { const key = `${word.block}-${word.paragraph}-${word.line}`; lines.set(key, [...(lines.get(key) ?? []), word]); });
  return [...lines.values()].flatMap((line) => {
    const cells: Word[][] = [];
    for (const word of line.sort((a, b) => a.left - b.left)) {
      const current = cells.at(-1), previous = current?.at(-1);
      if (!previous || word.left - previous.left - previous.width > Math.max(36, previous.height * 1.5)) cells.push([word]);
      else current!.push(word);
    }
    return cells.map((cell, index) => {
      const left = Math.min(...cell.map((word) => word.left)), top = Math.min(...cell.map((word) => word.top));
      const right = Math.max(...cell.map((word) => word.left + word.width)), bottom = Math.max(...cell.map((word) => word.top + word.height));
      return { str: cell.map((word) => word.text).join(" "), x: left / scale, y: sourceHeight - bottom / scale, width: (right - left) / scale, height: (bottom - top) / scale, fontSize: (bottom - top) / scale, fontFamily: "OCR", dir: "ltr", hasEOL: index === cells.length - 1 };
    });
  }).filter((item) => item.x <= sourceWidth);
}

/** OCR local para PDF escaneados: no transmite el archivo ni su texto a servicios externos. */
export async function extractScannedPdf(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes.slice());
  if (pdf.numPages > MAX_PAGES) throw new Error(`El PDF escaneado supera el límite de ${MAX_PAGES} páginas.`);
  const worker = await createWorker(spanish.code, 1, { langPath: spanish.langPath, gzip: spanish.gzip, cacheMethod: "readOnly" });
  const items: StructuredTextItem[][] = [], text: string[] = [];
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "210" });
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const images = await extractImages(pdf, pageNumber), source = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!source) { items.push([]); text.push(""); continue; }
      const targetWidth = Math.min(3000, Math.max(source.width, source.width < 1000 ? source.width * 3 : 2500)), scale = targetWidth / source.width;
      const image = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: source.channels } }).resize({ width: targetWidth }).grayscale().normalize().sharpen().png().toBuffer();
      const recognized = await worker.recognize(image, {}, { text: true, tsv: true });
      items.push(layoutFromTsv(recognized.data.tsv ?? "", source.width, source.height, scale));
      text.push(recognized.data.text.trim());
    }
  } finally { await worker.terminate(); }
  return { items, text, totalPages: pdf.numPages };
}
