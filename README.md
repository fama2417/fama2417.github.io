# Agenda de Imagenología

MVP para validar pacientes, agenda, worklist e imágenes DICOM sin usar información clínica real.

## Iniciar la aplicación

```powershell
npm install
npm run dev
```

Abrir <http://localhost:3000>. Los datos de demostración se guardan en el navegador.

## Iniciar Orthanc y OHIF

Docker Desktop debe estar abierto.

```powershell
npm run dicom:start
```

- Orthanc: <http://localhost:8042/ui/app/>
- OHIF: <http://localhost:8042/ohif/>
- Usuario/clave de demostración: `demo` / `demo`

Para detenerlo: `npm run dicom:stop`.

## Conectar Supabase

1. Crear un proyecto Supabase y ejecutar `supabase/migrations/202607020001_initial_clinical_schema.sql` en su editor SQL.
2. Copiar `.env.example` a `.env.local` y reemplazar sus dos valores.
3. Crear los usuarios en Supabase Auth y asignar sus perfiles/roles desde SQL.

No usar en producción hasta habilitar autenticación en la aplicación, HTTPS, copias de seguridad, monitoreo y revisión normativa.

## Verificación

```powershell
npm test
npm run lint
npm run build
docker compose config
```
