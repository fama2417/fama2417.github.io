const MAX_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 20 * MAX_BYTES;
const MAX_SIDE = 2200; // mantiene legible el texto de una orden tamaño carta
const RASTER_TYPES = new Set(["image/jpeg", "image/png"]);

/** Valida y comprime JPG/PNG a menos de 1 MB. */
export async function compressImageFile(file: File): Promise<File> {
  if (!RASTER_TYPES.has(file.type)) throw new Error("Usa una imagen JPG o PNG.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("La imagen supera 20 MB.");
  if (file.size <= MAX_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    for (let quality = 0.85; quality >= 0.35; quality -= 0.1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      scale *= 0.85;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("No fue posible comprimir la imagen bajo 1 MB.");
}

/** Las órdenes aceptan PDF bajo 1 MB o imagen JPG/PNG. */
export async function compressOrderFile(file: File): Promise<File> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_BYTES) throw new Error("El PDF supera 1 MB. Expórtalo con menor resolución o súbelo como imagen.");
    return file;
  }
  return compressImageFile(file);
}
