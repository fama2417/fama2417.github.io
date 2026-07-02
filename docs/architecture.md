# Arquitectura propuesta

Este proyecto se inicia como una agenda clínica web y se prepara para crecer hacia pacientes, lista de trabajo, visualización de imágenes DICOM/no DICOM e interoperabilidad clínica.

## Decisiones iniciales

- **Frontend:** Next.js + TypeScript.
- **Base de datos:** Supabase PostgreSQL para el MVP interno.
- **Autenticación:** Supabase Auth en una iteración posterior.
- **DICOM:** Orthanc como PACS Open Source de pruebas.
- **Visor:** OHIF Viewer para visualización DICOM vía DICOMweb.
- **Interoperabilidad:** HL7 FHIR como referencia de modelado, empezando por Patient, Practitioner, Appointment, Schedule, Slot e ImagingStudy.

## Fases

1. Base técnica y navegación clínica.
2. Gestión mínima de pacientes.
3. Agenda diaria/semanal con estados normalizados.
4. Auditoría, roles y Row Level Security.
5. Worklist derivada de citas.
6. Integración Orthanc/OHIF para estudios DICOM.
