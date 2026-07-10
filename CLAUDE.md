# Project instructions

## UI iteration contract

Cuando una instrucción comience con `UI-PASS`:

- Implementa directamente; no presentes un plan previo ni solicites confirmación.
- Inspecciona solo los archivos nombrados y sus imports directos.
- No cambies datos, queries, permisos, RLS, rutas, migraciones ni lógica clínica salvo indicación explícita.
- Reutiliza componentes, helpers, estilos y dependencias existentes.
- No dupliques componentes para versiones compactas: usa props o variants.
- No pegues logs exitosos ni narres comandos ejecutados.
- Para cambios solo visuales, ejecuta typecheck, tests directamente relacionados y smoke-test de la ruta afectada.
- Ejecuta la suite completa únicamente al cerrar un hito visual o si cambió lógica.
- La respuesta final debe tener máximo 10 líneas: archivos modificados, resultado y prueba visual.

## Project safety

- No modificar Render, Oracle VM, GitHub Actions ni variables de entorno salvo solicitud explícita.
- No crear migraciones Supabase sin autorización explícita.
- Mantener compatibilidad con RLS multi-tenant.
- No modificar reglas de acceso por rol salvo solicitud explícita.
- No crear rutas nuevas si el objetivo puede resolverse reutilizando las existentes.
- Mantener typecheck limpio.
- No romper `/pacientes`, `/pacientes/[id]`, `/agenda` ni `/worklist`.

## Clinical UI rules

- No presentar contenido generado por IA como diagnóstico confirmado.
- Mostrar `confidence` únicamente como “Confianza de extracción”.
- Mantener `isReportAvailable` como fuente única para acceso a informes.
- No exponer borradores a operator.
- No mostrar información oculta mediante contadores, previews o estados indirectos.
- Reutilizar helpers existentes de permisos, filtros y deduplicación.

## Working style

- Para solicitudes visuales, priorizar implementación sobre explicación.
- No repetir el contexto conocido del proyecto.
- No crear fases o subfases adicionales salvo que exista un bloqueo real.
- Al finalizar, informar solo:
  1. Archivos modificados.
  2. Resultado visual o funcional.
  3. Validaciones ejecutadas.
  4. Prueba manual recomendada.