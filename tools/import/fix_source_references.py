#!/usr/bin/env python3
"""
fix_source_references — saneo ÚNICO y FIEL de los source_reference / títulos
malformados por el bug de `res_name` (etiqueta "Fecha:" pegada al número →
fecha duplicada). Reproduce EXACTAMENTE lo que el importador ya corregido
(import_cuadros.py) produciría, sin tocar criterion_text, área/tema, ni la
aprobación. Idempotente. Dry-run por defecto; escribe con --apply.

Fidelidad (Regla 4/9): solo se ELIMINA el artefacto del import (la etiqueta
"Fecha:" pegada y la fecha repetida); no se añade ni se reinterpreta nada. Un
auto-chequeo verifica que el órgano, el número de resolución, el año y la fecha
se conservan idénticos antes/después.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CRIT = os.path.join(ROOT, "data", "approved_criteria", "real_marcas.json")
JUDG = os.path.join(ROOT, "data", "source_judgments", "real_marcas_judgments.json")
APPLY = "--apply" in sys.argv


def clean_rname(text):
    # idéntico al res_name CORREGIDO del importador
    return re.split(r"Fecha:|Auto/Sentencia:|Materia:|\n", text or "")[0].strip()


def dedupe_segments(s):
    parts = [p.strip() for p in (s or "").split(",") if p.strip() != ""]
    out = []
    for p in parts:
        if out and out[-1].lower() == p.lower():
            continue
        out.append(p)
    return ", ".join(out)


def fixed_sr(sr):
    """Lo que el importador corregido produciría para este source_reference."""
    sr = (sr or "").strip()
    if "Fecha:" in sr:
        rname = clean_rname(sr)
        m = re.search(r"Fecha:\s*([^\n,]+)", sr)
        fecha = m.group(1).strip() if m else ""
        sr = (rname + (f", {fecha}" if fecha else "")).strip()
    return dedupe_segments(sr)


# --- firma de fidelidad: lo que NUNCA debe cambiar (órgano/número/año/fecha) ---
def signature(s):
    # Rompe el pegado del artefacto ("…2023Fecha:…") para que el número/año del
    # 'antes' sea visible (si no, la propia firma sufriría el mismo bug de frontera).
    s = (s or "").replace("Fecha:", " Fecha ")
    return {
        "num": sorted(set(re.findall(r"\d+/\d+", s))),           # nº de resolución
        "years": sorted(set(re.findall(r"(?:19|20)\d{2}", s))),
        "date": sorted(set(re.findall(
            r"\d{1,2} de [a-záéíóú]+ de \d{4}", s.lower()))),
        # token de órgano (TS / AP / JM / TSJ / STJUE / AN)
        "org": sorted(set(re.findall(r"\b(?:TS|AP|JM|TSJ|STJUE|AN)\b", s))),
    }


def faithful(before, after):
    """after no pierde ni inventa nº/año/fecha/órgano (comparación por conjunto;
    el 'after' lleva la fecha UNA sola vez en vez de duplicada)."""
    b, a = signature(before), signature(after)
    return (set(b["num"]) == set(a["num"]) and set(b["years"]) == set(a["years"])
            and set(b["date"]) == set(a["date"]) and set(b["org"]) == set(a["org"]))


def malformed(s):
    return ("Fecha:" in (s or "")) or ("  " in (s or "")) or bool(
        re.search(r",\s*([^,]+),\s*\1(?:,|$)", s or ""))


# ---------------------------------------------------------------------------
crit = json.load(open(CRIT, encoding="utf-8"))
judg = json.load(open(JUDG, encoding="utf-8"))

changes_sr, changes_jt, problems = [], [], []

for c in crit["criteria"]:
    old = c.get("source_reference", "")
    new = fixed_sr(old)
    if new != old:
        if not faithful(old, new):
            problems.append(("CRIT-INFIEL", c["id"], old, new))
        if malformed(new):
            problems.append(("CRIT-AÚN-MALFORMADO", c["id"], old, new))
        # idempotencia
        if fixed_sr(new) != new:
            problems.append(("CRIT-NO-IDEMPOTENTE", c["id"], new, fixed_sr(new)))
        changes_sr.append((c["id"], old, new))
        c["source_reference"] = new

for j in judg["judgments"]:
    old_t = j.get("title", "")
    new_t = clean_rname(old_t)
    if new_t != old_t:
        # el título es el NOMBRE de la resolución (órgano + nº); la fecha vive en el
        # source_reference, así que el título legítimamente deja de incluirla → solo
        # exigimos conservar nº de resolución y órgano.
        bs, as_ = signature(old_t), signature(new_t)
        if not (set(bs["num"]) == set(as_["num"]) and set(bs["org"]) == set(as_["org"])):
            problems.append(("JUDG-INFIEL", j["id"], old_t, new_t))
        if "Fecha:" in new_t:
            problems.append(("JUDG-AÚN-MALFORMADO", j["id"], old_t, new_t))
        changes_jt.append((j["id"], old_t, new_t))
        j["title"] = new_t[:200]
        j["court"] = (new_t.split(",")[0].split("(")[0].strip()[:120]) or new_t[:120]
        j["resolution_number"] = new_t[:120]
    # summary_internal: limpiar si arrastró la etiqueta
    s = j.get("summary_internal", "")
    if "Fecha:" in s:
        j["summary_internal"] = re.sub(r"\s*Fecha:\s*", " ", s).strip()


print(f"criterios con source_reference saneado : {len(changes_sr)}")
print(f"resoluciones con título saneado        : {len(changes_jt)}")
print(f"problemas de fidelidad/idempotencia    : {len(problems)}")
for p in problems[:20]:
    print("   ✗", p[0], p[1], "|", p[2][:50], "→", p[3][:50])

print("\n— muestra de cambios (source_reference) —")
for cid, old, new in changes_sr[:6]:
    print(f"  [{cid}]")
    print(f"    ANTES: {old}")
    print(f"    AHORA: {new}")

if problems:
    print("\n❌ HAY PROBLEMAS — no se escribe nada.")
    sys.exit(1)

if not APPLY:
    print("\n(dry-run) Todo fiel e idempotente. Re-ejecuta con --apply para escribir.")
    sys.exit(0)

json.dump(crit, open(CRIT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(judg, open(JUDG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n✅ ESCRITO. real_marcas.json + real_marcas_judgments.json saneados.")
