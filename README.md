# Agenda de Imagenología

MVP para validar pacientes, agenda, worklist e imágenes DICOM sin usar información clínica real.

## Iniciar la aplicación

```powershell
npm install
npm run dev
```

Abrir <http://localhost:3000> e ingresar con un usuario creado en Supabase Auth.

## Iniciar Orthanc y OHIF

Docker Desktop debe estar abierto.

```powershell
npm run dicom:start
```

- Orthanc: <http://localhost:8042/ui/app/>
- OHIF: <http://localhost:8042/ohif/>
- Usuario/clave de demostración: `demo` / `demo`

Para detenerlo: `npm run dicom:stop`.

En producción, configure `NEXT_PUBLIC_ORTHANC_URL` y `NEXT_PUBLIC_OHIF_URL` con las URLs HTTPS del PACS desplegado.

## Demo en Render

El archivo `render.yaml` crea la aplicación y Orthanc/OHIF en servicios gratuitos. Durante la creación, Render solicita las variables de Supabase, las URLs públicas generadas y `ORTHANC__REGISTERED_USERS` con formato `{"usuario":"clave"}`.

La capa gratuita es solo para pruebas: se suspende por inactividad y no conserva los DICOM después de reinicios o despliegues. Agregue un disco persistente en `/var/lib/orthanc/db` antes de usar información que deba conservarse.

## Supabase

El proyecto se gestiona mediante `supabase/config.toml` y migraciones versionadas. Para enlazar otra instalación:

1. Ejecutar `npx supabase login` y `npx supabase link`.
2. Copiar `.env.example` a `.env.local` y usar la URL y clave publicable del proyecto.
3. Ejecutar `npx supabase db push --dry-run` antes de `npx supabase db push`.

Las contraseñas, tokens y claves secretas nunca se guardan en Git.

No usar en producción hasta habilitar autenticación en la aplicación, HTTPS, copias de seguridad, monitoreo y revisión normativa.

## Verificación

```powershell
npm test
npm run lint
npm run build
docker compose config
```
