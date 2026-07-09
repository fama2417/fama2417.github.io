# Radiology AI Finding Extraction Spec

## Objetivo

Implementar un módulo de extracción automática de hallazgos radiológicos usando OpenAI API.

El sistema debe permitir que el radiólogo escriba el informe en lenguaje clínico natural. La IA solo debe extraer hallazgos estructurados desde las secciones Hallazgos e Impresión, generar sugerencias y alimentar progresivamente un diccionario local.

## Problema principal

El sistema puede tener más de 400 prestaciones radiológicas. No se debe crear un diccionario manual por prestación.

La solución debe usar:

- Reporting Groups o familias de informe.
- Diccionario local progresivo.
- Candidatos de hallazgos generados por IA.
- Confirmación/corrección manual del usuario.
- OpenAI como asistente, no como fuente definitiva.

## Flujo deseado

1. El usuario crea o edita un informe radiológico.
2. El informe tiene secciones:
   - indicación clínica
   - técnica
   - comparación
   - hallazgos
   - impresión
3. El usuario presiona “Detectar hallazgos con IA”.
4. Backend llama a OpenAI.
5. OpenAI devuelve JSON estructurado.
6. Backend crea ExtractedFindings.
7. Si el hallazgo no existe en el diccionario local, crea FindingCandidate.
8. El usuario puede confirmar, editar o rechazar cada hallazgo.
9. Un administrador puede aceptar candidatos como nuevos hallazgos o agregarlos como sinónimos.
10. El diccionario local crece con el uso real.

## Restricciones

- No enviar datos personales del paciente a OpenAI.
- No enviar RUT, DNI, fecha de nacimiento, teléfono, dirección, email ni nombre completo.
- Enviar solo contexto técnico mínimo:
  - nombre de prestación
  - modalidad
  - reporting group si existe
  - hallazgos
  - impresión
- La API key debe vivir solo en backend.
- No guardar prompts crudos con datos clínicos.
- No auto-confirmar hallazgos.
- No bloquear la validación del informe si la IA falla.
- La IA nunca debe modificar el texto original del informe.
- La salida debe validarse antes de guardarse.

## Modelos requeridos

### ProcedureCatalog

Representa prestaciones/exámenes.

Campos sugeridos:

- id
- localCode
- name
- normalizedName
- modality: CT | MR | DX | CR | US | MG | NM | OT | UNKNOWN
- bodyRegion nullable
- procedureType nullable
- active
- createdAt
- updatedAt

### ReportingGroup

Agrupa prestaciones en familias reutilizables.

Ejemplos:

- CT_CHEST
- CT_ABDOMEN_PELVIS
- CT_URO
- CT_HEAD
- CT_SPINE
- MR_BRAIN
- MR_SPINE
- MR_KNEE
- MR_SHOULDER
- DX_CHEST
- DX_BONE
- US_ABDOMEN
- US_RENAL
- US_THYROID
- US_BREAST
- MG_BREAST
- UNKNOWN_RADIOLOGY

Campos:

- id
- code
- name
- modality
- bodyRegion nullable
- description nullable
- active
- createdAt
- updatedAt

### ProcedureReportingGroup

Relaciona prestación con familia.

Campos:

- id
- procedureId
- reportingGroupId
- confidence
- assignedBy: auto_rule | ai | manual
- active
- createdAt
- updatedAt

### FindingDictionary

Diccionario local confirmado.

Campos:

- id
- localCode
- canonicalName
- normalizedCanonicalName
- bodySite nullable
- defaultStatus: present | absent | uncertain
- requiresLaterality boolean
- active boolean
- snomedCode nullable
- snomedDisplay nullable
- icd10Code nullable
- icd11Code nullable
- radlexCode nullable
- createdFrom: manual | candidate | ai
- createdAt
- updatedAt

### FindingSynonym

Sinónimos del hallazgo.

Campos:

- id
- findingId
- synonym
- normalizedSynonym
- language default es
- active
- createdAt
- updatedAt

### FindingGroupMapping

Asocia hallazgos a Reporting Groups.

Campos:

- id
- findingId
- reportingGroupId
- priority
- enabled
- createdAt
- updatedAt

### FindingCandidate

