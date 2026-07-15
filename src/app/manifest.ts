import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mi Salud · Registro Personal",
    short_name: "Mi Salud",
    description: "Registro personal de salud y acceso a fichas institucionales vinculadas.",
    start_url: "/portal",
    id: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#08111f",
    theme_color: "#0f766e",
    lang: "es-CL",
    icons: [
      { src: "/health-record-icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/health-record-icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
