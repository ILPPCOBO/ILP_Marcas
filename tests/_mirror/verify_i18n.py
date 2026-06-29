#!/usr/bin/env python3
"""
verify_i18n — Presentación EN (traducción) + nombres de resolución LEGIBLES.

Comprueba, contra el motor servido (demo/serve_demo.py):
  (A) Traducción ES→EN por glosario CERRADO (Reglas 2/3, sin LLM, sin red):
      - cada TEMA del léxico tiene etiqueta inglesa conocida;
      - cada PREGUNTA de aclaración alcanzable tiene traducción inglesa;
      - una consulta en inglés que repregunta devuelve las preguntas EN (no ES);
      - las opciones guiadas se presentan en EN, pero la frase 'adds' (que alimenta
        el clasificador español) SIEMPRE permanece en español.
  (B) Nombres de resolución legibles (Regla 9, fieles):
      - las citas no muestran el slug interno (jdg-…) cuando hay nombre de resolución;
      - cada fuente servida lleva un nombre 'resolution' legible y trazable.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "demo")))
import serve_demo as S  # noqa: E402

fails = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        fails.append(msg)


C = S.load_approved_criteria()
J = S.load_judgment_ids()


print("\n— (A) cada tema del léxico tiene etiqueta inglesa conocida —")
lex_topics = set()
for a in S.LEXICON["areas"]:
    for t in a["topics"]:
        lex_topics.add(t["name"])
sin_en = [t for t in sorted(lex_topics) if not S.topic_label(t, "en")["known"]]
check(len(sin_en) == 0, "los %d temas del léxico tienen EN (sin EN: %s)" % (len(lex_topics), sin_en or "ninguno"))


print("\n— (A) cada pregunta de aclaración alcanzable tiene traducción EN —")
reach = set()
for c in S.CHECKLISTS["checklists"]:
    for f in c["essential_facts"]:
        reach.add(f["question"])
for v in S.CHECKLISTS.get("area_fallback", {}).values():
    reach.add(v["question"])
reach.add(S.AMBIGUITY_QUESTION)
reach.add("¿Podría concretar el tema de su consulta?")
sin_tr = [q for q in reach if S.tr_question(q, "en") == q]
check(len(sin_tr) == 0, "las %d preguntas alcanzables tienen EN (sin EN: %d)" % (len(reach), len(sin_tr)))
for q in sin_tr[:5]:
    print("      falta:", q)


print("\n— (A) consulta EN que repregunta → preguntas en inglés (no español) —")
r = S.run_query("likelihood of confusion between two similar trademarks", "en", C, J)
check(r["answer"]["decision"] == "clarify", "consulta EN ambigua → clarify")
bullets = [ln.strip()[1:].strip() for ln in r["answer"]["answer_text"].split("\n") if ln.strip().startswith("•")]
en_values = set(S.CHECKLIST_EN.values())
check(bool(bullets) and all(b in en_values for b in bullets),
      "todas las preguntas mostradas están en inglés (del mapa cerrado)")
# ninguna debe ser una pregunta ESPAÑOLA del checklist
es_questions = set(S.CHECKLIST_EN.keys())
check(not any(b in es_questions for b in bullets), "ninguna pregunta quedó en español en modo EN")


print("\n— (A) opciones guiadas EN: pregunta+labels en inglés; 'adds' en español —")
n = S.normalize_query("likelihood of confusion between two trademarks", "en")
sc = S.classify_scope(n["spanish"])
co = S.build_clarify_options(sc, S.normalize("likelihood of confusion between two trademarks"), "en")
check(bool(co) and co[0]["question"] not in (None, ""), "hay pregunta de opciones en EN")
# las labels EN deben coincidir con label_en del clarify_options.json
key = f"{S.scope_area_to_legal_area(sc['area'])}|{S.to_corpus_topic_key(sc['topic'])}"
cfg = S.CLARIFY_OPTIONS.get(key)
if cfg:
    en_labels = {o.get("label_en") for o in cfg["options"]}
    shown = {o["label"] for o in co[0]["options"]}
    check(shown.issubset(en_labels), "las labels mostradas son las inglesas del corpus")
    # 'adds' sigue en español (igual que en la entrada del corpus)
    adds_es = {o["adds"] for o in cfg["options"]}
    adds_shown = {o["adds"] for o in co[0]["options"]}
    check(adds_shown.issubset(adds_es), "la frase 'adds' permanece en español (alimenta el clasificador)")
else:
    check(False, "no se halló config de opciones para el tema (clave %s)" % key)


print("\n— (B) nombres de resolución legibles, sin slug interno, trazables —")
# convergencia 1-clic para forzar una respuesta con criterios reales
base = "mi marca y la mala fe en el registro"
sc_b = S.classify_scope(S.normalize_query(base, "es")["spanish"])
co_b = S.build_clarify_options(sc_b, S.normalize(base), "es")
adds = co_b[0]["options"][0]["adds"]
ans = S.run_query(base + "\n" + adds, "es", C, J)
check(ans["answer"]["decision"] == "answer" and bool(ans["answer"]["sources_used"]),
      "consulta converge a 'answer' con fuentes")
srcs = ans["answer"]["sources_used"]
check(all(s.get("resolution") for s in srcs), "cada fuente lleva nombre 'resolution' legible")
# el texto NO debe mostrar el slug crudo jdg-real-…
check("jdg-real-" not in ans["answer"]["answer_text"], "el texto no muestra el slug interno jdg-real-…")
# el judgment_id (trazabilidad máquina, Regla 9) sigue presente en sources_used
check(all(s.get("judgment_id") for s in srcs), "se conserva judgment_id en sources_used (trazabilidad)")
# legibilidad: las citas expanden siglas (al menos una empieza por 'Sentencia '/'Auto ')
res0 = srcs[0]["resolution"]
check(res0.startswith(("Sentencia ", "Auto ")), "la cita expande la sigla del tipo de resolución (%s…)" % res0[:24])


print("\n— (B) cita FIEL para un pinpoint sobre ECLI (cosa juzgada) —")
cj = next((c for c in C if c.get("topic") == "cosa_juzgada"), None)
if cj:
    cit = S.readable_citation(cj)
    check("ECLI:ES:" in cit and cj["source_reference"] in cit,
          "la cita decodifica el ECLI y conserva el pinpoint (%s…)" % cit[:48])
else:
    check(True, "(sin criterios de cosa juzgada en el corpus — omitido)")


print()
if fails:
    print("RESULTADO: FALLOS (%d) ❌" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("RESULTADO: TODO OK ✅  (traducción EN por glosario cerrado + nombres de resolución legibles y fieles)")
