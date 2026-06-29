# data/processed_criteria/ — Criterios extraídos (pendientes de revisión)

Aquí se depositarán los **criterios jurídicos estructurados** extraídos de las resoluciones de
`data/source_judgments/` (manualmente o con ayuda de herramientas). De momento está vacío.

## Reglas (CLAUDE.md)

- Todo criterio que entre aquí lo hace con **`review_status: "pending_review"`** y
  **`approved: false`** — sin excepciones, también si la extracción parece perfecta
  (Regla 14). `review_status` es el estado canónico; el flag `approved` es redundante por
  diseño y la validación rechaza cualquier incoherencia entre ambos (ver
  `services/models/legalCriterion.ts` y `data/schemas/legal_criterion.schema.json`).
- **El motor de respuesta NUNCA lee esta carpeta** (Regla 5): un criterio pendiente no es
  servible al usuario final.
- La única salida de esta carpeta es la **revisión humana** (vía `admin/`): un revisor
  aprueba (→ `data/approved_criteria/`) o rechaza el criterio (Regla 15).
- Cada criterio debe traer su trazabilidad: resolución de origen, tribunal, fecha y extracto
  textual que lo sustenta (Regla 9). Un criterio sin fuente verificable no puede aprobarse.

El esquema del criterio está definido (Fase F1): `data/schemas/legal_criterion.schema.json`
(persistencia) y `services/models/legalCriterion.ts` (modelo canónico TS). Todo archivo de
esta carpeta debe validar contra ambos.

Nota: `pending_mock_criteria.json` son datos de prueba **FICTICIOS** (2026-06-11) para
verificar que los criterios `pending_review` quedan excluidos de toda respuesta. Borrar
antes de cargar el corpus real.

**Quién escribe aquí:** el flujo de ingesta (`services/ingestion`) — `extractPendingCriteria`
escribe cada criterio extraído como `<id>.json` (`{criteria:[…]}`), siempre `pending_review`.
La revisión humana (`admin/review-cli.ts`) lo aprueba (→ se mueve a `approved_criteria/`),
lo rechaza o lo edita aquí mismo. Ningún proceso automático escribe en `approved_criteria/`.
