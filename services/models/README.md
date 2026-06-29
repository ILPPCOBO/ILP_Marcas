# services/models/ — Modelos de datos canónicos (Fase F1)

Las cinco entidades con las que trabaja el sistema. **El motor trabaja con criterios
estructurados, nunca con sentencias crudas** (Regla 13).

## Entidades y relaciones

```
Judgment 1 ──── n LegalCriterion          (judgment_id: de qué resolución se extrajo)
                      │
                      │  solo si isServable() — review_status "approved" (Regla 5)
                      ▼
UserQuery 1 ─── 1 AdvisorAnswer           (query_id)
     │                │
     └────── 1 AuditLog ◄─────────────────(query_id + answer_id)
```

Trazabilidad de la Regla 16 = la cadena `UserQuery ⋈ AdvisorAnswer ⋈ AuditLog`:
pregunta original (UserQuery) + decisión, criterios, fuentes y límites (AdvisorAnswer)
+ el porqué interno del motor (AuditLog). Toda interacción crea las tres.

## Dónde vive cada cosa

| Capa | Ubicación | Para qué |
|---|---|---|
| Interfaces + validadores TS | `services/models/*.ts` | contratos del código del pipeline |
| JSON Schemas | `data/schemas/*.schema.json` | formato de persistencia, validación independiente del lenguaje |
| Ejemplos ficticios | `data/schemas/examples/` | documentación; JAMÁS servibles |

Los dos espejos (TS y JSON Schema) deben mantenerse sincronizados: un cambio de modelo
toca ambos en el mismo commit.

## Validaciones constitucionales (innegociables)

| Validación | Dónde | Regla |
|---|---|---|
| `approved` debe equivaler a `review_status === "approved"` (en ambas direcciones) | `validateLegalCriterion` | 5, 14 |
| Aprobar exige humano registrado: `approved_by` + `approved_at`; null si no aprobado | `validateLegalCriterion` | 15 |
| Un criterio `pending_review` no puede usarse para responder | `isServable` + `validateAnswerAgainstCriteria` | 5, 14 |
| `decision: "answer"` exige `criteria_used` no vacío | `validateAdvisorAnswer` | 1, 5 |
| `decision: "answer"` exige `sources_used` no vacío | `validateAdvisorAnswer` | 4, 9 |
| Cada cita ↔ criterio usado (correspondencia 1:1, sin citas huérfanas ni duplicadas) | `validateAdvisorAnswer` | 4, 9 |
| Repreguntas y rechazos con `criteria_used`/`sources_used` VACÍOS | `validateAdvisorAnswer` | 17 |
| `disclaimer` no vacío en TODA respuesta, sea cual sea la decisión | `validateAdvisorAnswer` | 11, 12 |
| Criterio sin `judgment_id`/`source_excerpt`/`source_reference` es inválido | `validateLegalCriterion` | 9 |
| El `judgment_id` del criterio apunta a una Judgment REAL del corpus | `validateCriterionAgainstJudgments` + `validateAnswerAgainstCriteria` | 4, 9 |
| Toda resolución citada en `sources_used` existe en el corpus | `validateAnswerAgainstCriteria` | 4, 9 |
| Consulta fuera de alcance ⇒ decisión `out_of_scope`; con datos faltantes ⇒ nunca `answer` | `validateAnswerAgainstQuery` | 7, 8 |
| Criterio servido ⇒ consta como recuperado y NO descartado en el AuditLog | `validateAuditConsistency` | 4, 16 |
| `rejected_criteria_ids` ⊆ `retrieved_criteria_ids`, sin duplicados en arrays de IDs | `validateAuditLog` | 16 |
| Propiedades desconocidas rechazadas (paridad con `additionalProperties: false`) | todos los `validateX` | 17 |
| `file_path` confinado a `data/source_judgments/` sin `..` (anti path-traversal) | `validateJudgment` | 13 |
| Datos malformados ⇒ resultado inválido, NUNCA excepción | todos los `validateX` | 17 |

`isServable()` (en `legalCriterion.ts`) es la ÚNICA puerta de servibilidad legítima.
Cualquier comprobación dispersa (`c.approved === true` suelto por el código) es un bug.

## Nota sobre `approved` (decisión de diseño)

`review_status` es el estado canónico. El flag `approved` se conserva porque es la forma
literal de la constitución ("approved: true", Regla 5), pero es **redundante por diseño**:
la validación rechaza cualquier incoherencia y `isServable()` exige que ambos coincidan.
En la migración a base de datos real, `approved` debe ser columna generada
(`GENERATED ALWAYS AS (review_status = 'approved')`) o llevar una CHECK constraint.

## Migración futura a base de datos real

Pensado para mapear 1:1 a tablas relacionales:

- Cada interfaz = una tabla; arrays de strings = tablas hijas o columnas JSON.
- Los enums (`LegalArea`, `ReviewStatus`, `ConfidenceLevel`, `AnswerDecision`) = tipos
  enum / CHECK constraints.
- Las validaciones de `validateX()` = constraints del esquema (NOT NULL, CHECK, FK):
  **las reglas constitucionales deben vivir también en la base de datos**, no solo en
  el código.
- FKs: `legal_criterion.judgment_id → judgment.id`, `advisor_answer.query_id →
  user_query.id`, `audit_log.query_id/answer_id → user_query.id/advisor_answer.id`.
- Cardinalidades 1:1 con UNIQUE: `UNIQUE advisor_answer.query_id`,
  `UNIQUE audit_log.query_id`, `UNIQUE audit_log.answer_id` — sin ellos la BD admitiría
  N respuestas por pregunta, contra el diagrama y el "exactamente un AuditLog".
- Las validaciones condicionadas a `decision` (3 y 4: `answer` ⇒ criterios/fuentes no
  vacíos) NO son expresables como CHECK simple si los arrays pasan a tablas hijas:
  exigen trigger, constraint diferida o validación transaccional en la capa de acceso.
  Decidir el mecanismo al elegir el motor; hasta entonces la puerta es el validador TS.
- Hasta entonces, persistencia prevista: JSON en `data/` validado contra
  `data/schemas/*.schema.json` **y** los `validateX()` de TS al leer Y al escribir
  (deny-by-default: lo inválido no se carga). El espejo TS es el más estricto de los
  dos (trim, fechas de calendario, relaciones entre entidades) — ver
  `data/schemas/README.md`.
