# Auditoría técnica — 2026-06-16

Auditoría adversarial multi-agente (6 dimensiones agrupadas de las 15 del encargo;
hallazgo → verificación independiente). **15 defectos reclamados → 12 confirmados →
todos reparados, cubiertos por test o documentados como limitación honesta.**

Regla central preservada: la herramienta evalúa **alineación con los criterios
aprobados del corpus**, NUNCA "probabilidad de ganar" (Regla 18).

## Lo que estaba roto / incompleto y cómo se reparó

| # | Sev | Hallazgo | Reparación |
|---|-----|----------|-----------|
| 1 | **BLOCKER** | `asksForPrediction()` solo miraba `description`; una predicción colada en `asunto_hint` evadía la Regla 18 y devolvía nota A/B | Se inspecciona también `asunto_hint` (texto libre no confiable) y se añade al guardarraíl final. `caseEvaluator.ts`, `serve_demo.py`, `standalone_brain.js` |
| 2 | HIGH | `PREDICTION_REQUEST` no cubría conjugaciones: `ganaremos`, `ganará`, `ganaría`, `gane`, `podrías ganar`, `perspectivas de éxito` | Patrones de futuro/condicional/subjuntivo (con y sin objeto). 3 motores |
| 3,4 | HIGH | Denylist de salida no vetaba pronóstico "blando": *buenas probabilidades de éxito*, *será ganado*, *es probable que gane*, *perspectivas de éxito*, *habría ganado* | +14 patrones en `FORBIDDEN_PATTERNS` (answerComposer); el scoreboard y el evaluador los heredan. Espejados en demo y standalone |
| 5 | MEDIUM | `asunto_hint` sin validar | Se pasa por el guardarraíl de predicción + lenguaje vetado (defensa en profundidad) |
| 6 | HIGH | PDF/DOCX sin adaptador no caen a OCR | **Limitación honesta documentada** (ver abajo). NO es un bug: el stub declara el estado y pide describir/pegar; nunca inventa (Regla 4) |
| 7 | HIGH | Faltaba la ruta `POST /api/evaluate` en el backend TS (el evaluador existía pero no estaba expuesto) | Añadido `handleEvaluate` (espeja `handleScoreboard`: exige aviso aceptado, carga case_materials de la sesión, traza la decisión) |
| 8 | MEDIUM | Sin test de contradicción (registrada vs sin registrar) | `verify_extraction_fields.py` |
| 9 | HIGH | Sin test del path de excepción de `extractText` (deny-by-default) | `fileUpload.test.ts` (extractor que lanza → failed) |
| 10,11 | MEDIUM | `source_locations.page`/`section` sin test | `fileUpload.test.ts` (extractor configurado mock) |
| 12 | HIGH | Sin test de PDF mixto / escaneado | `verify_extraction_fields.py` (PDF escaneado → honesto, no inventa) |

Descartados (3): falsos positivos verificados por el segundo agente.

## Huecos del spec rellenados (además de los 12 defectos)

- Carpeta `data/case_materials/` (primer nivel, con `.gitignore` de privacidad). Las
  rutas de `services/uploads` y del demo apuntan ahí; lectura compatible con la
  ubicación anterior `data/uploads/case_materials`.
- `UploadedFile`: campos `extraction_method` (`native_text | ocr | native_plus_ocr |
  manual_description_needed`), `page_texts[]`, `confidence` (`low | medium | high`).
  Poblados por la capa de extracción (TS + demo + standalone) de forma honesta.
- `decisionEngine`: `decideCaseEvaluation()` → `evaluate_case | cannot_evaluate_case`,
  reutilizando la misma cascada deny-by-default. Expuesto como `decision` en la salida
  del evaluador.

## Verificación (sin Node en esta máquina)

7 espejos runnable en verde + smoke-test del HTML offline en **JavaScriptCore** (el
motor real de Safari/WebKit): compila los 3 `<script>` sin error (no hay página en
blanco) y ejecuta el evaluador con la data embebida → caso procesal real:
`evaluate_case`, grade B, score 75, 4 criterios. Tests TS añadidos (corren con `npm
test` cuando haya Node): `fileUpload`, `caseEvaluator`, `decisionEngine`.

## Cómo se usa (recetas)

**Subir una sentencia real al corpus** (panel admin `:8788`, o demo): subir el PDF/TXT
→ registrar metadatos del `Judgment` → se extraen criterios CANDIDATOS que quedan
`pending_review` (Reglas 13–15). Nunca responden todavía.

**Aprobar criterios**: en el panel, revisar cada criterio pendiente. Solo se aprueba si
tiene `judgment_id` + `criterion_text` + `source_reference` + `source_excerpt` +
`limits` y NO contiene lenguaje vetado. La aprobación es un acto humano (Regla 15);
ningún proceso automático promueve a `approved`.

**Subir documentos del caso** (usuario): zona "Materiales del caso" → se extrae el texto
(TXT real; PDF con capa de texto; escaneado/imagen → OCR si está instalado, si no pide
describir/pegar) → `caseFactsExtractor` saca hechos trazados a documento/página. Son
SOLO hechos; nunca crean criterios ni son fuente jurídica.

**Cómo se genera la calificación (Case Fit Grade)**: hechos del caso vs criterios
APROBADOS → `caseScoreboard` calcula cobertura → letras A–D + `confidence`. A: ≥80 y sin
hechos faltantes; B: ≥60; C: ≥40; D: <40. Contradicciones y documentos ilegibles bajan
el score/confianza. NO se califica (`cannot_evaluate_case`) si: fuera de alcance, sin
criterios aprobados, faltan hechos esenciales, solo criterios pending, documento
ilegible, o el usuario pide una predicción. Siempre lleva límites + aviso.

## OCR de PDF escaneado/imágenes — RESUELTO (2026-06-16)

Ya NO es una limitación: se instaló Node y un **motor OCR nativo de macOS** (Vision +
PDFKit, `lla_ocr`), sin Homebrew ni sudo. Los PDF escaneados e imágenes se leen
automáticamente (95.9 % de confianza en el PDF real de prueba), siempre de forma LOCAL
(Regla 2) y sin inventar (Regla 4). Detalle en [node-ocr.md](node-ocr.md).

- TXT y PDF con capa de texto → nativo (rápido).
- PDF escaneado e imágenes → OCR Vision (es+en) en el demo (`serve_demo.py`) y en el
  backend TS (`visionOcr.ts`). El HTML offline conserva el camino de pegar (el navegador
  no accede al motor nativo).
- DOCX: el demo lo lee (zipfile); en TS sigue como stub (pegar texto) — secundario.

Al ejecutar por fin el TS real (Node) se halló y corrigió un bug del guardarraíl de
Regla 18: en JS `\b` es ASCII y no casaba palabras con vocal final acentuada
("ganará"); arreglado des-acentuando el texto en los guardarraíles. Ver node-ocr.md.
