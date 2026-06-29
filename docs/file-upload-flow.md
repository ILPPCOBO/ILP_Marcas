# Flujo de archivos — Corpus Documents vs Case Materials

Dos clases de archivo que **nunca se mezclan**. La separación es estructural (raíces distintas,
módulos distintos, sin ruta de un lado al otro), no una mera convención.

## A) Corpus Documents (sentencias/resoluciones) — fuente jurídica POTENCIAL

```
admin sube sentencia (PDF/DOCX/TXT)            [panel interno :8788]
  → extractText            (texto + página/sección; sin red, Regla 2)
  → registerJudgment       (metadatos → data/source_judgments/)
  → UploadedFile           (→ data/uploads/corpus_documents/)
  → criterionExtractor     (un humano marca candidatos: hecho/razonamiento/criterio/límites)
  → extractPendingCriteria (SELLA a review_status:"pending_review", approved:false)  ← Reglas 14-15
  → data/processed_criteria/                    (NO servible)
  → REVISIÓN HUMANA en el panel (editar / aprobar / rechazar)
  → approveCriterion       (única puerta: exige judgment + source_reference + source_excerpt + limits)
  → data/approved_criteria/                     (recién AHORA el motor puede usarlo)  ← Reglas 5, 13
```

Un Corpus Document **jamás** responde directamente al usuario (Regla 13). Si no hay candidatos
claros, no se extrae nada (deny-by-default): el sistema no inventa criterios (Regla 4).

## B) Case Materials (documentos del caso del usuario) — SOLO evidencia

```
usuario sube su documento (PDF/DOCX/TXT/PNG/JPG/JPEG)     [interfaz :8787, POST /api/upload]
  → extractText            (TXT real; PDF/DOCX/imagen = adaptador honesto + warning si no hay extractor)
  → UploadedFile           (→ data/uploads/case_materials/, gitignored: datos personales)
  → caseFactsExtractor     (detecta hechos por SEÑAL de la checklist cerrada, los TRAZA al documento)
  → {case_summary, relevant_facts[], missing_facts, evidence_items, possible_topics, uncertainties, warnings}
```

Un Case Material **nunca** es fuente jurídica, **nunca** crea criterios y **nunca** entra al corpus:
el `caseFactsExtractor` no tiene ninguna ruta de escritura a `processed_criteria`/`approved_criteria`.
Su salida es preparación factual para compararla con criterios **ya aprobados**; **no** concluye
ganar/perder ni recomienda acciones (Regla 18).

## Trazabilidad (Regla 16)

`data/audit/ingestion_events.jsonl` registra subida / extracción (status + warnings) / hechos
extraídos / criterios extraídos. La aprobación/rechazo de criterios queda en `data/review_log.jsonl`.

---

## Cómo cargar la PRIMERA sentencia real (cuando haya Node ≥ 22)

> Los criterios extraídos quedan SIEMPRE en `pending_review`. Nada llega a responder al usuario sin
> que **tú** lo apruebes a mano (Regla 15).

1. **Arranca el panel interno**: `npm run panel` → http://localhost:8788
2. **Sube la sentencia** (PDF/DOCX/TXT) eligiendo `upload_type: corpus_document` y rellena los
   metadatos del `Judgment` (título, tribunal, fecha, número de resolución, área, temas, jurisdicción).
   El original se guarda en `data/source_judgments/`.
3. **Lee el texto extraído** que muestra el panel y, por cada criterio, escribe un candidato
   separando: el **criterio** (`criterion_text`), sus **límites** (`limits`), lo que **no responde**
   (`does_not_answer`), y pega el **extracto verbatim** (`source_excerpt`) + su **localización**
   (`source_reference`, p. ej. "FJ 3º"). No conviertas el resultado del caso en regla general.
4. Los candidatos quedan en `pending_review` (`data/processed_criteria/`).
5. **Revisa y aprueba** en el panel. No podrás aprobar si falta `judgment_id`, `criterion_text`,
   `source_reference`, `source_excerpt` o `limits`.
6. Al aprobar, el criterio pasa a `data/approved_criteria/` y **solo entonces** el motor lo usa.

Alternativa por CLI: `npm run review` (mismo pipeline, sin navegador).

> Sin Node aquí no se ejecutan los servidores; el `.txt` de un Case Material sí puede probarse en el
> demo (`python3 demo/serve_demo.py` → subir un .txt en "Materiales del caso"). PDF/DOCX/OCR requieren
> instalar Node + las librerías (pdfjs-dist / mammoth / tesseract.js) para activar los extractores reales.
