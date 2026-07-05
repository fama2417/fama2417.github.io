import { NextRequest, NextResponse } from "next/server";
import { PACS_COOKIE, verifyPacsCookie } from "../auth";

const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";
const forwardedHeaders = ["accept", "content-type", "range", "if-none-match", "if-modified-since"];

// ponytail: todo el tráfico DICOM pasa por la app; si el visor se siente lento, inyectar las credenciales en Caddy (VM) en su lugar
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!orthancUrl || !orthancCreds) return NextResponse.json({ error: "Falta configurar ORTHANC_URL y ORTHANC_CREDS." }, { status: 501 });
  if (!verifyPacsCookie(request.cookies.get(PACS_COOKIE)?.value)) return NextResponse.json({ error: "Sesión PACS no válida." }, { status: 401 });

  const { path } = await params;
  const headers = new Headers({ Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}` });
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(`${orthancUrl}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    // @ts-expect-error Node exige duplex para cuerpos en streaming
    duplex: "half",
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("www-authenticate"); // nunca mostrar el diálogo de login del navegador
  // Los bundles de OHIF llevan hash en el nombre: cachearlos fuerte evita repetir el viaje Render→Orthanc.
  if (upstream.ok && /\.(js|css|woff2?|ttf|png|svg|ico|wasm|json)$/.test(path[path.length - 1] ?? "")) {
    responseHeaders.set("cache-control", "public, max-age=86400, immutable");
  }
  const location = upstream.headers.get("location");
  if (location) responseHeaders.set("location", location.replace(orthancUrl, ""));
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as HEAD, proxy as POST };
