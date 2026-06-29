# data/ — Base de conocimiento y registros

Materia prima, criterios y trazabilidad. El flujo editorial es **unidireccional** y con
revisión humana obligatoria en el medio (`CLAUDE.md` Reglas 13–15):

```
source_judgments/          processed_criteria/           approved_criteria/
(resoluciones originales) → (criterios extraídos,       → (criterios approved: true,
                             pending_review)               REVISIÓN HUMANA mediante)
```

| Carpeta | Contenido | ¿La lee el motor de respuesta? |
|---|---|---|
| `source_judgments/` | Resoluciones judiciales originales (materia prima) | **NO, nunca** (Regla 13) |
| `processed_criteria/` | Criterios extraídos, estado `pending_review` | **NO, nunca** (Reglas 5 y 14) |
| `approved_criteria/` | Criterios aprobados por revisión humana (`approved: true`) | **Sí** — única fuente del motor |
| `catalog/` | Preguntas estándar con respuestas validadas | **Sí** — solo entradas validadas |
| `audit/` | Registros de trazabilidad por respuesta (Regla 16) | No (solo lectura admin) |
| `schemas/` | JSON Schemas de las entidades + ejemplos FICTICIOS | **NO, nunca** — son especificación, no corpus |

Reglas duras:

- Nada entra en `approved_criteria/` sin un acto humano explícito de aprobación (Regla 15).
- Los scripts de extracción escriben **solo** en `processed_criteria/` y siempre con
  `pending_review` (Regla 14).
- Los esquemas de las 5 entidades núcleo están definidos en `data/schemas/` (Fase F1);
  queda pendiente solo el esquema de las entradas del catálogo. Toda lectura y escritura
  valida contra el JSON Schema **y** el validador TS correspondiente (deny-by-default).
- Datos de PRUEBA (2026-06-11): `approved_criteria/mock_criteria.json`,
  `processed_criteria/pending_mock_criteria.json` y `source_judgments/mock_judgments.json`
  son FICTICIOS, usan el envoltorio `{_warning, dataset, criteria|judgments}` (cada item
  valida contra su esquema) y deben borrarse antes de cargar el corpus real.
