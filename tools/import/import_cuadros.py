#!/usr/bin/env python3
"""
import_cuadros — Importador DETERMINISTA y FIEL de los cuadros marcarios del
propietario (Base de Conocimiento + MARCAS_STCS) al corpus.

- criterion_text se copia VERBATIM del cuadro (Regla 4: no se inventa ni reescribe).
- La clasificación área/tema/subtema/keywords viene de /tmp/clasif.json (workflow + revisión).
- Cada resolución del cuadro se registra como Judgment; cada criterio se aprueba con
  la autorización explícita del propietario (approved_by registrado).

Genera:
  data/approved_criteria/real_marcas.json
  data/source_judgments/real_marcas_judgments.json
  /tmp/lexicon_topics.json  (temas+keywords por área, para fundir en el léxico)
"""
import json, re, unicodedata, datetime, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
AREA_KEY = {"Marcas": "marcas", "Propiedad intelectual": "propiedad_intelectual",
            "Patentes": "patentes", "Procesal": "procesal"}

cuadros = json.load(open("/tmp/cuadros.json"))
clasif = {c["index"]: c for c in json.load(open("/tmp/clasif.json"))}


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))


def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", deaccent(s).lower())).strip("-")


def res_name(resol):
    # Sin \b: en los cuadros "Fecha:" a veces viene PEGADO al número ("16/2021Fecha:")
    # y un \b (frontera de palabra entre dígito y letra no existe) dejaba la etiqueta
    # dentro del nombre → fecha duplicada en source_reference. Cortar por subcadena.
    return re.split(r"Fecha:|Auto/Sentencia:|Materia:|\n", resol)[0].strip()


judgments = {}
criteria = []
topics_by_area = {}  # area_key -> { topic_slug: set(keywords) }

for i in range(90):
    cu = cuadros[i]
    cl = clasif[i]
    crit_text = cu["criterio"].strip()
    rname = res_name(cu["resolucion"])
    fecha_m = re.search(r"Fecha:\s*([^\n]+)", cu["resolucion"])
    fecha = fecha_m.group(1).strip() if fecha_m else ""
    area = AREA_KEY[cl["area"]]
    topic = cl["topic_slug"]
    jid = "jdg-real-" + (slug(rname)[:48] or f"res-{i}")
    if jid in judgments and judgments[jid]["_rname"] != rname:
        jid = f"{jid}-{i}"
    if jid not in judgments:
        judgments[jid] = {
            "id": jid,
            "title": rname[:200],
            "court": rname.split(",")[0].split("(")[0].strip()[:120] or rname[:120],
            "date": "",  # fecha en texto libre; no siempre ISO → se deja vacío (válido)
            "resolution_number": rname[:120],
            "jurisdiction": "ES",
            "legal_area": area,
            "topics": [topic],
            "original_language": "es",
            "file_path": "data/source_judgments/(original en la carpeta del propietario)",
            "summary_internal": f"Resolución del cuadro Base de Conocimiento Marcario. {fecha}. {cl.get('topic_label','')}.".strip(),
            "created_at": NOW, "updated_at": NOW, "_rname": rname,
        }
    elif topic not in judgments[jid]["topics"]:
        judgments[jid]["topics"].append(topic)

    sub = slug(cl.get("subtopic", "") or "")[:90] or None
    criteria.append({
        "id": f"crit-real-{i + 1:03d}",
        "judgment_id": jid,
        "area": area,
        "topic": topic,
        "subtopic": sub,
        "criterion_text": crit_text,
        "conditions_for_application": [],
        "does_not_answer": [],
        "limits": [
            "Criterio hermenéutico extraído por el propietario de la resolución citada; es orientación "
            "informativa y no anticipa el resultado de ningún procedimiento.",
            "El resultado real depende de los hechos, la prueba y la normativa vigente, que esta herramienta no valora.",
        ],
        "source_excerpt": crit_text,
        "source_reference": (rname + (f", {fecha}" if fecha else "")).strip(),
        "confidence_level": "medium",
        "review_status": "approved",
        "approved": True,
        "approved_by": "William (revisión del propietario) — cuadros Base de Conocimiento / MARCAS_STCS",
        "approved_at": NOW,
        "created_at": NOW,
        "updated_at": NOW,
    })

    tset = topics_by_area.setdefault(area, {}).setdefault(topic, set())
    for k in cl.get("keywords", []):
        kk = deaccent(k).lower().strip()
        if kk and len(kk) <= 40:
            tset.add(kk)

# limpiar el campo interno
for j in judgments.values():
    j.pop("_rname", None)

os.makedirs(f"{ROOT}/data/approved_criteria", exist_ok=True)
os.makedirs(f"{ROOT}/data/source_judgments", exist_ok=True)
json.dump({"_note": "Corpus REAL del propietario, importado de sus cuadros (Base de Conocimiento Marcario + MARCAS_STCS). Texto verbatim; aprobado por el propietario.",
           "criteria": criteria},
          open(f"{ROOT}/data/approved_criteria/real_marcas.json", "w"), ensure_ascii=False, indent=1)
json.dump({"_note": "Resoluciones reales citadas por los cuadros del propietario (metadatos).",
           "judgments": list(judgments.values())},
          open(f"{ROOT}/data/source_judgments/real_marcas_judgments.json", "w"), ensure_ascii=False, indent=1)
# temas para el léxico (sets → listas ordenadas)
lex = {a: {t: sorted(ks) for t, ks in d.items()} for a, d in topics_by_area.items()}
json.dump(lex, open("/tmp/lexicon_topics.json", "w"), ensure_ascii=False, indent=1)

print(f"criterios reales: {len(criteria)} | resoluciones registradas: {len(judgments)}")
print("temas por área:", {a: len(d) for a, d in lex.items()})
