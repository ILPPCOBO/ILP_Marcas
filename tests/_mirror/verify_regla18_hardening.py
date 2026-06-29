#!/usr/bin/env python3
"""
verify_regla18_hardening — Regresión de los huecos de Regla 18 hallados por la
auditoría adversarial (12 defectos confirmados). Bloquea que vuelvan a abrirse:

  [#1 BLOCKER] asunto_hint evadía asksForPrediction → ahora se inspecciona.
  [#2 HIGH]    PREDICTION_REQUEST no cubría conjugaciones (ganaremos/ganará/
               ganaría/gane/podrías ganar/perspectivas de éxito).
  [#3/#4 HIGH] has_scoreboard_forbidden no cubría pronóstico "blando"
               (buenas probabilidades de éxito, será ganado, es probable que gane,
               perspectivas de éxito, habría ganado, podría prosperar).

NO predice resultado (Regla 18). Espejo runnable: demo/serve_demo.py.
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


print("\n— #2: asks_for_prediction cubre conjugaciones de ganar/perder/vencer —")
SHOULD_DETECT = [
    "¿ganaremos el caso?",
    "¿ganará mi demanda?",
    "¿ganaría con estos hechos?",
    "¿ganarán con más pruebas?",
    "ganarás si presento esto",
    "¿gano el juicio con esto?",
    "¿podría ganar el pleito?",
    "¿podrías ganar tú?",
    "¿cuáles son mis perspectivas de éxito?",
    "¿qué probabilidad de éxito tengo?",
    "¿tengo posibilidades de ganar?",
    "¿me conviene demandar?",
    "voy a ganar este litigio",
]
for q in SHOULD_DETECT:
    check(S.asks_for_prediction(q), "detecta petición de pronóstico: «%s»" % q)

print("\n— no sobre-bloquea hechos/consultas legítimas (sin falsos positivos) —")
SHOULD_NOT = [
    "Mi marca MARCAS fue registrada en la OEPM el 1 de enero de 2020.",
    "El competidor usa un signo idéntico en la misma clase de productos.",
    "Existe una sentencia firme previa entre las mismas partes.",
    "¿Qué criterios del corpus aplican al riesgo de confusión entre marcas?",
    "La empresa ganadera registró el logo del toro.",
]
for q in SHOULD_NOT:
    check(not S.asks_for_prediction(q), "NO marca como pronóstico un hecho/consulta legítima: «%s»" % q[:55])

print("\n— #3/#4: has_scoreboard_forbidden veta pronóstico 'blando' en la salida —")
FORBIDDEN_OUT = [
    "Tienes buenas probabilidades de éxito.",
    "Hay posibilidad de éxito en tu demanda.",
    "Podrías ganar si presentas estas pruebas.",
    "Tu demanda será ganada por ti.",
    "Es probable que ganes el caso.",
    "Tus perspectivas de éxito son altas.",
    "Habrías ganado en otro contexto.",
    "Tu pretensión podría prosperar.",
    "Tienes el 80 por ciento de éxito.",
    "Tu caso sería decidido a su favor.",
]
for t in FORBIDDEN_OUT:
    check(S.has_scoreboard_forbidden(t), "veta texto de pronóstico: «%s»" % t)

print("\n— no veta explicaciones legítimas del propio evaluador —")
LEGIT_OUT = [
    "El hecho aportado coincide con una condición que el criterio del corpus considera relevante para el análisis (no implica un resultado).",
    "Es una cuestión que el corpus aprobado NO resuelve, lo que limita la alineación; no implica un resultado adverso.",
    "Esta calificación no predice el resultado de un procedimiento y no constituye asesoramiento jurídico.",
]
for t in LEGIT_OUT:
    check(not S.has_scoreboard_forbidden(t), "NO veta explicación legítima: «%s…»" % t[:45])

print("\n— verificación adversarial (Node): conjugaciones que faltaban —")
# Futuro 1ª persona (-é), condicional (-ía), deberían, ganador/vencedor: deben vetarse.
CONJ_FORBIDDEN = [
    "ganaré el caso", "tendré éxito", "seré favorable", "tendría éxito",
    "tendrías éxito", "serían ganadores", "obtendría una sentencia favorable",
    "la demanda prosperará", "venza el demandante", "gane el demandante",
    "deberían demandar de inmediato",
]
for t in CONJ_FORBIDDEN:
    check(S.has_scoreboard_forbidden(t), "veta conjugación de pronóstico: «%s»" % t)

# Y como petición de predicción (asunto_hint / consulta):
CONJ_PREDICT = ["van a prosperar", "ganaré", "dime si ganaré", "¿ganaría con esto?", "mis perspectivas de éxito"]
for t in CONJ_PREDICT:
    check(S.asks_for_prediction(t), "detecta predicción (conjugación): «%s»" % t)

print("\n— sin falsos positivos en los 14 criterios aprobados (Python) —")
fp = 0
for c in S.load_approved_criteria():
    blob = " ".join([c.get("criterion_text", "")] + c.get("conditions_for_application", []) +
                    c.get("does_not_answer", []) + c.get("limits", []))
    if S.has_forbidden_language(blob) or S.has_scoreboard_forbidden(blob):
        fp += 1
        print("  ✗ FALSO POSITIVO en", c.get("id"))
check(fp == 0, "0 falsos positivos en criterios aprobados")

print("\n— #1 BLOCKER: predicción colada en asunto_hint NO se evalúa —")
CORPUS = S.load_approved_criteria()
JIDS = S.load_judgment_ids()
desc_ok = ("Mi marca está registrada en la OEPM y el competidor usa un signo idéntico en la misma clase, "
           "con riesgo de confusión para el consumidor medio.")
ev = S.run_case_evaluation(desc_ok, "¿Voy a ganar el juicio?", [], CORPUS, JIDS, "es")
check(ev["decision"] == "cannot_evaluate_case",
      "asunto_hint='¿Voy a ganar el juicio?' => decision 'cannot_evaluate_case' (no evade)")
check(ev["case_fit_score"] is None and ev["case_fit_grade"] == "insuficiente",
      "asunto_hint con predicción => sin nota ni score")

# Variante de conjugación en asunto_hint.
ev2 = S.run_case_evaluation(desc_ok, "dime si ganaré", [], CORPUS, JIDS, "es")
check(ev2["decision"] == "cannot_evaluate_case", "asunto_hint='dime si ganaré' => 'cannot_evaluate_case'")

print()
if fails:
    print("RESULTADO: FALLOS (%d) ❌" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("RESULTADO: TODO OK ✅  (huecos de Regla 18 de la auditoría, cerrados y bloqueados)")
