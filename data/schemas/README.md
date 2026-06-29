# data/schemas/ — Esquemas de persistencia (JSON Schema 2020-12)

Espejos de persistencia de los modelos canónicos de `services/models/` (Fase F1). Toda
escritura y toda lectura de datos en `data/` debe validar contra estos esquemas —
**deny-by-default: lo que no valida, no se carga ni se guarda**.

| Esquema | Entidad | Espejo TS |
|---|---|---|
| `judgment.schema.json` | Resolución judicial original | `services/models/judgment.ts` |
| `legal_criterion.schema.json` | Criterio jurídico estructurado | `services/models/legalCriterion.ts` |
| `user_query.schema.json` | Pregunta del usuario | `services/models/userQuery.ts` |
| `advisor_answer.schema.json` | Respuesta del sistema | `services/models/advisorAnswer.ts` |
| `audit_log.schema.json` | Trazabilidad por interacción | `services/models/auditLog.ts` |

## La puerta es DOBLE: JSON Schema + validador TS

Estos esquemas son la mitad de la puerta; la otra mitad son los validadores de
`services/models/`. **Ninguno de los dos basta solo**:

- En JSON Schema 2020-12, `format` es ANOTACIÓN por defecto (no valida). Por eso todos
  los timestamps llevan además un `pattern` asertivo. Aun así, todo consumidor de estos
  esquemas DEBE activar la aserción de formato (Python `jsonschema`: `FormatChecker`;
  Ajv: `ajv-formats`).
- El espejo TS es más estricto donde JSON Schema no llega: rechaza strings de solo
  espacios (`trim`), fechas de calendario imposibles (2026-02-31), la relación
  `rejected ⊆ retrieved` del AuditLog y todo lo relacional (abajo).

## Reglas cross-field codificadas en los esquemas

- `legal_criterion`: `approved` ⇔ `review_status === "approved"` (en ambas direcciones);
  aprobado exige `approved_by`/`approved_at` (timestamp asertivo); no aprobado exige
  ambos a `null`.
- `advisor_answer`: `decision: "answer"` exige `criteria_used` y `sources_used` no vacíos
  y `confidence_level` no nulo; cualquier otra decisión exige los tres vacíos/nulos.
  Arrays de IDs con `uniqueItems`.
- `judgment`: `file_path` confinado a `data/source_judgments/` sin `..` (anti-traversal).

Lo que JSON Schema no puede expresar vive en los validadores TS de `services/models/`:

- `validateAnswerAgainstCriteria(a, criteriaById, judgmentsById)` — cada criterio usado
  existe y es servible; cada resolución citada EXISTE en el corpus.
- `validateCriterionAgainstJudgments(c, judgmentsById)` — el `judgment_id` del criterio
  apunta a una Judgment real (puerta de aprobación en admin/).
- `validateInteraction(q, a, log)` — coherencia pregunta ↔ respuesta ↔ auditoría
  (fuera de alcance ⇒ `out_of_scope`; datos faltantes ⇒ no hay `answer`; criterio
  servido ⇒ consta como recuperado y no descartado).

## Sincronización y migración

- Un cambio de modelo toca **TS + JSON Schema + ejemplos en el mismo commit**.
- En la migración a base de datos real, estos esquemas son la especificación de las
  tablas y sus constraints (ver plan en `services/models/README.md`).
