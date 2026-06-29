#!/usr/bin/env python3
"""
verify_popup_score — control de Regla 18 sobre el POP-UP del score de alineación.

El pop-up aparece según el umbral (≥70 / <70). La auditoría adversarial avisó de
que su CONTENIDO no estaba bajo guardarraíl. Este espejo extrae los textos REALES
de frontend/scoreboard.js (función popupTextos) y verifica que:
  - NINGUNO dispara el guardarraíl léxico (hasForbiddenLanguage / scoreboard);
  - NINGUNO usa léxico de MÉRITO o de ACCIÓN procesal ("encaja", "seguimos",
    "gana", "litig", "demand", "buen caso", "deberías"…) — el pop-up no puede
    insinuar que un score alto = caso fuerte ni recomendar litigar (Regla 18, 10);
  - AMBOS umbrales remiten a CONSULTAR con un profesional (Reglas 11-12).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "demo"))
import serve_demo as S  # noqa: E402

fails = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        fails.append(msg)


src = open(os.path.join(ROOT, "frontend", "scoreboard.js"), encoding="utf-8").read()
# aislar la función popupTextos
m = re.search(r"function popupTextos\([^)]*\)\s*\{(.*?)\n  \}", src, re.S)
check(m is not None, "se encontró la función popupTextos en scoreboard.js")
body = m.group(1) if m else ""

# textos visibles: titulo / texto / aviso / boton (dentro de popupTextos)
literals = re.findall(r'(titulo|texto|aviso|boton):\s*"((?:[^"\\]|\\.)*)"', body)
# + el aviso vive en constantes AVISO_ES / AVISO_EN (referenciadas como aviso: AVISO_*)
avisos = re.findall(r'var\s+AVISO_(?:ES|EN)\s*=\s*"((?:[^"\\]|\\.)*)"', src)
textos = [v for _, v in literals] + avisos
check(len(textos) >= 6, "se extrajeron los textos del pop-up (%d encontrados)" % len(textos))

# léxico que NUNCA debe aparecer (mérito / pronóstico / acción procesal)
PROHIBIDO = ["encaj", "seguimos", "para seguir", "sigue adelante", "gana", "litig",
             "demand", "querell", "prosper", "éxito", "exito", "favorable",
             "buen caso", "caso fuerte", "deber", "probabilidad"]

print("\n— ningún texto del pop-up dispara el guardarraíl léxico (Regla 18) —")
for t in textos:
    bad = S.has_forbidden_language(t) or S.has_scoreboard_forbidden(t)
    check(not bad, "limpio: «%s…»" % t[:46])

print("\n— ningún texto insinúa mérito ni recomienda acción procesal —")
for t in textos:
    hits = [w for w in PROHIBIDO if w in t.lower()]
    check(not hits, ("sin léxico de mérito/acción" if not hits else "contiene %s" % hits) + ": «%s…»" % t[:40])

print("\n— ambos umbrales remiten a un PROFESIONAL / contacto (Reglas 11-12) —")
joined = " ".join(textos).lower()
check("profesional" in joined or "ilp abogados" in joined, "se menciona ayuda profesional / ILP Abogados")
# debe haber dos ramas (alto/bajo): al menos dos 'texto' distintos
cuerpos = [v for k, v in literals if k == "texto"]
check(len(set(cuerpos)) >= 2, "hay dos mensajes según el umbral (alto/bajo)")
# el aviso de no-pronóstico está presente
check(any("no es un pronóstico" in t or "not the merits or outcome" in t.lower() for t in textos),
      "incluye el aviso de que NO es pronóstico ni recomendación")

print()
if fails:
    print("RESULTADO: FALLOS (%d) ❌" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("RESULTADO: TODO OK ✅  (pop-up del score sin mérito ni recomendación; remite a profesional — Reglas 11-12, 18)")
