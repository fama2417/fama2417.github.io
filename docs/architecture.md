# Arquitectura

- Next.js + TypeScript para la interfaz.
- Supabase PostgreSQL/Auth para datos, roles, RLS y auditoría.
- Orthanc con DICOMweb y su plugin oficial de OHIF para el PACS/visor de pruebas.
- Patient, Appointment e ImagingStudy de HL7 FHIR como referencia de interoperabilidad.

El navegador usa `localStorage` sólo para la demostración. Al activar Supabase, las mismas colecciones se reemplazan por consultas autenticadas; no se mantiene sincronización doble.

## Límite de seguridad

La configuración Docker y sus credenciales son exclusivamente locales. Un despliegue clínico exige HTTPS, secretos externos, backups probados, control de acceso, trazabilidad, retención definida y revisión de la normativa aplicable.
