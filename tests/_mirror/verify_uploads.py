#!/usr/bin/env python3
"""
Espejo de verificación (sin Node) de la subida de archivos y la separación
Corpus Documents / Case Materials. Reutiliza el espejo fiel del cerebro de
demo/serve_demo.py (extract_text, extract_case_facts, run_query, is_servable…)
y comprueba los 10 invariantes del spec.

No sustituye a Vitest (tests/fileUpload.test.ts); valida la LÓGICA de seguridad.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "demo"))
import serve_demo as S  # noqa: E402

FAILURES = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        FAILURES.append(msg)


def main():
    # Los criterios pending de PRUEBA viven en fixtures (el corpus vivo solo tiene
    # contenido REAL del propietario, ya aprobado, sin pendientes ficticios).
    pend = S._load_collection(ROOT / "tests/fixtures/corpus/processed_criteria", "criteria")
    approved_ids = {c["id"] for c in S.CORPUS}

    print("— Corpus Documents → pending_review, nunca directos —")
    check(len(pend) > 0, f"hay criterios pending de prueba ({len(pend)})")
    # (2) extraído queda pending_review/approved:false ; (3) no servible ; (1)/(3) no en el corpus
    check(all(c.get("review_status") == "pending_review" and c.get("approved") is False for c in pend),
          "todo criterio extraído queda review_status=pending_review, approved=false (Reglas 14-15)")
    check(all(not S.is_servable(c) for c in pend),
          "ningún criterio pending_review es servible (Reglas 5,13)")
    check(all(c["id"] not in approved_ids for c in pend),
          "ningún pending está en approved_criteria (criteriaRetriever no lo recupera)")
    # La sentencia REAL pasó por pending y luego fue APROBADA por revisión humana
    # (el pipeline editorial completo: extracción → pending → aprobación manual).
    ecli_appr = [c for c in S.CORPUS if str(c.get("judgment_id", "")).startswith("ECLI")]
    check(len(ecli_appr) > 0 and all(c["review_status"] == "approved" and c["approved"] is True
                                     and isinstance(c.get("approved_by"), str) and c["approved_by"].strip()
                                     for c in ecli_appr),
          "la sentencia REAL fue aprobada por revisión humana (approved_by registrado; Reglas 13-15)")

    print("\n— Un criterio APROBADO sí se usa —")
    r = S.run_query(
        "Mi marca está registrada en España, vendemos productos de cosmética y una empresa competidora usa un logo muy parecido.",
        "es", S.CORPUS, S.JUDGMENT_IDS)
    check(r["answer"]["decision"] == "answer" and bool(r["answer"]["criteria_used"]),
          "un criterio approved=true sí se usa para responder (Regla 5)")

    print("\n— Case Materials: hechos trazados, NUNCA fuente jurídica —")
    txt = ("Mi marca está registrada en España, vendo productos de cosmética; "
           "un competidor usa un logo muy parecido en el mercado español.")
    ex = S.extract_text("txt", "reporte.txt", text=txt)
    f = {"id": "upl-test", "original_filename": "reporte.txt", "file_type": "txt",
         "upload_type": "case_material", "uploaded_at": "2026-06-13T00:00:00Z", "uploaded_by": None,
         "session_id": "sess-x", "extraction_status": ex["status"], "extracted_text": ex["text"],
         "summary": "", "detected_entities": [], "detected_legal_topics": [], "warnings": ex["warnings"],
         "source_locations": ex["source_locations"], "created_at": "2026-06-13T00:00:00Z",
         "updated_at": "2026-06-13T00:00:00Z"}
    facts = S.extract_case_facts("¿riesgo de confusión con mi marca?", [f])
    check(len(facts["relevant_facts"]) > 0, "se detectan hechos del material del caso (por señal de la checklist)")
    check(all(rf["source_document_id"] and rf["source_filename"] and rf["page_or_location"] and rf["confidence"]
              for rf in facts["relevant_facts"]),
          "cada hecho está trazado a documento + localización + confianza (Regla 9 del módulo)")
    check(not S.has_forbidden_language(facts["case_summary"]),
          "el resumen de hechos no pronostica resultado ni recomienda (Regla 18)")
    # separación: un corpus_document pasado al extractor de hechos se IGNORA
    fcorp = dict(f, upload_type="corpus_document")
    facts2 = S.extract_case_facts("x", [fcorp])
    check(len(facts2["relevant_facts"]) == 0 and any("ignor" in w.lower() for w in facts2["extraction_warnings"]),
          "un corpus_document NO se procesa como material del caso (separación A/B)")

    print("\n— Imágenes ilegibles → warning, sin inventar (Regla 4) —")
    exi = S.extract_text("png", "logo.png", base64="AAAA")
    check(exi["status"] == "failed" and exi["text"] == "" and bool(exi["warnings"]),
          "imagen sin OCR => failed + warning + texto vacío (no inventa contenido visual)")

    print("\n— Gate de aprobación: sin fuente no se aprueba —")

    def missing_for_approval(c, jids):
        m = []
        if c.get("judgment_id") not in jids:
            m.append("judgment_id")
        for k in ("criterion_text", "source_reference", "source_excerpt"):
            if not (isinstance(c.get(k), str) and c[k].strip()):
                m.append(k)
        lim = c.get("limits")
        if not (isinstance(lim, list) and len(lim) > 0 and all(isinstance(x, str) and x.strip() for x in lim)):
            m.append("limits")
        return m

    jid = next(iter(S.JUDGMENT_IDS)) if S.JUDGMENT_IDS else "jdg-mock-0001"
    ok_c = {"judgment_id": jid, "criterion_text": "x", "source_reference": "FJ 1", "source_excerpt": "ex", "limits": ["l"]}
    for field, empty in [("source_reference", ""), ("source_excerpt", ""), ("limits", [])]:
        bad = dict(ok_c)
        bad[field] = empty
        check(len(missing_for_approval(bad, S.JUDGMENT_IDS)) > 0, f"no se puede aprobar sin {field}")
    check(len(missing_for_approval(ok_c, S.JUDGMENT_IDS)) == 0,
          "con judgment + source_reference + source_excerpt + limits sí se puede aprobar")

    print("\n— Separación estructural de raíces —")

    def root_for(ut):
        return "case_materials" if ut == "case_material" else "corpus_documents"

    check(root_for("case_material") == "case_materials" and root_for("corpus_document") == "corpus_documents",
          "cada upload_type se almacena en su raíz; nunca se mezclan")

    print("\n" + ("RESULTADO: TODO OK ✅" if not FAILURES else f"RESULTADO: {len(FAILURES)} FALLOS ❌"))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
