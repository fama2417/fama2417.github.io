export const implementationPhases = [
  {
    title: "Hito 1: Base técnica",
    items: ["Next.js + TypeScript", "Supabase Auth/PostgreSQL", "Navegación clínica base"],
  },
  {
    title: "Hito 2: Pacientes",
    items: ["Creación de pacientes", "Búsqueda", "Prevención de duplicados"],
  },
  {
    title: "Hito 3: Agenda MVP",
    items: ["Vista diaria/semanal", "Crear y editar citas", "Estados normalizados"],
  },
  {
    title: "Hito 4: Imágenes",
    items: ["Orthanc", "DICOMweb", "OHIF Viewer"],
  },
];

export const clinicalStandards = [
  "FHIR Patient, Practitioner, Appointment, Schedule, Slot e ImagingStudy como referencia de interoperabilidad.",
  "Orthanc + DICOMweb para PACS de pruebas y conexión futura con OHIF.",
  "Auditoría, roles y trazabilidad desde las primeras iteraciones antes de usar datos reales.",
];
