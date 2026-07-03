import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { AuthGate } from "@/components/AuthGate";
import "./globals.css";

const font = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Agenda Clínica de Imagenología",
  description: "Agenda clínica, pacientes, worklist y visualización DICOM con Orthanc/OHIF.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className={font.className}><AuthGate>{children}</AuthGate></body></html>;
}
