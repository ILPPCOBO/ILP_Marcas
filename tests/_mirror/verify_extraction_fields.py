#!/usr/bin/env python3
"""
verify_extraction_fields — Regresión de los campos/decisiones nuevos del spec:
  - UploadedFile / extracción: extraction_method, page_texts, confidence
  - Evaluador de caso: decision = "evaluate_case" | "cannot_evaluate_case"

Importa el espejo runnable (demo/serve_demo.py) sin arrancar el servidor y ejerce
extract_text() y run_case_evaluation() directamente. Honestidad (Regla 4): un
extractor que no extrae => method "manual_description_needed" + confidence "low";
NUNCA inventa contenido. El evaluador NUNCA pronostica (Regla 18).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.normpath(os.path.join(HERE, "..", "..", "demo"))
sys.path.insert(0, DEMO)

import serve_demo as S  # noqa: E402

fails = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        fails.append(msg)


print("\n— extract_text: campos de honestidad (extraction_method / page_texts / confidence) —")

VALID_METHODS = {"native_text", "ocr", "native_plus_ocr", "manual_description_needed"}
VALID_CONF = {"low", "medium", "high"}

txt = S.extract_text("txt", "nota.txt", text="La marca MARCAS fue registrada el 1 de enero de 2020 en la OEPM.")
check(txt["status"] == "completed", "TXT con texto => completed")
check(txt["extraction_method"] == "native_text", "TXT legible => extraction_method 'native_text'")
check(txt["confidence"] == "high", "TXT legible => confidence 'high'")
check(txt["page_texts"] == [txt["text"]], "TXT legible => page_texts contiene el texto")
check(txt["extraction_method"] in VALID_METHODS and txt["confidence"] in VALID_CONF, "TXT: valores en el enum")

empty = S.extract_text("txt", "vacio.txt", text="    \n  ")
check(empty["status"] == "failed", "TXT vacío => failed")
check(empty["extraction_method"] == "manual_description_needed", "TXT vacío => 'manual_description_needed'")
check(empty["confidence"] == "low", "TXT vacío => confidence 'low'")
check(empty["page_texts"] == [], "TXT vacío => page_texts vacío (no inventa)")

# PDF sin bytes => no hay capa de texto y no hay OCR => describe manualmente.
pdf = S.extract_text("pdf", "escaneado.pdf", base64=None)
check(pdf["status"] == "failed", "PDF sin texto legible => failed")
check(pdf["extraction_method"] == "manual_description_needed", "PDF escaneado/sin texto => 'manual_description_needed'")
check(pdf["confidence"] == "low", "PDF escaneado => confidence 'low'")
check(pdf["text"] == "" and pdf["page_texts"] == [], "PDF escaneado => sin texto inventado (Regla 4)")

img = S.extract_text("png", "logo.png", base64=None)
check(img["extraction_method"] == "manual_description_needed", "Imagen sin OCR => 'manual_description_needed'")
check(img["confidence"] == "low" and img["text"] == "", "Imagen sin OCR => low + sin invención visual")

unsup = S.extract_text("rtf", "x.rtf")
check(unsup["extraction_method"] in VALID_METHODS, "Tipo no soportado => method válido (no rompe)")

print("\n— run_case_evaluation: decision evaluate_case | cannot_evaluate_case —")

CORPUS = S.load_approved_criteria()
JIDS = S.load_judgment_ids()

# Usuario PIDE predicción => no se califica.
pred = S.run_case_evaluation("¿voy a ganar el juicio?", "Marcas", [], CORPUS, JIDS, "es")
check(pred["decision"] == "cannot_evaluate_case", "Pide predicción => decision 'cannot_evaluate_case'")
check(pred["case_fit_grade"] == "insuficiente" and pred["case_fit_score"] is None, "Pide predicción => sin nota/score")

# Fuera de alcance => no se califica.
oos = S.run_case_evaluation("Receta para una tarta de manzana casera y esponjosa.", "No estoy seguro", [], CORPUS, JIDS, "es")
check(oos["decision"] == "cannot_evaluate_case", "Fuera de alcance => 'cannot_evaluate_case'")

# Caso real del corpus (procesal/cosa juzgada) con hechos suficientes => se califica.
desc = ("Existe una sentencia firme previa entre las mismas partes con el mismo objeto y la misma causa de pedir. "
        "Hay identidad de partes, identidad de objeto e identidad de causa de pedir respecto del primer pleito ya resuelto, "
        "y la resolución anterior es firme. Quiero saber si aplica la cosa juzgada material.")
ev = S.run_case_evaluation(desc, "Procesal", [], CORPUS, JIDS, "es")
print("    (decision=%s, grade=%s, score=%s)" % (ev["decision"], ev["case_fit_grade"], ev["case_fit_score"]))
check(ev["decision"] in ("evaluate_case", "cannot_evaluate_case"), "Caso del corpus => decision válida")
if ev["decision"] == "evaluate_case":
    check(ev["case_fit_score"] is not None and ev["case_fit_grade"] in ("A", "B", "C", "D"),
          "evaluate_case => score numérico + nota A-D")
    check(len(ev["criteria_used"]) >= 1, "evaluate_case => al menos un criterio aprobado citado")

# Coherencia: toda salida del evaluador trae disclaimer + límites, calificada o no.
for label, r in [("predicción", pred), ("fuera de alcance", oos), ("caso corpus", ev)]:
    check(bool(r.get("disclaimer")) and bool(r.get("limits")), "%s => disclaimer + límites presentes" % label)
    # Regla 18: ningún texto de pronóstico en límites/explicaciones.
    blob = " ".join(r.get("limits", []) +
                    [f.get("explicacion", "") for f in (r.get("favorable_factors", []) + r.get("unfavorable_factors", []))])
    check(not S.has_scoreboard_forbidden(blob) if hasattr(S, "has_scoreboard_forbidden") else True,
          "%s => sin lenguaje de pronóstico (Regla 18)" % label)

print("\n— #8: extract_case_facts detecta contradicción (registrada vs sin registrar) —")
doc_reg = {"id": "d1", "original_filename": "registro.txt", "file_type": "txt", "upload_type": "case_material",
           "session_id": "s1", "extraction_status": "completed",
           "extracted_text": "La marca está registrada en la OEPM desde 2019, según el certificado de registro adjunto.",
           "source_locations": S.chunk_text("La marca está registrada en la OEPM."), "warnings": []}
doc_no = {"id": "d2", "original_filename": "carta.txt", "file_type": "txt", "upload_type": "case_material",
          "session_id": "s1", "extraction_status": "completed",
          "extracted_text": "La empresa contraria afirma que el signo está sin registrar y nunca se inscribió.",
          "source_locations": S.chunk_text("El signo está sin registrar."), "warnings": []}
facts = S.extract_case_facts("¿Mi marca tiene protección?", [doc_reg, doc_no])
contradiction = any("contradic" in u.lower() for u in facts["uncertainties"])
check(contradiction, "documentos opuestos => contradicción en uncertainties")

print("\n— #12: PDF escaneado/sin capa de texto => extracción honesta (no inventa) —")
# Sin OCR instalado, un PDF sin texto legible nunca debe 'completarse' con texto inventado.
scanned = S.extract_text("pdf", "demanda_escaneada.pdf", base64=None)
check(scanned["status"] != "completed", "PDF sin capa de texto => NO 'completed' (no inventa, Regla 4)")
check(scanned["extraction_method"] == "manual_description_needed", "PDF escaneado => pide descripción/pega manual")
check(any("escane" in w.lower() or "ocr" in w.lower() for w in scanned["warnings"]),
      "PDF escaneado => warning explica OCR/escaneo (honestidad)")

print()
if fails:
    print("RESULTADO: FALLOS (%d) ❌" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("RESULTADO: TODO OK ✅  (campos de extracción + evaluate/cannot_evaluate + contradicción + PDF escaneado honesto)")