Hallazgo detectado por IA que todavía no está confirmado en el diccionario.

Campos:

- id
- rawText
- normalizedText
- suggestedCanonicalName nullable
- procedureId nullable
- procedureCode nullable
- procedureName nullable
- reportingGroupId nullable
- modality nullable
- bodySite nullable
- lateralityDetected nullable
- severityDetected nullable
- sourceReportId nullable
- sourceSentence nullable
- sourceSection nullable
- occurrenceCount
- firstSeenAt
- lastSeenAt
- aiConfidence nullable
- status: pending | accepted | rejected | merged
- acceptedFindingId nullable
- rejectedReason nullable
- createdAt
- updatedAt

### ExtractedFinding

Hallazgo extraído desde un informe.

Campos:

- id
- reportId
- findingId nullable
- findingCandidateId nullable
- findingText
- normalizedText
- status: present | absent | uncertain | history | recommendation
- importance: principal | secondary | incidental | negative | not_relevant
- sourceSection: findings | impression | clinical_indication
- sourceSentence
- bodySite nullable
- laterality: left | right | bilateral | midline | unknown | null
- severity: mild | moderate | severe | unknown | null
- confidence
- extractionMethod: local_rules | openai | manual
- codingStatus: suggested | confirmed | corrected | rejected | not_required
- createdAt
- updatedAt

### ExtractionFeedback

Registra correcciones del usuario.

Campos:

- id
- reportId
- extractedFindingId nullable
- originalText nullable
- originalSuggestion nullable
- correctedText nullable
- correctedFindingId nullable
- action: accepted | corrected | rejected | created_new | merged_candidate
- userId
- createdAt

### AiUsageLog

Registra uso y costo estimado.

Campos:

- id
- reportId nullable
- procedureId nullable
- provider: openai
- model
- requestType: extract_findings | classify_procedure | bootstrap_dictionary | normalize_candidate
- inputTokens nullable
- outputTokens nullable
- totalTokens nullable
- estimatedCostUsd nullable
- success boolean
- errorMessage nullable
- createdAt

## Variables de entorno

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-nano
OPENAI_FALLBACK_MODEL=gpt-5.4-mini

AI_EXTRACTION_ENABLED=true
AI_EXTRACTION_MODE=hybrid
AI_ONLY_ON_LOW_CONFIDENCE=false

AI_MAX_REPORTS_PER_DAY=100
AI_MONTHLY_BUDGET_USD=10
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=4000
AI_TIMEOUT_MS=45000

AI_SEND_PATIENT_DATA=false
AI_STORE_RAW_PROMPT=false
AI_STORE_RAW_RESPONSE=false
AI_LOG_USAGE=true

AI_MIN_CONFIDENCE_TO_AUTO_SUGGEST=0.65
AI_MIN_CONFIDENCE_TO_AUTO_CREATE_CANDIDATE=0.50
AI_AUTO_CONFIRM_FINDINGS=false

## OpenAI prompt

System prompt:

Eres un extractor de hallazgos radiológicos en español para un sistema RIS/PACS.

Reglas:
1. No inventes información.
2. Usa principalmente Impresión o Conclusión.
3. Usa Hallazgos como fuente secundaria.
4. No uses Indicación clínica como diagnóstico final.
5. Distingue hallazgos presentes, ausentes, inciertos, históricos y recomendaciones.
6. Detecta negación.
7. Detecta incertidumbre.
8. Detecta lateralidad.
9. Detecta severidad.
10. Si hay múltiples hallazgos, marca como principal el hallazgo patológico más relevante de la impresión.
11. Hallazgos negados deben ser absent y negative.
12. Si el estudio es normal, devuelve “Sin hallazgos patológicos significativos”.
13. No devuelvas códigos SNOMED, CIE o RadLex si no fueron proporcionados.
14. Devuelve solo JSON válido según schema.

User prompt:

Extrae hallazgos radiológicos desde el siguiente informe.

Contexto de prestación:
- Código local: {{procedure.localCode}}
- Nombre prestación: {{procedure.name}}
- Modalidad: {{procedure.modality}}
- Grupo de informe sugerido: {{reportingGroup.code}}

Texto del informe:

