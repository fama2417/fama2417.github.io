const MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 2200; // mantiene legible el texto de una orden tamaño carta

/** Comprime una imagen a JPEG bajo 1 MB reduciendo calidad y escala progresivamente. Los PDF se aceptan solo si ya pesan menos de 1 MB. */
export async function compressOrderFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    if (file.size > MAX_BYTES) throw new Error("El PDF supera 1 MB. Expórtalo con menor resolución o súbelo como imagen.");
    return file;
  }
  if (file.size <= MAX_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let quality = 0.85; quality >= 0.35; quality -= 0.1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    scale *= 0.85;
  }
  throw new Error("No fue posible comprimir la imagen bajo 1 MB.");
}
