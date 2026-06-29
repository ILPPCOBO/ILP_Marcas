#!/usr/bin/env python3
"""
merge_lexicon — Funde las materias nuevas del corpus real (/tmp/lexicon_topics.json)
en el LEXICON_JSON de services/scopeClassifier.ts (fuente única; el espejo Python lo
parsea del mismo bloque). Reutiliza temas existentes por clave normalizada; añade los
nuevos con name = slug-con-espacios (de modo que toCorpusTopicKey(name) == slug).
NO toca subtopics existentes; los temas nuevos nacen sin subtopics.
"""
import json, re, unicodedata, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TS = f"{ROOT}/services/scopeClassifier.ts"
src = open(TS).read()

m = re.search(r"(// LEXICON-JSON-BEGIN\s*const LEXICON_JSON = `)(\{.*?\})(`;\s*// LEXICON-JSON-END)", src, re.DOTALL)
assert m, "no se encontró el bloque LEXICON_JSON"
lex = json.loads(m.group(2))


def norm_key(s):
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).lower()
    return "_".join(t for t in re.split(r"[^a-z0-9]+", s) if t)


new = json.load(open("/tmp/lexicon_topics.json"))  # { area_key: { topic_slug: [keywords] } }

added, merged = 0, 0
for area in lex["areas"]:
    ak = area["corpus_area"]
    if ak not in new:
        continue
    by_key = {norm_key(t["name"]): t for t in area["topics"]}
    for slug, kws in sorted(new[ak].items()):
        if slug in by_key:
            t = by_key[slug]
            have = set(t["keywords"])
            for k in kws:
                if k not in have:
                    t["keywords"].append(k); have.add(k)
            merged += 1
        else:
            area["topics"].append({"name": slug.replace("_", " "), "keywords": list(kws), "subtopics": []})
            added += 1

new_json = json.dumps(lex, ensure_ascii=False, indent=2)
assert "`" not in new_json and "${" not in new_json, "el JSON contiene caracteres que romperían el template literal"
out = src[:m.start()] + m.group(1) + new_json + m.group(3) + src[m.end():]
open(TS, "w").write(out)
print(f"léxico fundido: {added} temas nuevos, {merged} temas existentes ampliados")
print("temas totales por área:")
for a in lex["areas"]:
    print(f"  {a['name']:24} {len(a['topics'])} temas")
