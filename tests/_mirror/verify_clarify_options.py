#!/usr/bin/env python3
"""
verify_clarify_options — Aclaración GUIADA (multiple choice). Comprueba que:
  - un tema conocido devuelve sus opciones (escenarios fieles de los criterios);
  - una consulta ambigua devuelve desambiguación por materia, ORDENADA por relevancia;
  - las opciones no contienen lenguaje de pronóstico (Regla 18);
  - cada opción lleva label + adds.
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


def opts_for(q):
    n = S.normalize_query(q, "es")
    sc = S.classify_scope(n["spanish"])
    return sc, S.build_clarify_options(sc, S.normalize(q))


print("\n— tema CONOCIDO con checklist → opciones del tema (escenarios fieles) —")
sc, co = opts_for("mi marca y la mala fe en el registro")
check(sc["topic"] == "mala fe", "consulta de mala fe se clasifica en 'mala fe'")
check(bool(co) and len(co[0]["options"]) >= 2, "devuelve >=2 opciones para el tema conocido")
check(all(o.get("label") and o.get("adds") for o in co[0]["options"]), "cada opción tiene label + adds")

print("\n— consulta AMBIGUA → desambiguación por materia, ordenada por relevancia —")
sc2, co2 = opts_for("autoría de software de un empleado")
labels = [o["label"] for o in co2[0]["options"]] if co2 else []
check(bool(co2) and len(labels) >= 2, "ofrece materias para desambiguar")
check(labels[:1] == ["Software"], "la materia más relevante ('Software') aparece primera (orden por relevancia)")

print("\n— Regla 18: ninguna opción contiene lenguaje de pronóstico —")
fp = 0
for k, cfg in S.CLARIFY_OPTIONS.items():
    blob = cfg.get("question", "") + " " + " ".join(o["label"] + " " + o["adds"] for o in cfg.get("options", []))
    if S.has_forbidden_language(blob) or S.has_scoreboard_forbidden(blob):
        fp += 1
        print("    ✗ pronóstico en", k)
check(fp == 0, "0 opciones con lenguaje de pronóstico en los %d temas" % len(S.CLARIFY_OPTIONS))

print("\n— CONVERGENCIA en 1 clic: elegir un escenario → answer (no repregunta) —")
C = S.load_approved_criteria()
J = S.load_judgment_ids()


def run(q):
    return S.run_query(q, "es", C, J)


# tema con checklist detallada (mala fe): bare → clarify; elegir opción → answer
base_q = "mi marca y la mala fe en el registro"
sc_b, co_b = opts_for(base_q)
r1 = run(base_q)
check(r1["answer"]["decision"] == "clarify", "consulta base de mala fe → clarify (ofrece opciones)")
opt = co_b[0]["options"][0]
r2 = run(base_q + "\n" + opt["adds"])
check(r2["answer"]["decision"] == "answer" and bool(r2["answer"]["criteria_used"]),
      "elegir un escenario de mala fe → answer con criterios (converge en 1 clic)")

# desambiguación: ambiguo → elegir materia 'Software' → answer
amb = "autoría de software de un empleado"
sc_a, co_a = opts_for(amb)
sw = next((o for o in co_a[0]["options"] if o["label"] == "Software"), co_a[0]["options"][0])
r3 = run(amb + "\n" + sw["adds"])
check(r3["answer"]["decision"] == "answer" and r3["scope"]["topic"] == "software",
      "elegir 'Software' en la desambiguación → answer del tema software (1 clic)")

# seguridad: el atajo NO debe debilitar el deny-by-default
r4 = run("¿qué impuestos paga mi marca?")
check(r4["answer"]["decision"] == "out_of_scope",
      "consulta fiscal sigue FUERA DE ALCANCE (el atajo no la convierte en respuesta)")
# una consulta fuera de alcance que casualmente incluyera un escenario tampoco responde
r5 = run("Tengo un problema penal de estafa con mi marca")
check(r5["answer"]["decision"] != "answer", "consulta penal mixta nunca responde el fondo (deny-by-default)")


print("\n— cobertura: todos los temas con criterios tienen config de opciones —")
twc = S._topics_with_criteria()
faltan = [f"{a}|{t}" for a, ts in twc.items() for t in ts if f"{a}|{t}" not in S.CLARIFY_OPTIONS]
check(len(faltan) == 0, "todo tema con criterios tiene opciones (faltan: %s)" % (faltan or "ninguno"))

print()
if fails:
    print("RESULTADO: FALLOS (%d) ❌" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("RESULTADO: TODO OK ✅  (aclaración guiada con opciones, fiel a los criterios)")
