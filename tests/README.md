# tests/ — Suite de seguridad obligatoria

La constitución exige **tests obligatorios para la lógica de seguridad** (`CLAUDE.md` §6).
Suites existentes:

- `scopeClassifier.test.ts` — cubre parcialmente "Rechazo sin cobertura" y
  "Deny-by-default" a nivel de clasificación.
- `missingFactsDetector.test.ts` — cubre parcialmente "Repregunta ante ambigüedad"
  (Regla 7) y "Deny-by-default" (hechos no mencionados se preguntan, nunca se asumen;
  ramas de fallback; cobertura checklist↔léxico).
- `criteriaRetriever.test.ts` — cubre "Exclusión de no aprobados" (un `pending_review`
  que coincide con la consulta JAMÁS se devuelve; estados incoherentes excluidos),
  "Corpus vacío" y "Deny-by-default" en la carga (carpeta ausente / JSON malformado /
  criterio inválido ⇒ descartados, sin excepción).
- `decisionEngine.test.ts` — cubre "Rechazo sin cobertura" (out_of_scope e
  insufficient_criteria), "Repregunta ante ambigüedad" (clarify, incl. confianza low) y
  "Deny-by-default" (contradicciones e integridad ⇒ nunca "answer"), más el pipeline
  completo de los 4 módulos sobre el corpus mock.
- `answerComposer.test.ts` — cubre "Imposibilidad de citas inventadas" (citas 1:1 desde
  metadatos, nunca un criterio fuera de `criteria_used`), "Disclaimer siempre presente"
  (Reglas 11-12) y lenguaje prudente (Regla 10: frase vetada ⇒ aborta); todas las salidas
  validan contra el modelo F1.
- `ingestion.test.ts` — flujo editorial F4/F5 sobre directorio temporal: extracción siempre
  `pending_review` (nunca `approved`, ni aunque el candidato lo pida); no extrae sin
  resolución registrada; aprobar exige usuario y fuente verificable; editar nunca aprueba;
  rechazar marca `rejected`.
- **`security.test.ts`** — suite de seguridad de extremo a extremo (`engine.runQuery` sobre
  el corpus mock) que verifica 13 propiedades del *locked advisor* con las 8 preguntas
  de ejemplo de la consigna: no responde fuera de alcance / sin criterios / con datos
  faltantes; no usa `pending_review`; siempre cita `source_reference`, límites y aviso;
  no inventa resoluciones ni normas; no valida la tesis del usuario; distingue las 4
  decisiones; guarda trazabilidad en `auditLogger`; y (propiedad 13) un **veto de
  `safetyGuardrails` o una excepción se degrada a rechazo seguro AUDITADO** (cita a
  resolución inexistente o lenguaje vetado en un criterio ⇒ sin fondo, con registro).

El resto de la tabla queda pendiente de implementarse con cada módulo. ⚠️ Sin Node.js en
esta máquina la suite no se ha ejecutado; la lógica se verifica con espejos en Python
hasta tener entorno.

## Tests innegociables (por regla de CLAUDE.md)

| Test | Comprueba | Regla |
|---|---|---|
| Rechazo sin cobertura | Consulta fuera de alcance ⇒ el sistema lo declara, no responde el fondo | 6, 8 |
| Repregunta ante ambigüedad | Consulta ambigua/incompleta/mixta ⇒ preguntas de aclaración, no respuesta | 7 |
| Exclusión de no aprobados | Criterios `pending_review` o rechazados NUNCA llegan a una respuesta, aunque sean los más relevantes | 5, 14 |
| Imposibilidad de citas inventadas | Toda cita de una respuesta corresponde a metadatos de criterios recuperados; cita sin origen ⇒ veto | 4, 9 |
| Disclaimer siempre presente | Toda respuesta incluye el recordatorio informativo | 11, 12 |
| Deny-by-default | Errores técnicos, corpus vacío, entradas raras ⇒ rechazo seguro, jamás respuesta improvisada | 17 |
| Trazabilidad completa | Cada interacción (también rechazos y repreguntas) genera exactamente un registro de auditoría con todos los campos | 16 |
| Sin red | La lógica de respuesta no realiza conexiones de red | 2 |
| Corpus vacío | Con `approved_criteria/` vacío, ninguna consulta recibe respuesta de fondo | 5, 6 |

## Tests de validación de modelos (Fase F1)

Sobre `services/models/` (y sus espejos `data/schemas/*.schema.json`):

| Test | Comprueba | Regla |
|---|---|---|
| Coherencia de aprobación | `approved: true` con `review_status ≠ "approved"` (o la inversa) ⇒ criterio inválido | 5, 14 |
| Aprobación humana registrada | `review_status: "approved"` sin `approved_by`/`approved_at` ⇒ inválido; no aprobado con esos campos ≠ null ⇒ inválido | 15 |
| Criterio sin fuente | Sin `judgment_id`, `source_excerpt` o `source_reference` ⇒ inválido | 9 |
| Respuesta sin criterios | `decision: "answer"` con `criteria_used` vacío ⇒ inválida | 1, 5 |
| Respuesta sin fuentes | `decision: "answer"` sin `sources_used` ⇒ inválida | 4, 9 |
| Citas huérfanas | `sources_used` que cita criterios no usados (o criterios usados sin cita) ⇒ inválida | 4, 9 |
| Criterio pendiente en respuesta | Respuesta que usa un criterio `pending_review` ⇒ inválida (`validateAnswerAgainstCriteria`) | 5, 14 |
| Rechazos limpios | `clarify`/`out_of_scope`/`insufficient_criteria` con criterios, fuentes o confianza ⇒ inválida | 17 |
| Disclaimer obligatorio | Cualquier respuesta sin `disclaimer` no vacío ⇒ inválida | 11, 12 |
| Resolución inexistente | Criterio o cita cuyo `judgment_id` no existe en el corpus ⇒ inválido (`validateCriterionAgainstJudgments` / `validateAnswerAgainstCriteria`) | 4, 9 |
| Coherencia pregunta↔respuesta | Query `out_of_scope` con decisión ≠ `out_of_scope`, o con `missing_facts` y decisión `answer` ⇒ inválida (`validateAnswerAgainstQuery`) | 7, 8 |
| Coherencia respuesta↔auditoría | Criterio servido que no consta como recuperado (o consta como descartado) en el AuditLog ⇒ inválido (`validateAuditConsistency`) | 4, 16 |
| Duplicados y subconjuntos | Arrays de IDs con duplicados ⇒ inválidos; `rejected` ⊄ `retrieved` ⇒ inválido | 16 |
| Datos malformados | Validadores con campos de tipo equivocado (string donde va array, null, etc.) ⇒ `{valid:false}`, NUNCA excepción | 17 |
| Path traversal | `file_path` con `..` o fuera de `data/source_judgments/` ⇒ inválido | 13 |
| Propiedades desconocidas | Objetos con campos extra ⇒ inválidos en AMBOS espejos | 17 |
| Paridad TS ↔ JSON Schema | Los ejemplos de `data/schemas/examples/` validan contra ambos espejos; los casos inválidos fallan en ambos (JSON Schema siempre con aserción de formato activada; el espejo TS es el más estricto donde JSON Schema no llega: trim, calendario, relaciones) | — |

## Regla de trabajo

Ningún módulo de `services/` se considera "implementado" hasta que sus tests de esta tabla
pasen. Los tests de seguridad no se debilitan para hacer pasar una funcionalidad: si chocan,
se reforma la funcionalidad (la constitución gana).
