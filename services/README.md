# services/ — El cerebro cerrado

Aquí viven los módulos que implementan el flujo cerrado de `CLAUDE.md` §4. Son la única
"inteligencia" del sistema y deben ser **deterministas, auditables y testeables**.

## Módulos y orden en el pipeline

| # | Módulo | Función | Reglas que aplica |
|---|---|---|---|
| 1 | `scopeClassifier` | **IMPLEMENTADO (F2)** — clasifica la consulta (área/tema/subtemas) con léxico cerrado determinista y decide si encaja en el alcance temático | 1, 8 |
| 2 | `missingFactsDetector` | **IMPLEMENTADO (F2)** — detecta hechos esenciales no mencionados (listas cerradas por tema) → repreguntas desde plantillas fijas | 7 |
| 3 | `criteriaRetriever` | **IMPLEMENTADO (F2)** — recupera criterios por área/tema/subtemas **solo** de `data/approved_criteria/`, con `isServable()` como puerta dura y carga deny-by-default | 1, 5, 6 |
| 4 | `decisionEngine` | **IMPLEMENTADO (F2)** — cascada fija de prioridades: out_of_scope → clarify (incl. ambigüedad) → insufficient_criteria (incl. integridad) → answer | 5, 6, 7, 8, 17 |
| 5 | `answerComposer` | **IMPLEMENTADO (F2)** — compone por plantillas las 4 decisiones; "answer" en 6 secciones, citas SOLO desde metadatos, lenguaje prudente con guardarraíl, valida la salida contra el modelo | 4, 9, 10, 11, 12 |
| 6 | `auditLogger` | **IMPLEMENTADO (F2, mínimo)** — `buildAuditRecord` (valida contra el modelo) + registro en memoria; persistencia JSONL en F6 | 16 |
| 7 | `safetyGuardrails` | **IMPLEMENTADO (F2)** — veto final: revalida la salida (estructura, criterios servibles, citas con resolución existente) antes de servir; el engine convierte un veto en rechazo seguro auditado | 4, 5, 9, 11, 12, 16, 17 |

`types.ts` define los contratos compartidos entre módulos. `engine.ts` es el orquestador
que encadena los módulos en el orden de CLAUDE.md §4 (`runQuery`), aplica el veto final de
`safetyGuardrails` y produce, por consulta, una `AdvisorAnswer` trazable más su `AuditLog`.
Garantiza dos invariantes del lazo: (1) ninguna rama sirve fondo sin pasar por
`decisionEngine` Y por `safetyGuardrails`; (2) TODA interacción se audita, también el
rechazo seguro producido por un veto o una excepción (Reglas 16-17). `judgmentRegistry.ts`
carga el índice de resoluciones (solo metadatos de id) para que el guardarraíl verifique que
cada cita apunta a una resolución existente. Lo usa el backend (`backend/server.ts`).

## Invariantes de esta carpeta

- **Ningún módulo accede a internet.** (Regla 2)
- **Ningún módulo lee `data/source_judgments/` ni `data/processed_criteria/`** para responder
  al usuario. Solo `data/approved_criteria/` y `data/catalog/` son legibles por el motor de
  respuesta. (Reglas 5 y 13) — `criteriaRetriever` lee exclusivamente `approved_criteria/`;
  el catálogo tendrá su propio módulo de servicio (`catalogService`, por definir en F1),
  sometido a los mismos guardarraíles y a la misma puerta `review_status === "approved"`.
- **El LLM nunca decide.** Si en el futuro un LLM interviene en la redacción, recibe solo
  material recuperado del corpus y sus secciones de citas/disclaimer se ensamblan por código.
  (Regla 3, `CLAUDE.md` §6)
- **Stub no implementado = rechazo.** Mientras un módulo no esté implementado, su salida es
  rechazar/no-cubierto, jamás una respuesta simulada. (Regla 17)
- **Alcance ≠ cobertura.** `scopeClassifier` decide si la consulta encaja TEMÁTICAMENTE en
  el corpus (léxico cerrado); si existen criterios aprobados que la cubran lo deciden
  `criteriaRetriever` + `decisionEngine` (Reglas 5 y 6). Su léxico se amplía solo por
  decisión explícita de mantenimiento, nunca en caliente.
- **Puente ScopeResult → UserQuery / corpus.** El clasificador emite nombres visibles en
  castellano; al volcarlos al modelo de datos: `classified_area` =
  `scopeAreaToLegalArea(area)` (null si fuera de alcance — la marca real es
  `out_of_scope`), `classified_topic` = `toCorpusTopicKey(topic)` ("riesgo de confusión" →
  "riesgo_de_confusion"); los subtemas usan el mismo `toCorpusTopicKey` y sus nombres están
  alineados con los `subtopic` del corpus.
