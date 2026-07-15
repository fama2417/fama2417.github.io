import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function simplePhrPdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]), y = 800;
  const addPage = () => { page = pdf.addPage([595, 842]); y = 800; };
  const safe = (text: string) => text.replace(/[^ -~À-ÿ]/g, "-");
  page.drawText(safe(title), { x: 45, y, size: 18, font: bold, color: rgb(0.06, 0.46, 0.43) }); y -= 32;
  for (const original of lines) {
    const words = safe(original).split(/\s+/); let line = "";
    const wrapped: string[] = [];
    for (const word of words) {
      if (`${line} ${word}`.trim().length > 92) { wrapped.push(line); line = word; } else line = `${line} ${word}`.trim();
    }
    if (line || !original) wrapped.push(line);
    for (const text of wrapped) {
      if (y < 50) addPage();
      page.drawText(text, { x: 45, y, size: 10, font, color: rgb(0.12, 0.16, 0.2) }); y -= 15;
    }
    y -= 4;
  }
  return await pdf.save();
}
