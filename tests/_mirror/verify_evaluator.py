#!/usr/bin/env python3
"""
Espejo de verificación del EVALUADOR DE CASO (Case Fit Grade). Reutiliza
serve_demo.py y comprueba los 14 puntos del spec: documentos del usuario solo
como hechos (nunca fuente jurídica ni criterios), solo criterios aprobados,
nunca pending, NUNCA lenguaje de probabilidad de ganar, factores con criterio +
fuente + evidencia, condiciones para no calificar, y trazabilidad.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "demo"))
import serve_demo as S  # noqa: E402

FAIL = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        FAIL.append(msg)


def case_file(text, status=None, ftype="txt", sid="sess-e", fid="upl-e", case_id="case-1"):
    ex = S.extract_text(ftype, fid + ("." + ftype), text=text if ftype == "txt" else None, base64=None if ftype == "txt" else "AAAA")
    return {"id": fid, "case_id": case_id, "original_filename": fid + "." + ftype, "file_type": ftype,
            "upload_type": "case_material", "uploaded_at": "2026-06-13T00:00:00Z", "uploaded_by": None,
            "session_id": sid, "extraction_status": status or ex["status"], "extracted_text": ex["text"],
            "summary": "", "detected_entities": [], "detected_legal_topics": [], "warnings": ex["warnings"],
            "source_locations": ex["source_locations"], "created_at": "2026-06-13T00:00:00Z", "updated_at": "2026-06-13T00:00:00Z"}


COMPLETE = ("Mi marca está registrada en España, vendo productos de cosmética; un competidor usa un logo muy "
            "parecido y ambas operamos en el mercado español.")


def alltext(ev):
    parts = []
    for f in ev["favorable_factors"] + ev["unfavorable_factors"]:
        parts += [f["factor"], f.get("explicacion", "")]
    for u in ev["uncertain_factors"]:
        parts += [u["factor"], u["why_it_matters"], u["what_is_missing"]]
    parts += ev["limits"] + [ev["disclaimer"], ev["reason"] or "", ev["case_summary"]]
    return " ".join(parts)


def main():
    approved_ids = {c["id"] for c in S.CORPUS}

    print("— Caso con descripción + documento (calificación) —")
    ev = S.run_case_evaluation(COMPLETE, "Marcas", [case_file(COMPLETE)], S.CORPUS, S.JUDGMENT_IDS)
    check(ev["case_fit_grade"] in ("A", "B", "C", "D") and isinstance(ev["case_fit_score"], int),
          f"calificación generada: {ev['case_fit_grade']} ({ev['case_fit_score']}/100, conf {ev['confidence_level']})")
    # 3 + 1: solo criterios aprobados; documentos NO son fuente jurídica
    check(len(ev["criteria_used"]) > 0 and all(c["criterion_id"] in approved_ids for c in ev["criteria_used"]),
          "criteria_used proceden SOLO del corpus aprobado (los documentos no son fuente jurídica)")
    # 9 + 10: cada factor favorable/desfavorable con criterio + fuente + (favorables) evidencia
    check(all(f["criterion_id"] and f["source_reference"] and f["judgment_id"] and f.get("explicacion") for f in ev["favorable_factors"]) and
          all(f.get("evidence") for f in ev["favorable_factors"]),
          "cada factor FAVORABLE tiene criterio + fuente + explicación + evidencia")
    check(all(f["criterion_id"] and f["source_reference"] and f["judgment_id"] and f.get("explicacion") for f in ev["unfavorable_factors"]),
          "cada factor DESFAVORABLE tiene criterio + fuente + explicación")
    # 11: límites + aviso
    check(any("no predice" in l.lower() for l in ev["limits"]) and "no constituye asesoramiento" in ev["disclaimer"].lower(),
          "incluye límites (no predice) + aviso de no asesoramiento")
    # 14: hechos con source_type (distingue descripción del usuario vs documento)
    facts = S.extract_case_facts(COMPLETE, [case_file(COMPLETE)])
    check(all(rf["source_type"] in ("user_description", "uploaded_document") for rf in facts["relevant_facts"]),
          "cada hecho lleva source_type (descripción del usuario / documento subido)")

    print("\n— 8 / Regla 18: nunca probabilidad de ganar —")
    check(not S.has_scoreboard_forbidden(alltext(ev)), "ningún texto de la evaluación contiene pronóstico/probabilidad")

    print("\n— 6 / condición: el usuario PIDE una predicción → no se califica —")
    ev2 = S.run_case_evaluation("Mi logo se parece al de un competidor, ¿voy a ganar el juicio?", "Marcas", [], S.CORPUS, S.JUDGMENT_IDS)
    check(ev2["case_fit_grade"] == "insuficiente" and ev2["case_fit_score"] is None and "predicc" in (ev2["reason"] or "").lower(),
          "petición de predicción de victoria => no se califica + explica por qué (13)")

    print("\n— condición: fuera del corpus => no se califica —")
    ev3 = S.run_case_evaluation("Tengo un problema penal de estafa y robo", "No estoy seguro", [], S.CORPUS, S.JUDGMENT_IDS)
    check(ev3["case_fit_grade"] == "insuficiente" and ev3["reason"], "asunto fuera del corpus => insuficiente + motivo")

    print("\n— 4 / 2: solo criterios pending => no se califica (no se usan ni se crean) —")
    pend = [c for c in S._load_collection(S.DATA / "processed_criteria", "criteria")][:1]
    only_pending = [dict(S.CORPUS[0], id="crit-pend", review_status="pending_review", approved=False, approved_by=None, approved_at=None)]
    ev4 = S.run_case_evaluation(COMPLETE, "Marcas", [case_file(COMPLETE)], only_pending, S.JUDGMENT_IDS)
    check(ev4["case_fit_grade"] == "insuficiente", "con solo criterios pending => no se califica")

    print("\n— 7: faltan hechos esenciales => insuficiente —")
    ev5 = S.run_case_evaluation("Tengo una marca.", "Marcas", [], S.CORPUS, S.JUDGMENT_IDS)
    check(ev5["case_fit_grade"] == "insuficiente", f"con casi todos los hechos ausentes => insuficiente ({ev5['case_fit_grade']})")

    print("\n— condición: documento ilegible => baja confianza —")
    ev6 = S.run_case_evaluation(COMPLETE + " signos territorio", "Marcas",
                                [case_file(COMPLETE), case_file("", status="failed", ftype="png", fid="img")], S.CORPUS, S.JUDGMENT_IDS)
    check(ev6["confidence_level"] == "baja" or ev6["case_fit_grade"] == "insuficiente", f"documento ilegible => confianza baja ({ev6['confidence_level']})")

    print("\n" + ("RESULTADO: TODO OK ✅" if not FAIL else f"RESULTADO: {len(FAIL)} FALLOS ❌"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
