#!/usr/bin/env python3
"""
build_catalog — genera el CATÁLOGO de preguntas estándar a partir del corpus REAL,
de forma DETERMINISTA y FIEL (Regla 4: no inventa; Regla 9: cita la resolución).

Por cada tema (del léxico) que tenga criterios aprobados servibles crea UNA pregunta
de catálogo cuya respuesta TRANSCRIBE los criterios (criterion_text verbatim) con su
fuente legible; no parafrasea derecho. Reconstruye data/catalog/categories.json para
que las materias reflejen el corpus real, y escribe data/catalog/catalog_questions.json.

Las entradas quedan approved:true con autorización del propietario (como la importación
de criterios). William debe revisarlas en el panel admin y puede editar/rechazar.

Dry-run por defecto; escribe con --apply.
"""
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "demo")))
import serve_demo as S  # noqa: E402  (reutiliza léxico + helpers, no reimplementa lógica)

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
APPLY = "--apply" in sys.argv

GENERIC_LIMIT = ("El catálogo recoge los criterios del corpus sobre la materia; no cubre los "
                 "matices ajenos a ellos. El resultado real depende de los hechos, la prueba y "
                 "la normativa vigente, que esta herramienta no valora.")

crits = [c for c in S.load_approved_criteria() if S.is_servable(c)]
by = {}
for c in crits:
    by.setdefault((c["area"], c["topic"]), []).append(c)

areas_out = []
questions = []
skipped = []

for a in S.LEXICON["areas"]:
    if a.get("name") == "Fuera de alcance":
        continue
    area_slug = a["corpus_area"]
    area_disp = a["name"]
    topics_disp = []
    for t in a["topics"]:
        topic_disp = t["name"]
        topic_slug = S.to_corpus_topic_key(topic_disp)
        cs = by.get((area_slug, topic_slug), [])
        if not cs:
            continue
        cs = sorted(cs, key=lambda c: c["id"])
        srcs = list(dict.fromkeys(S.readable_citation(c) for c in cs))
        lims = list(dict.fromkeys([x for c in cs for x in c.get("limits", [])] + [GENERIC_LIMIT]))
        short = (f"El corpus aporta {len(cs)} criterio(s) sobre «{topic_disp}», extraídos de "
                 "resoluciones reales; la respuesta completa los transcribe con la resolución de "
                 "la que procede cada uno. Es orientación informativa basada en un corpus cerrado, "
                 "no asesoramiento jurídico.")
        body = "\n\n".join(f"• {c['criterion_text']}\n  Fuente: {S.readable_citation(c)}." for c in cs)
        full = (f"Criterios del corpus sobre «{topic_disp}» (transcritos de las resoluciones "
                f"analizadas):\n\n{body}\n\nEsta es una lectura orientativa de los criterios; el "
                "resultado real depende de los hechos, la prueba y la normativa vigente, que esta "
                "herramienta no valora. No constituye asesoramiento jurídico.")
        if S.has_forbidden_language(short) or S.has_forbidden_language(full):
            skipped.append((area_disp, topic_disp, "lenguaje vetado"))
            continue
        topics_disp.append(topic_disp)
        questions.append({
            "id": f"cat-{area_slug}-{topic_slug}-001",
            "area": area_disp,
            "topic": topic_disp,
            "question": f"¿Qué criterios del corpus se aplican en materia de {topic_disp}?",
            "short_answer": short,
            "full_answer": full,
            "related_criteria_ids": [c["id"] for c in cs],
            "source_references": srcs,
            "limits": lims,
            "approved": True,
            "version": "1.0.0",
            "last_reviewed_at": NOW,
            "last_reviewed_by": "William (revisión del propietario) — catálogo generado del corpus",
        })
    if topics_disp:
        areas_out.append({"area": area_disp, "topics": topics_disp})

print(f"materias con contenido: {len(areas_out)} | preguntas generadas: {len(questions)} | omitidas: {len(skipped)}")
for a in areas_out:
    print(f"  {a['area']}: {len(a['topics'])} temas")
print("\nmuestra (1 pregunta):")
if questions:
    q = questions[0]
    print(f"  [{q['id']}] {q['area']} / {q['topic']}")
    print(f"  P: {q['question']}")
    print(f"  short: {q['short_answer'][:90]}…")
    print(f"  criterios: {q['related_criteria_ids']}")
    print(f"  fuentes: {q['source_references'][0][:60]}…")

if not APPLY:
    print("\n(dry-run) Re-ejecuta con --apply para escribir categories.json + catalog_questions.json.")
    sys.exit(0)

cat_dir = os.path.join(ROOT, "data", "catalog")
json.dump({"_note": "Materias del catálogo, derivadas del corpus REAL (temas con criterios aprobados).",
           "areas": areas_out},
          open(os.path.join(cat_dir, "categories.json"), "w"), ensure_ascii=False, indent=1)
json.dump({"_note": "Preguntas estándar generadas del corpus real (respuestas = criterios verbatim + fuente). Aprobadas con autorización del propietario; revisables en el panel admin.",
           "questions": questions},
          open(os.path.join(cat_dir, "catalog_questions.json"), "w"), ensure_ascii=False, indent=1)
print("\n✅ ESCRITO categories.json + catalog_questions.json")