Indicación clínica:
{{clinicalIndication}}

Técnica:
{{technique}}

Hallazgos:
{{findings}}

Impresión:
{{impression}}

## JSON esperado

La respuesta debe incluir:

- reportLanguage
- procedureContext
- findings[]
- overallConfidence
- warnings[]

Cada finding debe incluir:

- findingText
- canonicalName
- status
- importance
- bodySite
- laterality
- severity
- sourceSection
- sourceSentence
- isNegated
- isUncertain
- isHistorical
- shouldCreateDictionaryCandidate
- confidence

## Endpoints requeridos

POST /api/reports/:reportId/ai/extract-findings
GET /api/reports/:reportId/extracted-findings
PATCH /api/extracted-findings/:id/confirm
PATCH /api/extracted-findings/:id/reject
PATCH /api/extracted-findings/:id/correct

POST /api/procedures/:procedureId/classify
GET /api/procedures/unclassified
PATCH /api/procedures/:procedureId/reporting-group

GET /api/finding-candidates
POST /api/finding-candidates/:id/accept-as-new
POST /api/finding-candidates/:id/add-as-synonym
POST /api/finding-candidates/:id/reject
POST /api/finding-candidates/:id/merge

GET /api/finding-dictionary
POST /api/finding-dictionary
PATCH /api/finding-dictionary/:id
POST /api/finding-dictionary/:id/synonyms
POST /api/finding-dictionary/:id/groups

GET /api/ai-usage

## Pantallas requeridas

### En informe radiológico

Agregar botón:

Detectar hallazgos con IA

Mostrar panel:

Hallazgos sugeridos

Cada hallazgo debe mostrar:

- texto
- estado
- importancia
- lateralidad
- severidad
- sección fuente
- frase fuente
- confianza
- acciones: confirmar, editar, rechazar

### Administración

Crear sección:

Administración → IA / Diccionario radiológico

Pestañas:

1. Prestaciones sin clasificar
2. Candidatos de hallazgos
3. Diccionario local
4. Uso IA / costos

## Reglas de clasificación de prestaciones

Crear ProcedureClassificationService.

Reglas iniciales:

- CT + uro/pielo/litiasis urinaria → CT_URO
- CT + tórax/torax/pulmonar → CT_CHEST
- CT + abdomen/pelvis → CT_ABDOMEN_PELVIS
- CT + cráneo/cerebro/encéfalo → CT_HEAD
- CT + columna → CT_SPINE
- MR + cerebro/encéfalo/cráneo → MR_BRAIN
- MR + columna → MR_SPINE
- MR + rodilla → MR_KNEE
- MR + hombro → MR_SHOULDER
- MR + cadera → MR_HIP
- MR + abdomen → MR_ABDOMEN
- MR + pelvis → MR_PELVIS
- DX/CR + tórax/torax → DX_CHEST
- DX/CR + columna → DX_SPINE
- DX/CR + rodilla/hombro/mano/pie/muñeca/codo → DX_BONE
- US + abdomen → US_ABDOMEN
- US + renal/riñón/rinon → US_RENAL
- US + tiroides → US_THYROID
- US + mama/mamaria → US_BREAST
- US + doppler/venoso/arterial → US_DOPPLER
- MG → MG_BREAST
- si nada aplica → UNKNOWN_RADIOLOGY

## Criterios de aceptación

1. Puedo guardar un informe sin IA.
2. Puedo ejecutar extracción con IA desde un informe.
3. La IA devuelve JSON validado.
4. Se crean ExtractedFindings.
5. Hallazgos desconocidos crean FindingCandidates.
6. Candidatos repetidos incrementan occurrenceCount.
7. Puedo aceptar un candidato como nuevo hallazgo.
8. Puedo agregar candidato como sinónimo.
9. Puedo rechazar candidato.
10. Puedo confirmar, editar o rechazar hallazgos sugeridos.
11. La validación del informe no depende de confirmar códigos.
12. La API key nunca llega al frontend.
13. Se registra uso de tokens y costo estimado.
14. Se bloquean llamadas si se supera presupuesto.
15. No se envían datos personales por defecto.
16. Si OpenAI falla, el informe sigue funcionando.
17. La extracción no modifica el texto original.
