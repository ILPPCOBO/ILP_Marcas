#!/usr/bin/env python3
"""
Espejo de verificación del SCOREBOARD ("Score de alineación con criterios del
corpus"). Reutiliza serve_demo.py y comprueba las reglas 1-7 del spec, en
particular que NUNCA hay lenguaje de pronóstico/probabilidad (Reglas 7-8 + 18).
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


def case_file(text, status=None, ftype="txt", sid="sess-1", fid="upl-1"):
    ex = S.extract_text(ftype, fid + (".txt" if ftype == "txt" else ".png"), text=text if ftype == "txt" else None, base64=None if ftype == "txt" else "AAAA")
    return {"id": fid, "original_filename": fid + "." + ftype, "file_type": ftype, "upload_type": "case_material",
            "uploaded_at": "2026-06-13T00:00:00Z", "uploaded_by": None, "session_id": sid,
            "extraction_status": status or ex["status"], "extracted_text": ex["text"], "summary": "",
            "detected_entities": [], "detected_legal_topics": [], "warnings": ex["warnings"],
            "source_locations": ex["source_locations"], "created_at": "2026-06-13T00:00:00Z",
            "updated_at": "2026-06-13T00:00:00Z"}


COMPLETE = ("Mi marca está registrada en España, vendo productos de cosmética; un competidor usa un "
            "logo muy parecido y ambas operamos en el mercado español.")


def all_text(sb):
    parts = []
    for f in sb["favorable_factors"] + sb["unfavorable_factors"]:
        parts.append(f["factor"])
    for f in sb["uncertain_factors"]:
        parts += [f["factor"], f["why_it_matters"], f["what_is_missing"]]
    parts += sb["limits"] + [sb["disclaimer"], sb["reason"] or ""]
    return " ".join(parts)


def main():
    print("— Caso completo (marca + criterios aprobados) —")
    sb = S.run_scoreboard("riesgo de confusión con mi marca", [case_file(COMPLETE)], S.CORPUS, S.JUDGMENT_IDS)
    check(sb["computable"] and isinstance(sb["case_fit_score"], int), "score calculado (alineación), número 0-100")
    check(sb["score_label"] in ("bajo", "medio", "alto"), f"label de alineación: {sb['score_label']} (score {sb['case_fit_score']})")
    # (5) cada factor favorable/desfavorable tiene criterio + fuente
    favs = sb["favorable_factors"] + sb["unfavorable_factors"]
    check(len(favs) > 0 and all(f["criterion_id"] and f["source_reference"] and f["judgment_id"] for f in favs),
          "cada factor favorable/desfavorable conecta criterio + fuente (Regla 13)")
    # (3) criterios usados vienen del corpus aprobado, no del material del usuario
    approved_ids = {c["id"] for c in S.CORPUS}
    check(len(sb["criteria_used"]) > 0 and all(cu["criterion_id"] in approved_ids for cu in sb["criteria_used"]),
          "criteria_used proceden del corpus aprobado (material del usuario NO es fuente jurídica)")
    check(len(sb["evidence_used"]) > 0, "evidence_used muestra los documentos del usuario usados (Regla 11)")
    check(len(sb["limits"]) > 0 and any("no predice" in l.lower() for l in sb["limits"]), "incluye límites (no predice resultado)")

    # (4) NUNCA lenguaje de pronóstico/probabilidad en TODA la salida
    print("\n— Regla 7-8/18: sin probabilidad de ganar/éxito —")
    check(not S.has_scoreboard_forbidden(all_text(sb)), "ningún texto del scoreboard contiene pronóstico/probabilidad")
    for bad in ["Tienes 80% de éxito.", "Probabilidad de ganar alta.", "Vas a perder.", "Debe usted demandar.",
                "La demanda tendrá éxito.", "Le será favorable la sentencia.", "La sentencia le será de su favor.",
                "Le conviene demandar cuanto antes.", "Vale la pena demandar.", "Está obligado demandar.",
                "Lograrás la victoria.", "Conseguirás éxito.", "Su victoria está asegurada.",
                "Las perspectivas son favorables.", "Tiene un 80 por ciento de éxito."]:
        check(S.has_scoreboard_forbidden(bad), f"el guardarraíl veta «{bad}»")

    print("\n— Sin falsos positivos sobre los criterios APROBADOS (denylist ampliada) —")
    fp = [c["id"] for c in S.CORPUS if S.has_scoreboard_forbidden(
        " ".join([c["criterion_text"]] + c["conditions_for_application"] + c["does_not_answer"] + c["limits"]))]
    check(not fp, f"la denylist ampliada NO marca ningún criterio aprobado legítimo (falsos positivos: {fp})")

    # (1) sin criterios aprobados (tema sin corpus) => no score
    print("\n— Regla 1: sin criterios aprobados, no hay score —")
    sb2 = S.run_scoreboard("Quiero anular la patente registrada por falta de novedad", [case_file("patente registrada, falta de novedad, divulgación previa")], S.CORPUS, S.JUDGMENT_IDS)
    check(not sb2["computable"] and sb2["case_fit_score"] is None, "tema sin criterios aprobados => no se calcula score")

    # fuera de alcance => no score
    sb3 = S.run_scoreboard("Tengo un problema penal de estafa", [case_file("estafa penal")], S.CORPUS, S.JUDGMENT_IDS)
    check(not sb3["computable"], "fuera de alcance => no se calcula score")

    # (2) criterios pending_review nunca se usan (corpus solo con un pending)
    print("\n— Regla 2: criterios pending nunca se usan —")
    pend = [c for c in S._load_collection(S.DATA / "processed_criteria", "criteria")]
    only_pending = [c for c in pend if c.get("area") == "marcas"][:1] or pend[:1]
    sb4 = S.run_scoreboard("riesgo de confusión con mi marca", [case_file(COMPLETE)], only_pending, S.JUDGMENT_IDS)
    check(not sb4["computable"], "con solo criterios pending => no se calcula score (no servible)")

    # (6) faltan datos esenciales => insuficiente
    print("\n— Regla 6: faltan hechos esenciales => insuficiente —")
    sb5 = S.run_scoreboard("mi marca", [case_file("Tengo una marca.")], S.CORPUS, S.JUDGMENT_IDS)
    check(sb5["score_label"] == "insuficiente" or not sb5["computable"],
          f"con casi todos los hechos ausentes => insuficiente (label={sb5['score_label']})")

    # (7) evidencia ilegible => baja confianza
    print("\n— Regla 7: evidencia débil/ilegible => baja confianza —")
    sb6 = S.run_scoreboard("riesgo de confusión con mi marca registrada cosmética competidor mercado español signos",
                           [case_file(COMPLETE), case_file("", status="failed", ftype="png", fid="upl-img")],
                           S.CORPUS, S.JUDGMENT_IDS)
    check(sb6["confidence_level"] == "bajo", f"un documento ilegible baja la confianza (={sb6['confidence_level']})")

    print("\n" + ("RESULTADO: TODO OK ✅" if not FAIL else f"RESULTADO: {len(FAIL)} FALLOS ❌"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
