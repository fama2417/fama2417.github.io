import type { Metadata } from "next";
import { AuthGate } from "@/components/AuthGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda Clínica de Imagenología",
  description: "Agenda clínica, pacientes, worklist y visualización DICOM con Orthanc/OHIF.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><AuthGate>{children}</AuthGate></body></html>;
}
