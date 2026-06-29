# services/ingestion/ — Flujo interno de ingesta y revisión (F4/F5)

Convierte resoluciones originales en criterios **revisables**, nunca servibles directamente.
Materializa el pipeline editorial de `CLAUDE.md` (Reglas 13-15).

```
registerJudgment          cataloga la resolución (metadatos) → data/source_judgments/
   → extractPendingCriteria  extrae candidatos SELLADOS a pending → data/processed_criteria/
      → listForReview         muestra los pendientes con su resolución (revisión humana)
         → approveCriterion   ÚNICA puerta a data/approved_criteria/ (humano + fuente)
         → rejectCriterion    marca rejected, registra motivo
         → editCriterion      corrige contenido; SIGUE pending (editar nunca aprueba)
```

## Garantías constitucionales (verificadas con tests)

| Garantía | Cómo se impone | Regla |
|---|---|---|
| Las resoluciones originales no responden al usuario | El motor solo lee `approved_criteria/`; la ingesta no las expone | 13 |
| Todo criterio extraído nace `pending_review` / `approved:false` | `sealPending` fuerza el estado, ignorando lo que traiga el candidato | 14 |
| La extracción nunca escribe en `approved_criteria/` | `extractPendingCriteria` solo escribe en `processed_criteria/` | 1 |
| Solo la aprobación humana mueve a `approved` | `approveCriterion` es el único escritor de `approved_criteria/` | 2, 15 |
| La aprobación se registra con usuario y fecha | `approved_by`/`approved_at` en el criterio + evento en `review_log` | 3 |
| Vínculo criterio → resolución | `judgment_id` obligatorio; debe coincidir con la resolución | 4 |
| Sin fuente verificable no se aprueba | `validateCriterionAgainstJudgments` + `isServable` antes de mover | 5 |

## El extractor es pluggable; el sellado no

`CriterionExtractor` (en `types.ts`) abstrae la GENERACIÓN de candidatos. Hoy:

- `passthroughExtractor` — usa candidatos provistos por el operador humano (cada uno con su
  `source_excerpt` verbatim).
- `unconfiguredLlmExtractor` — **lanza** (deny-by-default): el sistema no inventa criterios.
  Un futuro extractor asistido por LLM debe emitir extractos verbatim y seguir pasando por
  `sealPending` + validación.

Sea cual sea el extractor, `extractPendingCriteria` sella a pending y valida contra el modelo;
un candidato que no valida (o cuyo `judgment_id` no coincide) se **rechaza y no se escribe**.

## Uso (requiere Node ≥ 22)

Programático: `import { registerJudgment, extractPendingCriteria, approveCriterion, … } from "services/ingestion"`.
Revisión por terminal: `npm run review -- list | approve <id> --by "…" | reject … | edit …`
(ver `admin/review-cli.ts`).

Almacenamiento (rutas inyectables vía `IngestionPaths` para tests): resoluciones en
`data/source_judgments/<id>.judgment.json` + `ingestion_manifest.json` (notes/procedencia);
candidatos en `data/processed_criteria/<id>.json`; aprobados en
`data/approved_criteria/<id>.json`; historial en `data/review_log.jsonl` (append-only).

## Nota de entorno

Sin Node.js en esta máquina, los tests Vitest (`tests/ingestion.test.ts`) no se han ejecutado;
la lógica está verificada con un espejo en Python sobre un directorio temporal (18/18).
