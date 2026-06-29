# data/catalog/ — Preguntas estándar validadas

Aquí vivirá el **catálogo de preguntas frecuentes** con respuestas pre-redactadas y validadas
por revisión humana: la vía de consulta que no requiere generación alguna en tiempo de
respuesta. De momento está vacío.

## Reglas (CLAUDE.md)

- Cada entrada del catálogo es una respuesta **cerrada y validada**: texto fijo, aprobado por
  un revisor humano, con sus criterios de respaldo y resoluciones de origen citadas
  (Reglas 9 y 15).
- Una entrada que no tenga **`approved: true`** no se muestra al usuario (Regla 1 / Regla 5
  aplicada al catálogo, y Regla 17: deny-by-default). A diferencia de los criterios
  (`LegalCriterion`, con `review_status` + `approved`), la pregunta del catálogo se gobierna
  por el **booleano `approved`** (no replica el doble estado de los criterios).
- Toda entrada incluye el recordatorio de orientación informativa — no asesoramiento
  (Reglas 11–12).
- Toda entrada **debe** referenciar los IDs de los criterios de `data/approved_criteria/`
  que la respaldan; una entrada sin ese respaldo verificable no es publicable. Nunca se
  apoya en conocimiento general (Reglas 1, 3, 5 y 9).

## Estructura (implementada)

- `categories.json` — vocabulario CERRADO de áreas y temas. Una pregunta solo puede
  pertenecer a un par `area/topic` listado aquí.
- `catalog_questions.json` (y cualquier otro `*.json`) — preguntas (`CatalogQuestion`,
  modelo en `services/models/catalogQuestion.ts`, espejo `data/schemas/`). Las actuales son
  **FICTICIAS de prueba** (borrar antes de producción).

Servicio en `services/catalog/`: `getCatalogTree` / `listApprovedQuestions` /
`getApprovedQuestion` (solo lectura, solo servibles) y `services/catalog/admin.ts`
(crear/editar/aprobar/rechazar — única vía a `approved:true`). API de solo lectura en
`backend/server.ts` (`/api/catalog/*`), navegación en `frontend/catalog.html`.

## Puertas (una pregunta se MUESTRA solo si)

1. `approved: true` (Regla 1).
2. `related_criteria_ids` no vacío y **todos** sus criterios están realmente aprobados en
   `data/approved_criteria/` (Regla 2 — verificado al servir, no basta con afirmarlo).
3. `source_references` no vacío (Regla 3).
4. `limits` no vacío; el aviso de no asesoramiento se añade al servir (Regla 4 + 11-12).

`approved: true` solo lo otorga una revisión humana (`services/catalog/admin.ts`), registrada
en `last_reviewed_by`/`last_reviewed_at` y en `data/catalog_review_log.jsonl`.
