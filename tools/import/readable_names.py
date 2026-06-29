#!/usr/bin/env python3
"""Reescribe los source_reference de los criterios a nombres LEGIBLES de resolución
(expande abreviaturas) y actualiza los títulos de las sentencias. Determinista, fiel
(misma resolución, nombre más claro)."""
import json, re, glob, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def readable(sr):
    sr = sr.strip()
    # separar cola de fecha: "... , <fecha>"
    head, _, tail = sr.partition(",")
    head = head.strip(); fecha = tail.strip()
    tipo = ""
    # STJUE / TJUE
    m = re.match(r"^STJUE\s+(.*)$", head)
    if m:
        name = "Sentencia del Tribunal de Justicia de la UE, asunto " + m.group(1).strip()
        return name + (f", de {fecha}" if fecha else "")
    # SJM nº N Ciudad  (Juzgado de lo Mercantil) — el nº de sentencia suele ir en la cola
    m = re.match(r"^SJM\s*n[ºo°]?\s*(\d+)\s+(.+)$", head)
    if m:
        base = f"Juzgado de lo Mercantil nº {m.group(1)} de {m.group(2).strip()}"
        return base + (f", {fecha}" if fecha else "")
    # S/A  TS|AP Ciudad|TSJ Ciudad  num/año (Sala/Sección)
    m = re.match(r"^([SA])\s+(.*)$", head)
    if not m:
        return sr  # formato desconocido → se deja igual
    tipo = "Sentencia" if m.group(1) == "S" else "Auto"
    rest = m.group(2).strip()
    org = None
    mm = re.match(r"^TS\s*(.*)$", rest)
    if mm:
        org = "del Tribunal Supremo"; rest2 = mm.group(1).strip()
    else:
        mm = re.match(r"^AP\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+(?:\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚñáéíóú]+)?)\s*(.*)$", rest)
        if mm:
            org = f"de la Audiencia Provincial de {mm.group(1).strip()}"; rest2 = mm.group(2).strip()
        else:
            mm = re.match(r"^TSJ\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+)\s*(.*)$", rest)
            if mm:
                org = f"del Tribunal Superior de Justicia de {mm.group(1).strip()}"; rest2 = mm.group(2).strip()
    if org is None:
        return sr
    # rest2 = "330/2017 (Sala de lo Civil)" → núm + (sala)
    num = rest2.strip()
    name = f"{tipo} {org}"
    if num:
        name += f", nº {num}" if re.match(r"^\d", num) else f" {num}"
    if fecha:
        name += f", de {fecha}"
    return name


crits = []
for f in sorted(glob.glob(f"{ROOT}/data/approved_criteria/*.json")):
    if "schema" in f or "README" in f: continue
    d = json.load(open(f)); items = d.get("criteria", d)
    if isinstance(items, dict): items = [items]
    for c in items:
        crits.append((f, c))

# muestra primero
print("=== MUESTRA de la transformación ===")
seen = set()
for f, c in crits:
    sr = c.get("source_reference", "")
    if sr in seen: continue
    seen.add(sr)
    r = readable(sr)
    if len(seen) <= 12:
        print(f"  ANTES : {sr[:62]}")
        print(f"  AHORA : {r[:75]}\n")
