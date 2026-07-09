import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed, Inter } from "next/font/google";
import { AuthGate } from "@/components/AuthGate";
import "./globals.css";

// ADN visual: Inter para el cuerpo; Plex Condensed para títulos; Plex Mono para etiquetas técnicas.
const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const plexCondensed = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Agenda Clínica de Imagenología",
  description: "Agenda clínica, pacientes, worklist y visualización DICOM con Orthanc/OHIF.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${inter.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body className={inter.className}><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
