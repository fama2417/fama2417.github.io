import { createHmac, timingSafeEqual } from "node:crypto";

// ponytail: reutiliza CRON_SECRET como clave de firma; crear PACS_SECRET si se necesita rotarlas por separado
const secret = process.env.CRON_SECRET ?? "";

export const PACS_COOKIE = "pacs_session";

export const signPacsCookie = (expiresAt: number) =>
  `${expiresAt}.${createHmac("sha256", secret).update(String(expiresAt)).digest("hex")}`;

export function verifyPacsCookie(value: string | undefined) {
  if (!secret || !value) return false;
  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  const expected = createHmac("sha256", secret).update(expiresAt).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
