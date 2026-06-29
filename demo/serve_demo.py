#!/usr/bin/env python3
"""
serve_demo.py — DEMO sin Node para "Locked Legal Advisor".

Esta máquina no tiene Node.js, así que la app real (tsx backend/server.ts) no
puede ejecutarse. Esta demo sirve el frontend REAL (../frontend) y reimplementa
los endpoints del backend con un ESPEJO FIEL del cerebro cerrado, escrito en
Python puro (stdlib). El espejo NO inventa lógica: lee el LÉXICO, las CHECKLISTS
y el GLOSARIO directamente del código TypeScript (entre sus marcadores
…-JSON-BEGIN/END) y los CRITERIOS/RESOLUCIONES/CATÁLOGO de data/ — una sola
fuente de verdad. Su fidelidad se autocomprueba contra docs/answerComposer-
examples.md al arrancar (--check).

IMPORTANTE (honestidad): el MOTOR REAL es el de TypeScript (services/engine.ts).
Este espejo existe solo para poder probar el comportamiento sin Node; cuando
instales Node ≥ 22, usa `npm install && npm run serve` para el producto real.

Uso:
    python3 demo/serve_demo.py            # arranca en http://127.0.0.1:8787
    python3 demo/serve_demo.py --check    # solo verifica fidelidad y sale
    PORT=9000 python3 demo/serve_demo.py  # otro puerto
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / "services"
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"

# ===========================================================================
# 0. Textos de aviso (fuente: services/legal/disclaimer.ts). Inlineados; la
#    autocomprobación los contrasta contra el TS para detectar divergencias.
# ===========================================================================
DISCLAIMER_VERSION = "1.1.0"
SHORT_DISCLAIMER = (
    "Esta respuesta es únicamente orientación informativa basada en un corpus cerrado de "
    "criterios jurídicos y no constituye asesoramiento jurídico. Para un caso concreto, "
    "consulte a un profesional."
)
DISCLAIMER_BREVE = (
    "Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye "
    "asesoramiento jurídico."
)
BANNER_DISCLAIMER = (
    "Esta herramienta ofrece orientación informativa basada en un corpus cerrado. "
    "No constituye asesoramiento jurídico."
)
ACCEPTANCE_TEXT = (
    "Entiendo que esta plataforma ofrece orientación informativa basada en una selección de "
    "resoluciones judiciales y que en ningún caso constituye asesoramiento jurídico, ni crea "
    "relación abogado-cliente, ni sustituye la consulta con un profesional colegiado."
)
SHORT_DISCLAIMER_EN = (
    "This response is only informational guidance based on a closed corpus of legal criteria "
    "and does not constitute legal advice. For a specific case, consult a professional."
)
BANNER_DISCLAIMER_EN = (
    "This tool offers informational guidance based on a closed corpus. It does not constitute "
    "legal advice."
)
ACCEPTANCE_TEXT_EN = (
    "I understand that this platform offers informational guidance based on a selection of "
    "court decisions and that it in no case constitutes legal advice, nor creates an "
    "attorney-client relationship, nor replaces consulting a licensed professional."
)
ENGLISH_SOURCE_NOTICE = (
    "This English response is an informational translation based on Spanish-source criteria. "
    "The original source references remain in Spanish."
)
TRANSLATION_DOUBT_NOTICE_EN = (
    "Note: some terms in your query could not be confidently mapped to the corpus, so the "
    "classification may be imprecise. Please rephrase if the result seems off."
)


def disclaimer_config(language: str) -> dict:
    en = language == "en"
    return {
        "version": DISCLAIMER_VERSION,
        "language": "en" if en else "es",
        "acceptance_text": ACCEPTANCE_TEXT_EN if en else ACCEPTANCE_TEXT,
        "short_disclaimer": SHORT_DISCLAIMER_EN if en else SHORT_DISCLAIMER,
        "banner": BANNER_DISCLAIMER_EN if en else BANNER_DISCLAIMER,
    }


# ===========================================================================
# 1. Normalización y coincidencia de keywords (espejo de scopeClassifier.ts)
# ===========================================================================
def normalize(text: str) -> list[str]:
    text = unicodedata.normalize("NFD", (text or "").lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return [t for t in re.split(r"[^a-z0-9]+", text) if t]


def normalize_keyword(keyword: str) -> list[str]:
    kw = unicodedata.normalize("NFD", keyword.lower())
    kw = "".join(c for c in kw if unicodedata.category(c) != "Mn")
    return [t for t in re.split(r"[^a-z0-9*]+", kw) if t]


def _token_matches(kw_token: str, token: str) -> bool:
    if kw_token.endswith("*"):
        return token.startswith(kw_token[:-1])
    return token == kw_token


def all_matches(keyword: str, tokens: list[str]) -> list[dict]:
    kw_tokens = normalize_keyword(keyword)
    if not kw_tokens:
        return []
    weight = 2 if len(kw_tokens) > 1 else 1
    out = []
    for i in range(0, len(tokens) - len(kw_tokens) + 1):
        if all(_token_matches(kw_tokens[j], tokens[i + j]) for j in range(len(kw_tokens))):
            out.append({"kw": keyword, "weight": weight, "start": i, "length": len(kw_tokens)})
    return out


def matches_any_keyword(keywords: list[str], tokens: list[str]) -> bool:
    return any(all_matches(kw, tokens) for kw in keywords)


def score_keywords(keywords: list[str], tokens: list[str]) -> tuple[int, list[str]]:
    candidates = []
    for order, kw in enumerate(keywords):
        for m in all_matches(kw, tokens):
            candidates.append({**m, "order": order})
    candidates.sort(key=lambda c: (-c["weight"], c["start"], c["order"]))
    consumed = [False] * len(tokens)
    used: set[str] = set()
    score = 0
    hits: list[str] = []
    for c in candidates:
        if c["kw"] in used:
            continue
        if any(consumed[t] for t in range(c["start"], c["start"] + c["length"])):
            continue
        for t in range(c["start"], c["start"] + c["length"]):
            consumed[t] = True
        used.add(c["kw"])
        score += c["weight"]
        hits.append(c["kw"])
    return score, hits


# ---- carga de los bloques JSON cerrados embebidos en el TS (fuente única) ----
def _between(src: Path, begin: str, end: str) -> str:
    text = src.read_text(encoding="utf-8")
    body = text.split(begin, 1)[1].split(end, 1)[0]
    return body[body.index("`") + 1 : body.rindex("`")]


LEXICON = json.loads(_between(SERVICES / "scopeClassifier.ts", "LEXICON-JSON-BEGIN", "LEXICON-JSON-END"))
CHECKLISTS = json.loads(_between(SERVICES / "missingFactsDetector.ts", "CHECKLISTS-JSON-BEGIN", "CHECKLISTS-JSON-END"))
GLOSSARY = json.loads(_between(SERVICES / "i18n" / "glossary.ts", "GLOSSARY-JSON-BEGIN", "GLOSSARY-JSON-END"))


# ===========================================================================
# 2. classifyScope (espejo de scopeClassifier.ts)
# ===========================================================================
def confidence_for_score(score: int) -> str:
    if score >= 4:
        return "high"
    if score >= 2:
        return "medium"
    return "low"


def classify_scope(question: str) -> dict:
    tokens = normalize(question)
    if not tokens:
        return {"area": "Fuera de alcance", "topic": None, "subtopics": [], "out_of_scope": True,
                "confidence": "high", "reason": "La consulta está vacía o no contiene texto analizable."}

    candidates = []
    for area in LEXICON["areas"]:
        _, area_hits = score_keywords(area["area_keywords"], tokens)
        area_bonus = 1 if area_hits else 0
        best_topic, best_topic_score, best_topic_hits = None, 0, []
        for topic in area["topics"]:
            sc, hits = score_keywords(topic["keywords"], tokens)
            if sc > best_topic_score:
                best_topic, best_topic_score, best_topic_hits = topic, sc, hits
        total = best_topic_score + area_bonus
        if total == 0:
            continue
        candidates.append({"area": area, "topic": best_topic, "topic_score": best_topic_score,
                           "area_bonus": area_bonus, "total": total,
                           "area_hits": area_hits, "topic_hits": best_topic_hits})

    best = None
    for cand in candidates:
        if (best is None or cand["total"] > best["total"]
                or (cand["total"] == best["total"] and cand["area_bonus"] > best["area_bonus"])):
            best = cand
    runner_up = 0
    for cand in candidates:
        if best is not None and cand["area"]["name"] != best["area"]["name"] and cand["total"] > runner_up:
            runner_up = cand["total"]

    out_best = None
    for dom in LEXICON["out_of_domain"]:
        sc, hits = score_keywords(dom["keywords"], tokens)
        if sc > 0 and (out_best is None or sc > out_best["score"]):
            out_best = {"domain": dom["domain"], "score": sc, "hits": hits}

    in_total = best["total"] if best else 0
    if out_best is not None and out_best["score"] >= in_total:
        return {"area": "Fuera de alcance", "topic": None, "subtopics": [], "out_of_scope": True,
                "confidence": "high",
                "reason": f'La consulta trata sobre una materia no cubierta por el corpus ("{out_best["domain"]}").'}
    if best is None:
        return {"area": "Fuera de alcance", "topic": None, "subtopics": [], "out_of_scope": True,
                "confidence": "low", "reason": "Ninguna materia del corpus se reconoce en la consulta."}

    subtopics = []
    if best["topic"]:
        for st in best["topic"]["subtopics"]:
            if score_keywords(st["keywords"], tokens)[1]:
                subtopics.append(st["name"])

    confidence = confidence_for_score(best["total"])
    if runner_up > 0 and best["total"] - runner_up <= 1:
        confidence = "low"

    topic = best["topic"]["name"] if (best["topic"] and best["topic_score"] > 0) else None
    return {"area": best["area"]["name"], "topic": topic, "subtopics": subtopics,
            "out_of_scope": False, "confidence": confidence,
            "reason": "Coincidencias del léxico cerrado."}


def scope_area_to_legal_area(area: str):
    for a in LEXICON["areas"]:
        if a["name"] == area:
            return a["corpus_area"]
    return None


def to_corpus_topic_key(topic: str) -> str:
    return "_".join(normalize(topic))


# ===========================================================================
# 3. detectMissingFacts (espejo de missingFactsDetector.ts)
# ===========================================================================
def detect_missing_facts(question: str, scope: dict) -> dict:
    if scope["out_of_scope"]:
        return {"needs_clarification": False, "missing_facts": [], "clarifying_questions": []}
    tokens = normalize(question)
    fallback = CHECKLISTS["area_fallback"].get(scope["area"])
    if scope["topic"] is None:
        if fallback:
            return {"needs_clarification": True, "missing_facts": [fallback["fact"]],
                    "clarifying_questions": [fallback["question"]]}
        return {"needs_clarification": True, "missing_facts": ["tema concreto de la consulta"],
                "clarifying_questions": ["¿Podría concretar el tema de su consulta?"]}

    checklist = next((c for c in CHECKLISTS["checklists"]
                      if c["area"] == scope["area"] and c["topic"] == scope["topic"]), None)
    if not checklist:
        fact = fallback["fact"] if fallback else "tema concreto de la consulta"
        q = fallback["question"] if fallback else "¿Podría concretar el tema de su consulta?"
        return {"needs_clarification": True, "missing_facts": [fact], "clarifying_questions": [q]}

    missing = [f for f in checklist["essential_facts"] if not matches_any_keyword(f["signals"], tokens)]
    return {"needs_clarification": len(missing) > 0,
            "missing_facts": [f["fact"] for f in missing],
            "clarifying_questions": [f["question"] for f in missing]}


# ===========================================================================
# 4. i18n (espejo de glossary.ts / locale.ts)
# ===========================================================================
def resolve_locale(value) -> str:
    return "en" if value == "en" else "es"


def normalize_query(text: str, locale: str) -> dict:
    if locale != "en":
        return {"spanish": text, "uncertain": False, "matched": 0}
    low = " " + text.lower() + " "
    add, matched = [], 0
    for entry in GLOSSARY:
        if any(p.lower() in low for p in entry["en"]):
            matched += 1
            add.append(entry["es"])
    spanish = (text + " " + " ".join(add)).strip()
    return {"spanish": spanish, "uncertain": matched == 0, "matched": matched}


# Fuente ÚNICA de presentación EN: el bloque I18N-EN-JSON embebido en glossary.ts
# (áreas, temas y preguntas de aclaración), leído igual que LEXICON/CHECKLISTS.
# Vocabulario CERRADO (Reglas 2/3): no LLM, no red. Las FUENTES, órganos, números
# de resolución y fechas NUNCA se traducen. Las opciones guiadas EN viven en
# data/clarify_options.json (question_en + label_en por opción).
try:
    I18N_EN = json.loads(_between(SERVICES / "i18n" / "glossary.ts", "I18N-EN-JSON-BEGIN", "I18N-EN-JSON-END"))
except Exception:
    I18N_EN = {"areas": {}, "topics": {}, "checklist": {}}
AREA_EN = I18N_EN.get("areas", {})
TOPIC_EN = I18N_EN.get("topics", {})
CHECKLIST_EN = I18N_EN.get("checklist", {})


def area_label(area: str, locale: str) -> str:
    return AREA_EN.get(area, area) if locale == "en" else area


def area_known(area: str) -> bool:
    return area in AREA_EN


def topic_label(topic, locale: str) -> dict:
    if topic is None:
        return {"label": None, "known": True}
    if locale != "en":
        return {"label": topic, "known": True}
    en = TOPIC_EN.get(topic)
    return {"label": en if en is not None else topic, "known": en is not None}


def tr_question(q: str, locale: str) -> str:
    """Traduce una pregunta de aclaración del corpus (vocabulario cerrado). En
    'es' la devuelve igual; en 'en' usa el mapa cerrado y, si no la conoce, la
    deja en español (no inventa traducción — Regla 4)."""
    if locale != "en":
        return q
    return CHECKLIST_EN.get(q, q)


# --- Nombres de resolución LEGIBLES (mostrar al usuario algo claro, no el slug) ---
# Expande las siglas del nombre de la resolución manteniendo la cita FIEL (Regla 9):
# misma resolución, número, sala/sección y fecha; solo se aclaran las abreviaturas.
ECLI_COURT = {
    "TS": "del Tribunal Supremo", "AN": "de la Audiencia Nacional",
    "APB": "de la Audiencia Provincial de Barcelona",
    "APM": "de la Audiencia Provincial de Madrid",
    "APA": "de la Audiencia Provincial de Alicante",
    "AP": "de la Audiencia Provincial", "TSJ": "del Tribunal Superior de Justicia",
}


def _clean_sr(sr: str) -> str:
    """Sanea cadenas de cita malformadas por el import (no muta el corpus, solo
    display): 'Fecha:' pegado → coma; quita colas vacías; colapsa fecha duplicada."""
    sr = (sr or "").strip()
    sr = re.sub(r"\s*Fecha:\s*", ", ", sr)
    sr = re.sub(r"\s*(Materia|Sentencia|Auto):\s*$", "", sr)
    parts = [p.strip() for p in sr.split(",") if p.strip() != ""]
    dedup = []
    for p in parts:
        if dedup and dedup[-1].lower() == p.lower():
            continue
        dedup.append(p)
    return ", ".join(dedup)


def _readable_resolution_name(sr: str) -> str:
    raw = (sr or "").strip()
    sr = _clean_sr(raw)
    head, _, tail = sr.partition(",")
    head = head.strip()
    fecha = tail.strip()
    m = re.match(r"^STJUE\s+(.*)$", head)
    if m:
        name = "Sentencia del Tribunal de Justicia de la UE, asunto " + m.group(1).strip()
        return name + (f", de {fecha}" if fecha else "")
    # Juzgado de lo Mercantil: 'SJM nº N Ciudad' | 'S JM N Ciudad X/Y' | 'A JM N Ciudad X/Y'
    m = re.match(r"^(?:([SA])\s*)?JM\s*(?:n[ºo°]\s*)?(\d+)\s+([A-ZÁÉÍÓÚ][\wÁÉÍÓÚáéíóúñ]+)\s*(.*)$", head)
    if m:
        tletter, njz, city, inline = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        org = f"del Juzgado de lo Mercantil nº {njz} de {city}"
        tipo = "Sentencia" if (tletter or "S") == "S" else "Auto"
        num = ""
        mb = re.match(r"^(Sentencia|Auto)\s+(\d+/\d+)", fecha)
        if mb:
            tipo, num, fecha = mb.group(1), mb.group(2), fecha[mb.end():].lstrip(", ").strip()
        elif inline:
            mi = re.match(r"^(\d+/\d+)", inline)
            if mi:
                num = mi.group(1)
        name = f"{tipo} {org}"
        if num:
            name += f", nº {num}"
        if fecha:
            name += f", de {fecha}"
        return name
    m = re.match(r"^([SA])\s+(.*)$", head)
    if not m:
        return raw
    tipo = "Sentencia" if m.group(1) == "S" else "Auto"
    rest = m.group(2).strip()
    org, rest2 = None, ""
    mm = re.match(r"^TS(?![A-Z])\s*(.*)$", rest)  # TS pero NO TSJ (Tribunal Superior de Justicia)
    if mm:
        org, rest2 = "del Tribunal Supremo", mm.group(1).strip()
    else:
        mm = re.match(r"^AP\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+(?:\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚñáéíóú]+)?)\s*(.*)$", rest)
        if mm:
            org, rest2 = f"de la Audiencia Provincial de {mm.group(1).strip()}", mm.group(2).strip()
        else:
            mm = re.match(r"^TSJ\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+)\s*(.*)$", rest)
            if mm:
                org, rest2 = f"del Tribunal Superior de Justicia de {mm.group(1).strip()}", mm.group(2).strip()
    if org is None:
        return raw
    num = rest2.strip()
    name = f"{tipo} {org}"
    if num:
        name += f", nº {num}" if re.match(r"^\d", num) else f" {num}"
    if fecha:
        name += f", de {fecha}"
    return name


def _readable_judgment_id(jid: str) -> str:
    jid = (jid or "").strip()
    m = re.match(r"^ECLI[-:]ES[-:]([A-Z]+)[-:](\d{4})[-:](.+)$", jid)
    if m:
        code, year, num = m.group(1), m.group(2), m.group(3)
        court = ECLI_COURT.get(code, "")
        tipo = "Auto" if num.rstrip().upper().endswith("A") else "Sentencia"
        ecli = f"ECLI:ES:{code}:{year}:{num}"
        return f"{tipo} {court} ({ecli})" if court else f"Resolución ({ecli})"
    return ""


def readable_citation(c: dict) -> str:
    """Nombre legible de la fuente para el usuario, FIEL a la resolución (Regla 9).
    - source_reference que ya nombra la resolución → se expanden sus siglas;
    - source_reference 'pinpoint' + judgment_id ECLI → se antepone la resolución decodificada;
    - resto (p. ej. datos mock con slug no-ECLI) → formato verbatim 'sr (resolución id)'
      para preservar la trazabilidad y la fidelidad al golden."""
    sr = (c.get("source_reference") or "").strip()
    jid = (c.get("judgment_id") or "").strip()
    name = _readable_resolution_name(sr)
    if name and name != sr:
        return name
    jname = _readable_judgment_id(jid)
    if jname:
        return f"{jname}, {sr}" if sr else jname
    if sr and jid:
        return f"{sr} (resolución {jid})"
    return sr or jid


# ===========================================================================
# 5. Corpus: carga + isServable + retrieve (espejo de criteriaRetriever/models)
# ===========================================================================
def _iso(s) -> bool:
    return isinstance(s, str) and len(s) >= 10 and "T" in s


def _nonempty(s) -> bool:
    return isinstance(s, str) and s.strip() != ""


def _str_array(v) -> bool:
    return isinstance(v, list) and all(_nonempty(x) for x in v) and len(v) == len(set(v))


def validate_legal_criterion(c: dict) -> bool:
    if not isinstance(c, dict):
        return False
    req_str = ["id", "judgment_id", "topic", "criterion_text", "source_excerpt", "source_reference"]
    if not all(_nonempty(c.get(k)) for k in req_str):
        return False
    if c.get("area") not in ("marcas", "propiedad_intelectual", "patentes", "procesal"):
        return False
    if c.get("subtopic") is not None and not _nonempty(c.get("subtopic")):
        return False
    if not all(_str_array(c.get(k)) for k in ("conditions_for_application", "does_not_answer", "limits")):
        return False
    if c.get("confidence_level") not in ("high", "medium", "low"):
        return False
    if c.get("review_status") not in ("pending_review", "approved", "rejected"):
        return False
    if not isinstance(c.get("approved"), bool):
        return False
    # coherencia constitucional approved <=> review_status == "approved"
    if c["approved"] != (c["review_status"] == "approved"):
        return False
    if c["review_status"] == "approved":
        if not _nonempty(c.get("approved_by")) or not _iso(c.get("approved_at")):
            return False
    else:
        if c.get("approved_by") is not None or c.get("approved_at") is not None:
            return False
    return _iso(c.get("created_at")) and _iso(c.get("updated_at"))


def is_servable(c: dict) -> bool:
    return (c.get("review_status") == "approved" and c.get("approved") is True
            and _nonempty(c.get("approved_by")) and _iso(c.get("approved_at"))
            and validate_legal_criterion(c))


def _load_collection(path: Path, key: str) -> list:
    out = []
    if not path.exists():
        return out
    for name in sorted(os.listdir(path)):
        if not name.endswith(".json"):
            continue
        try:
            raw = json.loads((path / name).read_text(encoding="utf-8"))
        except Exception:
            continue
        items = raw if isinstance(raw, list) else (raw.get(key, []) if isinstance(raw, dict) else [])
        if isinstance(items, list):
            out.extend(items)
    return out


def load_approved_criteria() -> list:
    return [c for c in _load_collection(DATA / "approved_criteria", "criteria") if validate_legal_criterion(c)]


def load_judgment_ids() -> set:
    ids = set()
    for j in _load_collection(DATA / "source_judgments", "judgments"):
        if isinstance(j, dict) and _nonempty(j.get("id")):
            ids.add(j["id"])
    return ids


def retrieve_approved_criteria(scope: dict, corpus: list, judgment_ids: set) -> dict:
    legal_area = scope_area_to_legal_area(scope["area"])
    if legal_area is None or scope["topic"] is None:
        return {"criteria": [], "insufficient_criteria": True}
    topic_key = to_corpus_topic_key(scope["topic"])
    subtopic_keys = {to_corpus_topic_key(s) for s in scope.get("subtopics", [])}
    matched = [c for c in corpus
               if is_servable(c) and c["area"] == legal_area and c["topic"] == topic_key
               and c["judgment_id"] in judgment_ids]
    matched.sort(key=lambda c: (0 if (c.get("subtopic") in subtopic_keys) else 1, c["id"]))
    return {"criteria": matched, "insufficient_criteria": len(matched) < 1}


# ---------------------------------------------------------------------------
# Aclaración GUIADA (multiple choice): en vez de preguntas abiertas, se ofrecen
# opciones derivadas de los criterios reales (data/clarify_options.json). Al
# elegir una, la frase 'adds' se añade a la consulta → ruteo preciso (Reglas 7,17).
try:
    CLARIFY_OPTIONS = json.loads((DATA / "clarify_options.json").read_text(encoding="utf-8"))
except Exception:
    CLARIFY_OPTIONS = {}


def _topics_with_criteria():
    m = {}
    for c in CORPUS:
        if is_servable(c):
            m.setdefault(c["area"], set()).add(c["topic"])
    return m


def _topic_display(area_key, topic_key):
    for a in LEXICON["areas"]:
        if a["corpus_area"] == area_key:
            for t in a["topics"]:
                if to_corpus_topic_key(t["name"]) == topic_key:
                    return t["name"]
    return topic_key.replace("_", " ")


def _topic_keywords(area_key, topic_key):
    for a in LEXICON["areas"]:
        if a["corpus_area"] == area_key:
            for t in a["topics"]:
                if to_corpus_topic_key(t["name"]) == topic_key:
                    return t.get("keywords", [])
    return []


def _localize_cfg(key, cfg, locale):
    """Presenta una entrada de clarify_options en el idioma pedido. El inglés vive
    en la propia entrada (question_en / label_en). La frase 'adds' SIEMPRE se
    mantiene en español: alimenta el clasificador cerrado."""
    if locale != "en":
        return {"question": cfg.get("question"),
                "options": [{"label": o.get("label"), "adds": o.get("adds")} for o in cfg.get("options", [])]}
    opts = [{"label": o.get("label_en") or o.get("label"), "adds": o.get("adds")} for o in cfg.get("options", [])]
    return {"question": cfg.get("question_en") or cfg.get("question"), "options": opts}


def build_clarify_options(scope, tokens=None, locale="es"):
    """Opciones guiadas para una decisión 'clarify':
    - tema conocido con config → escenarios fieles de ese tema;
    - tema ambiguo → desambiguación por materia, ORDENADA por relevancia a la consulta."""
    area_key = scope_area_to_legal_area(scope.get("area"))
    topic = scope.get("topic")
    if area_key and topic:
        key = f"{area_key}|{to_corpus_topic_key(topic)}"
        cfg = CLARIFY_OPTIONS.get(key)
        if cfg:
            return [_localize_cfg(key, cfg, locale)]
    twc = _topics_with_criteria()
    areas = [area_key] if (area_key and area_key in twc) else list(twc.keys())
    qtoks = {t for t in (tokens or []) if len(t) >= 4}
    cand = []
    for ak in areas:
        for tk in twc.get(ak, []):
            cfg = CLARIFY_OPTIONS.get(f"{ak}|{tk}")
            adds = cfg["options"][0]["adds"] if (cfg and cfg.get("options")) else _topic_display(ak, tk)
            # relevancia = nº de palabras de la consulta presentes en los keywords/nombre del tema
            blob = _deaccent_text(" ".join(_topic_keywords(ak, tk)) + " " + tk.replace("_", " ")).lower()
            score = sum(1 for t in qtoks if t in blob)
            cand.append((score, _topic_display(ak, tk), adds))
    if not cand:
        return []
    # más relevantes primero; en empate, orden alfabético estable
    cand.sort(key=lambda x: (-x[0], x[1]))

    def _lbl(disp):
        if locale == "en":
            return (topic_label(disp, "en")["label"] or disp).capitalize()
        return disp.capitalize()

    q = ("Which of these matters does your case concern? Choose to refine:" if locale == "en"
         else "¿Sobre cuál de estas cuestiones trata su caso? Elija para precisar:")
    return [{"question": q,
             "options": [{"label": _lbl(c[1]), "adds": c[2]} for c in cand[:10]]}]


def _query_has_scenario(scope, spanish_text):
    """¿La consulta ya contiene un escenario del corpus que el usuario eligió?
    Si es así, ya aportó la información concreta → se responde (no se repregunta
    de nuevo): converge en 1 clic. Coincidencia por subcadena del 'adds'
    normalizado (frase larga y distintiva → sin falsos positivos)."""
    area_key = scope_area_to_legal_area(scope.get("area"))
    if not area_key:
        return False
    norm = " ".join(normalize(spanish_text))
    for key, cfg in CLARIFY_OPTIONS.items():
        if not key.startswith(area_key + "|"):
            continue
        for o in cfg.get("options", []):
            an = " ".join(normalize(o.get("adds", "")))
            if len(an) >= 25 and an in norm:
                return True
    return False


# ===========================================================================
# 6. decide (espejo de decisionEngine.ts)
# ===========================================================================
AMBIGUITY_QUESTION = ("Su consulta podría encajar en más de una materia del corpus. "
                      "¿Podría reformularla concretando el aspecto que más le interesa?")


def decide(scope: dict, missing: dict, retrieval: dict) -> dict:
    if scope["out_of_scope"]:
        return {"decision": "out_of_scope", "clarifying_questions": []}
    if missing["needs_clarification"]:
        return {"decision": "clarify", "clarifying_questions": list(missing["clarifying_questions"])}
    if scope["confidence"] == "low":
        return {"decision": "clarify", "clarifying_questions": [AMBIGUITY_QUESTION]}
    if retrieval["insufficient_criteria"] or len(retrieval["criteria"]) == 0:
        return {"decision": "insufficient_criteria", "clarifying_questions": []}
    if not all(is_servable(c) for c in retrieval["criteria"]):
        return {"decision": "insufficient_criteria", "clarifying_questions": []}
    return {"decision": "answer", "clarifying_questions": []}


# ===========================================================================
# 7. composeAnswer (espejo de answerComposer.ts) — guardarraíl de lenguaje vetado
# ===========================================================================
FORBIDDEN_PATTERNS = [
    r"\b(?:debes?|debe|deben|deber[íi]a(?:s|n)?|deber[íi]ais|tiene[s]?|tienen)\s+(?:usted\s+|vd\.?\s+)?que\s+(?:demandar|reclamar|denunciar|querellar|interponer)",
    r"\b(?:debes?|debe|deben|deber[íi]a(?:s|n)?|deber[íi]ais)\s+(?:usted\s+|vd\.?\s+)?(?:demandar|reclamar|denunciar|querellar(?:se)?|interponer)",
    r"\b(?:le\s+)?recomiendo\s+(?:que\s+)?(?:demand|reclam|denunci|querell|interpon)",
    r"\b(?:est[áa]\s+)?obligad[oa]s?\s+a\s+(?:demandar|reclamar|denunciar|querellar|interponer)",
    r"\bganar(?:as|ás|a|á|ias|ías|ia|ía|emos|eis|éis|an|amos|ais|lo|la|los|las)\b",
    r"\bva(?:s|n)?\s+(?:usted\s+|vd\.?\s+)?a\s+ganar(?:lo|la|los|las)?\b",
    # Pronóstico nombrado por la Regla 18 ("probabilidad de ganar"), acotado.
    r"\b(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?)\s+(?:\w+\s+)?de\s+ganar\b",
    r"\btriunfar[áa](?:s|n)?\b",
    r"\b(?:su\s+)?(?:demanda|pretensi[óo]n|recurso|acci[óo]n|reclamaci[óo]n)\s+(?:prosperar[áa](?:n)?|triunfar[áa])",
    r"\bobtendr[áa](?:s|n)?\s+(?:una\s+)?sentencia\s+(?:favorable|a\s+su\s+favor)",
    r"\b(?:el\s+)?(?:resultado|fallo)\s+(?:le\s+)?ser[áa]\s+favorable",
    r"\btiene[s]?\s+(?:el\s+[ée]xito|el\s+caso|la\s+victoria)\s+(?:garantizad[oa]|asegurad[oa]|ganad[oa])\b",
    r"\bes\s+ilegal\s+seguro\b",
    r"\bseguro\s+que\s+gana",
    r"\btiene[s]?\s+(?:el\s+caso\s+)?ganado\b",
    # — Huecos de pronóstico/recomendación de la auditoría (Regla 18) —
    r"\btendr[áa]n?\s+(?:un\s+|buen\s+|pleno\s+)?[ée]xito\b",
    r"\b(?:le\s+)?(?:ser[áa]|resultar[áa])\s+favorable\b",
    r"\bser[áa]\s+de\s+su\s+favor\b",
    r"\b(?:la\s+)?(?:sentencia|resoluci[óo]n|demanda|pretensi[óo]n)\s+(?:le\s+)?(?:ser[áa]|resultar[áa])\s+(?:favorable|positiv[oa]|a\s+su\s+favor)",
    r"\b(?:le\s+)?conviene\s+(?:que\s+)?(?:demand|reclam|denunci|querell|interpon|recurr)",
    r"\b(?:vale\s+la\s+pena|es\s+prudente|es\s+recomendable|es\s+aconsejable)\s+(?:demand|reclam|denunci|querell|interpon|recurr)",
    r"\bobligad[oa]s?\s+(?:a\s+)?(?:demandar|reclamar|denunciar|querellar|interponer)",
    r"\b(?:lograr[áa]|conseguir[áa]|obtendr[áa])(?:s|n)?\s+(?:el\s+|la\s+|un[ao]?\s+|su\s+)?(?:[ée]xito|victoria|resoluci[óo]n\s+(?:favorable|positiva)|sentencia\s+(?:favorable|positiva|a\s+su\s+favor))",
    r"\b(?:tu|su)\s+(?:victoria|[ée]xito)\s+(?:es|est[áa])\s+(?:asegurad[oa]|segur[oa]|garantizad[oa])",
    r"\bvictoria\s+(?:asegurad[oa]|segur[oa]|garantizad[oa])\b",
    r"\bperspectivas\s+(?:son\s+|muy\s+|le\s+son\s+)?favorables\b",
    r"\b\d+\s+por\s+ciento\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|probabilidad)",
    r"\b[ée]xito\s+(?:garantizad[oa]|asegurad[oa]|seguro)\b",
    # — Segunda tanda de huecos (auditoría): pronóstico "blando", subjuntivo, pasiva, condicional —
    r"\bgan(?:e|es|emos|en|ar[áa]n)\s+(?:usted\s+)?(?:el\s+|mi\s+|la\s+|este\s+|ese\s+|su\s+)?(?:juicio|caso|pleito|litigio|demanda|recurso|asunto)\b",
    r"\b(?:buenas?|altas?|muchas?|excelentes|grandes)\s+(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|prosperar|triunfar)",
    r"\b(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+(?:\w+\s+){0,2}de\s+(?:[ée]xito|victoria|prosperar|triunfar)\b",
    r"\bhay\s+(?:una\s+)?(?:posibilidad|probabilidad|opci[óo]n|oportunidad)\s+de\s+(?:[ée]xito|ganar|victoria)",
    r"\bpodr[íi]a?s?\s+(?:usted\s+)?(?:ganar|vencer|prosperar|triunfar|tener\s+[ée]xito|obtener\s+(?:una\s+)?(?:sentencia|resoluci[óo]n)\s+(?:favorable|a\s+su\s+favor))",
    r"\bes\s+probable\s+que\s+(?:\w+\s+){0,2}(?:gan(?:e|es|en|emos)|venza|prosper(?:e|en)|triunf(?:e|en)|tenga\s+[ée]xito)",
    r"\b(?:ser[áa]|ser[íi]a)\s+ganad[oa]\b",
    r"\bganad[oa]\s+por\s+(?:usted|vd\.?|ti|el\s+demandante|la\s+demandante)",
    r"\b(?:su\s+)?(?:caso|demanda|pretensi[óo]n|pleito)\s+(?:ser[íi]a|ser[áa])\s+(?:decidid[oa]|resuelt[oa]|fallad[oa])\s+(?:a\s+su\s+favor|favorablemente)",
    r"\bperspectivas\s+(?:de\s+|muy\s+buenas?\s+de\s+|buenas?\s+de\s+)?(?:[ée]xito|ganar|victoria|triunfo)\b",
    r"\b(?:buenas?|excelentes|magn[íi]ficas|inmejorables|muy\s+buenas?)\s+perspectivas\b",
    r"\b(?:habr[íi]a?s?|hubiera[ns]?|hubiese[ns]?|hay[ae]n?)\s+ganad[oa]\b",
    r"\b(?:tu|su)\s+[ée]xito\s+es\s+probable\b",
    # — Tercera tanda (verificación adversarial): conjugación COMPLETA de verbos-
    #   resultado, incl. futuro 1ª persona (-é) y condicional (-ía). Se prueba sobre
    #   el texto des-acentuado, así que las terminaciones sin tilde bastan.
    r"\b(?:gana|perde|vence|prospera|triunfa)r(?:[ée]|es|emos|[ée]is|[áa]n|[áa]s|[áa]|[íi]a|[íi]as|[íi]amos|[íi]ais|[íi]an)\b",
    r"\b(?:tendr|obtendr)(?:[ée]|[áa]s?|[áa]|emos|[ée]is|[áa]n|[íi]as?|[íi]amos|[íi]ais|[íi]an)\s+(?:un\s+|buen\s+|pleno\s+|el\s+)?(?:[ée]xito|(?:una?\s+)?(?:sentencia|resoluci[óo]n)\s+(?:favorable|positiva|a\s+su\s+favor))",
    r"\b(?:ser|resultar)(?:[ée]|[áa]s?|[áa]|emos|[ée]is|[áa]n|[íi]as?|[íi]amos|[íi]ais|[íi]an)\s+(?:le\s+|los\s+|las\s+)?(?:favorable|de\s+su\s+favor|a\s+su\s+favor|positiv[oa]|ganador(?:es|a|as)?|vencedor(?:es|a|as)?)",
    r"\b(?:gan(?:e|en|emos)|venz(?:a|an)|prosper(?:e|en)|triunf(?:e|en))\s+(?:el|la|los|las|su|mi|este|ese|un[oa]?)\s+(?:demandante|demandada|demanda|pretensi[óo]n|acci[óo]n|reclamaci[óo]n|caso|pleito|juicio|litigio|recurso|asunto)\b",
]


def _deaccent_text(s):
    """Quita acentos (NFD). Para que el denylist case también con vocal final
    acentuada de forma uniforme con el motor TS/JS (donde \\b es ASCII)."""
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))


def has_forbidden_language(text: str) -> bool:
    alt = _deaccent_text(text)
    return any(re.search(p, text, re.IGNORECASE) or re.search(p, alt, re.IGNORECASE) for p in FORBIDDEN_PATTERNS)


def _unique(items: list) -> list:
    return list(dict.fromkeys(items))


def _lowest_confidence(criteria: list) -> str:
    rank = {"low": 0, "medium": 1, "high": 2}
    acc = "high"
    for c in criteria:
        if rank[c["confidence_level"]] < rank[acc]:
            acc = c["confidence_level"]
    return acc


def _render_answer_es(scope: dict, criteria: list) -> tuple[str, str]:
    area = scope["area"]
    topic = scope["topic"] or "(tema no determinado)"
    subt = f"; en concreto: {', '.join(scope['subtopics'])}" if scope.get("subtopics") else ""
    s1 = ("1. Lo que he entendido\n"
          f"He entendido que su consulta se refiere a {area.lower()}, en relación con «{topic}»{subt}. "
          "Tomo como base únicamente lo que usted ha descrito, sin añadir hechos que no haya mencionado.")
    s2 = ("2. Encaje dentro del corpus\n"
          f"La consulta encaja en el área «{area}», tema «{topic}».")
    s3lines = [f"   • [{c['id']}] {c['criterion_text']}\n"
               f"     Fuente: {readable_citation(c)}." for c in criteria]
    s3 = "3. Criterios aplicables\n" + "\n".join(s3lines)
    s4items = []
    for c in criteria:
        cond = (f" Esto podría ser relevante si concurren: {'; '.join(c['conditions_for_application'])}."
                if c["conditions_for_application"] else "")
        s4items.append(f"   • Según los criterios disponibles, el corpus recoge que {c['criterion_text']}{cond}")
    s4 = ("4. Orientación informativa\n"
          "Según los criterios disponibles en el corpus, los siguientes elementos podrían ser "
          "relevantes para orientar el análisis, sin que ello anticipe ningún resultado:\n"
          + "\n".join(s4items)
          + "\nEl corpus no permite afirmar un resultado: estos criterios solo orientan el análisis.")
    no_resp = _unique([x for c in criteria for x in c["does_not_answer"]])
    lim = _unique([x for c in criteria for x in c["limits"]])
    limits_body = ("Esta respuesta no concluye su caso. En particular, los criterios usados no resuelven: "
                   f"{'; '.join(no_resp)}. Además, presentan estos límites: {'; '.join(lim)}. "
                   "El resultado real dependería de la prueba que se practique y de la normativa vigente, "
                   "que esta herramienta no verifica.")
    s5 = "5. Límites de esta respuesta\n" + limits_body
    s6 = "6. Aviso\n" + SHORT_DISCLAIMER
    return "\n\n".join([s1, s2, s3, s4, s5, s6]), limits_body


def _english_notices(uncertain: bool) -> str:
    n = ENGLISH_SOURCE_NOTICE
    if uncertain:
        n += "\n" + TRANSLATION_DOUBT_NOTICE_EN
    return n


def _render_answer_en(scope: dict, criteria: list, translation_uncertain: bool) -> tuple[str, str]:
    area = area_label(scope["area"], "en")
    t = topic_label(scope["topic"], "en")
    topic = t["label"] or "(topic not determined)"
    subt = f" (specifically: {', '.join(scope['subtopics'])})" if scope.get("subtopics") else ""
    uncertain = translation_uncertain or (not t["known"]) or (not area_known(scope["area"]))
    s1 = ("1. What I understood\n"
          f"I understand that your query concerns {area.lower()}, regarding «{topic}»{subt}. "
          "I rely only on what you have described, without adding facts you did not mention.")
    s2 = "2. Fit within the corpus\n" + f"The query fits the area «{area}», topic «{topic}»."
    s3lines = [f"   • [{c['id']}] {c['criterion_text']}\n"
               f"     Source (in Spanish): {readable_citation(c)}." for c in criteria]
    s3 = "3. Applicable criteria\n" + "\n".join(s3lines)
    s4items = []
    for c in criteria:
        cond = (f" This may be relevant if the following concur: {'; '.join(c['conditions_for_application'])}."
                if c["conditions_for_application"] else "")
        s4items.append(f"   • According to the available criteria, the corpus records that: {c['criterion_text']}{cond}")
    s4 = ("4. Informational guidance\n"
          "Based on the available criteria in the corpus, the following points may be relevant to "
          "guide the analysis, without anticipating any outcome:\n"
          + "\n".join(s4items)
          + "\nThe corpus does not allow asserting an outcome: these criteria only guide the analysis.")
    no_resp = _unique([x for c in criteria for x in c["does_not_answer"]])
    lim = _unique([x for c in criteria for x in c["limits"]])
    limits_body = ("This response does not resolve your case. In particular, the criteria used do not "
                   f"address: {'; '.join(no_resp)}. They also carry these limits: {'; '.join(lim)}. "
                   "The actual outcome would depend on the evidence produced and on the applicable law in "
                   "force, which this tool does not verify.")
    s5 = "5. Limits of this response\n" + limits_body
    s6 = "6. Notice\n" + SHORT_DISCLAIMER_EN + "\n" + _english_notices(uncertain)
    return "\n\n".join([s1, s2, s3, s4, s5, s6]), limits_body


def compose_answer(question, scope, decision, criteria, locale, translation_uncertain):
    en = locale == "en"
    criteria_used, sources_used, confidence = [], [], None
    d = decision["decision"]
    if d == "answer":
        servable = [c for c in criteria if is_servable(c)]
        seen, uniq = set(), []
        for c in servable:
            if c["id"] not in seen:
                seen.add(c["id"])
                uniq.append(c)
        if not uniq or scope["topic"] is None:
            raise ValueError("answer sin criterios servibles o sin tema")
        answer_text, limits = (_render_answer_en(scope, uniq, translation_uncertain) if en
                               else _render_answer_es(scope, uniq))
        criteria_used = [c["id"] for c in uniq]
        sources_used = [{"criterion_id": c["id"], "judgment_id": c["judgment_id"],
                         "resolution": readable_citation(c)} for c in uniq]
        confidence = _lowest_confidence(uniq)
    elif d == "clarify":
        qs = decision["clarifying_questions"]
        if en:
            qs = [tr_question(q, "en") for q in qs]
            answer_text = ("I cannot analyse the merits yet: essential information is missing to apply the "
                           "corpus criteria. To guide you, I would need you to clarify:\n"
                           + "\n".join(f"   • {q}" for q in qs)
                           + f"\n\n{SHORT_DISCLAIMER_EN}\n{_english_notices(translation_uncertain)}")
            limits = "The merits were not analysed: essential information is missing."
        else:
            answer_text = ("No puedo analizar el fondo todavía: faltan datos esenciales para aplicar los "
                           "criterios del corpus. Para poder orientarle, necesitaría que precise:\n"
                           + "\n".join(f"   • {q}" for q in qs)
                           + f"\n\n{DISCLAIMER_BREVE}")
            limits = "No se ha analizado el fondo: faltan datos esenciales."
    elif d == "out_of_scope":
        if en:
            answer_text = ("This question is not covered by the decisions in the analysed corpus, so I cannot give "
                           "you legal guidance on it. The corpus is limited to trademarks, intellectual property, "
                           "patents and related procedural matters. If your query has any component within those "
                           "areas, you can rephrase it focusing on that. For common, already-validated questions you "
                           "may consult the catalogue of standard questions; for your specific case, turn to a professional.\n\n"
                           + SHORT_DISCLAIMER_EN + "\n" + _english_notices(translation_uncertain))
            limits = "The matter falls outside the analysed corpus."
        else:
            answer_text = ("Esta cuestión no está cubierta por las resoluciones del corpus analizado, por lo que no "
                           "puedo darle una orientación jurídica sobre ella. El corpus se limita a materias de marcas, "
                           "propiedad intelectual, patentes y aspectos procesales relacionados. Si su consulta tiene "
                           "algún componente de esas materias, puede reformularla centrándose en él. Para preguntas "
                           "frecuentes ya validadas, puede consultar el catálogo de preguntas estándar; para su caso "
                           "concreto, dirigirse a un profesional.\n\n"
                           + DISCLAIMER_BREVE)
            limits = "La materia queda fuera del corpus analizado."
    else:  # insufficient_criteria
        if en:
            answer_text = ("There are not enough approved criteria in the knowledge base to guide this query, so I "
                           "prefer not to improvise an answer. You may consult the catalogue of validated standard "
                           "questions or turn to a professional for your specific case.\n\n"
                           + SHORT_DISCLAIMER_EN + "\n" + _english_notices(translation_uncertain))
            limits = "The corpus contains no approved criteria applicable to this query."
        else:
            answer_text = ("No hay criterios aprobados suficientes en la base de conocimiento para orientar esta "
                           "consulta, de modo que prefiero no improvisar una respuesta. Puede consultar el catálogo de "
                           "preguntas estándar validadas o dirigirse a un profesional para su caso concreto.\n\n"
                           + DISCLAIMER_BREVE)
            limits = "El corpus no contiene criterios aprobados aplicables a esta consulta."

    if has_forbidden_language(answer_text):
        raise ValueError("lenguaje vetado en la respuesta compuesta (Regla 10)")

    return {
        "decision": d, "answer_text": answer_text, "criteria_used": criteria_used,
        "sources_used": sources_used, "limits": limits, "confidence_level": confidence,
        "disclaimer": SHORT_DISCLAIMER_EN if en else SHORT_DISCLAIMER,
    }


# ===========================================================================
# 8. runQuery (espejo de engine.ts) — deny-by-default ante cualquier fallo
# ===========================================================================
def run_query(question: str, locale: str, corpus: list, judgment_ids: set) -> dict:
    locale = resolve_locale(locale)
    norm = normalize_query(question, locale)
    scope = {"area": "Fuera de alcance", "topic": None, "subtopics": [], "out_of_scope": False,
             "confidence": "low", "reason": "rechazo seguro"}
    try:
        scope = classify_scope(norm["spanish"])
        missing = detect_missing_facts(norm["spanish"], scope)
        # 1 clic: si el usuario eligió un escenario del corpus, ya dio la
        # información → no se repregunta de nuevo (Reglas 7/17 satisfechas por la
        # elección explícita; la respuesta sigue llevando límites y aviso).
        if missing.get("needs_clarification") and _query_has_scenario(scope, norm["spanish"]):
            missing["needs_clarification"] = False
            if scope.get("confidence") == "low":
                scope["confidence"] = "medium"
        retrieval = retrieve_approved_criteria(scope, corpus, judgment_ids)
        decision = decide(scope, missing, retrieval)
        answer = compose_answer(question, scope, decision, retrieval["criteria"], locale, norm["uncertain"])
        return {"scope": scope, "answer": answer}
    except Exception:
        # Rechazo seguro auditado (insufficient_criteria), nunca una respuesta dudosa.
        decision = {"decision": "insufficient_criteria", "clarifying_questions": []}
        answer = compose_answer(question, scope, decision, [], locale, norm["uncertain"])
        return {"scope": scope, "answer": answer}


# ===========================================================================
# 9. Catálogo (espejo de catalog/service.ts + models/catalogQuestion.ts)
# ===========================================================================
def load_categories() -> dict:
    f = DATA / "catalog" / "categories.json"
    if not f.exists():
        return {"areas": []}
    try:
        raw = json.loads(f.read_text(encoding="utf-8"))
        areas = raw.get("areas", [])
        return {"areas": [{"area": a["area"], "topics": list(a["topics"])}
                          for a in areas if isinstance(a, dict) and "area" in a and isinstance(a.get("topics"), list)]}
    except Exception:
        return {"areas": []}


def load_catalog_questions() -> list:
    d = DATA / "catalog"
    out = []
    if not d.exists():
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".json") or name == "categories.json":
            continue
        try:
            raw = json.loads((d / name).read_text(encoding="utf-8"))
        except Exception:
            continue
        items = raw if isinstance(raw, list) else (raw.get("questions", []) if isinstance(raw, dict) else [])
        if isinstance(items, list):
            out.extend(items)
    return out


def _known_category(area, topic, categories) -> bool:
    a = next((x for x in categories["areas"] if x["area"] == area), None)
    return bool(a and topic in a["topics"])


def _catalog_valid(q, categories) -> bool:
    if not isinstance(q, dict):
        return False
    if not all(_nonempty(q.get(k)) for k in ("id", "area", "topic", "question", "version")):
        return False
    if not _known_category(q["area"], q["topic"], categories):
        return False
    if not isinstance(q.get("approved"), bool):
        return False
    if q["approved"]:
        if not (_nonempty(q.get("short_answer")) and _nonempty(q.get("full_answer"))):
            return False
        if not (isinstance(q.get("related_criteria_ids"), list) and q["related_criteria_ids"]):
            return False
        if not _str_array(q.get("source_references")) or not _str_array(q.get("limits")):
            return False
        if not _iso(q.get("last_reviewed_at")) or not _nonempty(q.get("last_reviewed_by")):
            return False
    return True


def is_fully_servable(q, categories, criteria_by_id, judgment_ids) -> bool:
    if not _catalog_valid(q, categories):
        return False
    if q.get("approved") is not True or not q.get("related_criteria_ids"):
        return False
    if not all(cid in criteria_by_id for cid in q["related_criteria_ids"]):
        return False
    if not q.get("source_references") or not q.get("limits"):
        return False
    # Regla 9: la resolución de cada criterio enlazado debe existir.
    for cid in q["related_criteria_ids"]:
        c = criteria_by_id.get(cid)
        if not c or c["judgment_id"] not in judgment_ids:
            return False
    # Regla 10: sin lenguaje vetado.
    if has_forbidden_language(q.get("short_answer", "")) or has_forbidden_language(q.get("full_answer", "")):
        return False
    return True


def _citations_from_metadata(q, criteria_by_id) -> list:
    out = []
    for cid in q["related_criteria_ids"]:
        c = criteria_by_id.get(cid)
        out.append(readable_citation(c) if c else f"(criterio {cid} no disponible)")
    return out


def _to_served(q, criteria_by_id, locale) -> dict:
    return {
        "id": q["id"], "area": q["area"], "topic": q["topic"], "question": q["question"],
        "short_answer": q["short_answer"], "full_answer": q["full_answer"],
        "related_criteria_ids": q["related_criteria_ids"],
        "source_references": _citations_from_metadata(q, criteria_by_id),
        "limits": q["limits"], "version": q["version"], "last_reviewed_at": q.get("last_reviewed_at"),
        "disclaimer": SHORT_DISCLAIMER_EN if locale == "en" else SHORT_DISCLAIMER,
    }


def _approved_criteria_by_id() -> dict:
    return {c["id"]: c for c in load_approved_criteria() if is_servable(c)}


def catalog_tree() -> dict:
    cats = load_categories()
    cbi = _approved_criteria_by_id()
    jids = load_judgment_ids()
    servable = [q for q in load_catalog_questions() if is_fully_servable(q, cats, cbi, jids)]
    return {"areas": [{"area": a["area"], "topics": [
        {"topic": t, "approved_count": sum(1 for q in servable if q["area"] == a["area"] and q["topic"] == t)}
        for t in a["topics"]]} for a in cats["areas"]]}


def catalog_list(area, topic, locale) -> list:
    cats = load_categories()
    cbi = _approved_criteria_by_id()
    jids = load_judgment_ids()
    return [_to_served(q, cbi, locale) for q in load_catalog_questions()
            if is_fully_servable(q, cats, cbi, jids) and q["area"] == area and q["topic"] == topic]


def catalog_get(qid, locale):
    cats = load_categories()
    cbi = _approved_criteria_by_id()
    jids = load_judgment_ids()
    q = next((x for x in load_catalog_questions() if x.get("id") == qid), None)
    if not q or not is_fully_servable(q, cats, cbi, jids):
        return None
    return _to_served(q, cbi, locale)


# ===========================================================================
# 9b. Subida de archivos + extracción de hechos (espejo de extraction/
#     uploads/ caseFactsExtractor). Solo case_material; nunca crea criterios.
# ===========================================================================
FILE_TYPES = ["pdf", "docx", "txt", "png", "jpg", "jpeg"]
FRAGMENT_SIZE = 1200


def _deaccent_lower(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                   if unicodedata.category(c) != "Mn")


def file_type_from_name(filename):
    m = re.search(r"\.([a-z0-9]+)$", (filename or "").strip(), re.IGNORECASE)
    ext = m.group(1).lower() if m else ""
    return ext if ext in FILE_TYPES else None


def chunk_text(text, prefix="frag"):
    out, i, n = [], 0, 0
    while i < len(text):
        end = min(i + FRAGMENT_SIZE, len(text)); n += 1
        out.append({"fragment_id": f"{prefix}-{n:03d}", "page": None, "section": None,
                    "char_start": i, "char_end": end}); i = end
    if not out:
        out.append({"fragment_id": f"{prefix}-001", "page": None, "section": None, "char_start": 0, "char_end": 0})
    return out


# --- Extracción LOCAL de PDF/DOCX con biblioteca estándar (sin red, sin inventar) ---
def _b64_to_bytes(s):
    import base64 as _b64
    try:
        return _b64.b64decode((s or "") + "===")
    except Exception:
        return b""


def _pdf_decode_string(b):
    out = bytearray()
    i = 0
    esc = {0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c}
    while i < len(b):
        c = b[i]
        if c == 0x5c and i + 1 < len(b):
            nxt = b[i + 1]
            if nxt in esc:
                out.append(esc[nxt]); i += 2; continue
            if 0x30 <= nxt <= 0x37:  # octal \ddd
                j = i + 1; o = b""
                while j < len(b) and len(o) < 3 and 0x30 <= b[j] <= 0x37:
                    o += bytes([b[j]]); j += 1
                out.append(int(o, 8) & 0xFF); i = j; continue
            out.append(nxt); i += 2; continue
        out.append(c); i += 1
    return bytes(out)


def _pdf_text(data):
    """Extractor de texto de PDF con stdlib: localiza los streams con un escaneo
    find() (nivel C, NO se cuelga aunque el PDF pese 20 MB), descomprime los
    FlateDecode y lee los operadores de texto Tj/TJ. Los PDF ESCANEADOS (imagen,
    sin operadores de texto) => devuelve cadena vacía."""
    import zlib
    parts = []
    pos, count = 0, 0
    while True:
        s = data.find(b"stream", pos)
        if s < 0:
            break
        e = data.find(b"endstream", s)
        if e < 0:
            break
        raw = data[s + 6:e]
        if raw[:2] == b"\r\n":
            raw = raw[2:]
        elif raw[:1] in (b"\n", b"\r"):
            raw = raw[1:]
        pos = e + 9
        count += 1
        if count > 8000:  # backstop ante PDFs patológicos
            break
        try:
            content = zlib.decompress(raw)  # stream de texto (FlateDecode)
        except Exception:
            content = raw  # sin comprimir o imagen (DCTDecode/binario)
            # NUNCA correr la regex de texto sobre binario/imagen grande: evita
            # backtracking catastrófico si un JPEG contiene "Tj" por azar.
            if len(content) > 200000 or b"BT" not in content:
                continue
        if b"Tj" not in content and b"TJ" not in content:
            continue
        for tm in re.finditer(rb"\(((?:\\.|[^\\()])*)\)\s*Tj", content, re.DOTALL):
            parts.append(_pdf_decode_string(tm.group(1)).decode("latin-1", "replace"))
        for tm in re.finditer(rb"\[(.*?)\]\s*TJ", content, re.DOTALL):
            for sm in re.finditer(rb"\(((?:\\.|[^\\()])*)\)", tm.group(1), re.DOTALL):
                parts.append(_pdf_decode_string(sm.group(1)).decode("latin-1", "replace"))
            parts.append(" ")
        parts.append("\n")
    return "".join(parts)


def _docx_text(data):
    """DOCX es un ZIP; extrae word/document.xml y quita las etiquetas (stdlib)."""
    import io
    import zipfile
    import html
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
    except Exception:
        return ""
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    return html.unescape(xml)


def _ocr_available():
    import shutil
    return bool(shutil.which("pdftoppm") and shutil.which("tesseract"))


def _ocr_image_available():
    import shutil
    return bool(shutil.which("tesseract"))


def _ocr_pdf(data, max_pages=40):
    """OCR LOCAL de un PDF escaneado: poppler (pdftoppm) rasteriza cada página y
    tesseract la reconoce. 100% local (sin red, Regla 2); solo se usa si AMBAS
    herramientas están instaladas; nunca inventa contenido (Regla 4)."""
    import subprocess
    import tempfile
    import glob as _glob
    text_parts, locs, warnings, char = [], [], [], 0
    with tempfile.TemporaryDirectory() as td:
        pdf_path = os.path.join(td, "in.pdf")
        with open(pdf_path, "wb") as fh:
            fh.write(data)
        try:
            subprocess.run(["pdftoppm", "-png", "-r", "200", "-l", str(max_pages), pdf_path, os.path.join(td, "pg")],
                           check=True, timeout=900, capture_output=True)
        except Exception:
            return {"text": "", "warnings": ["No se pudo rasterizar el PDF (pdftoppm)."], "source_locations": []}
        pngs = sorted(_glob.glob(os.path.join(td, "pg-*.png")))
        if not pngs:
            return {"text": "", "warnings": ["El PDF no produjo páginas para OCR."], "source_locations": []}
        if len(pngs) >= max_pages:
            warnings.append(f"OCR limitado a las primeras {max_pages} páginas (documento grande).")
        for i, png in enumerate(pngs, 1):
            try:
                r = subprocess.run(["tesseract", png, "stdout", "-l", "spa+eng"], capture_output=True, timeout=180)
                pg = r.stdout.decode("utf-8", "replace")
            except Exception:
                pg = ""
            if pg.strip():
                start = char
                text_parts.append(pg)
                char += len(pg) + 1
                locs.append({"fragment_id": f"p{i}", "page": i, "section": None, "char_start": start, "char_end": char})
    return {"text": "\n".join(text_parts), "warnings": warnings, "source_locations": locs}


def _ocr_image(data, ext):
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "img." + ext)
        with open(p, "wb") as fh:
            fh.write(data)
        try:
            r = subprocess.run(["tesseract", p, "stdout", "-l", "spa+eng"], capture_output=True, timeout=120)
            return r.stdout.decode("utf-8", "replace")
        except Exception:
            return ""


def _vision_bin():
    """Ruta al motor OCR nativo de macOS (Vision/PDFKit), compilado en ~/.local/bin.
    100% LOCAL/offline (Regla 2). Devuelve la ruta o None si no está."""
    import shutil
    p = shutil.which("lla_ocr")
    if p:
        return p
    cand = os.path.expanduser("~/.local/bin/lla_ocr")
    return cand if os.path.exists(cand) else None


def _vision_available():
    return _vision_bin() is not None


def _vision_extract(data, ext, max_pages=80):
    """Extracción nativa de macOS: capa de texto del PDF (PDFKit) + OCR de páginas
    escaneadas (Vision), en español+inglés. Solo emite lo reconocido (Regla 4).
    Devuelve un dict de _extraction o None si falla / no hay binario."""
    import subprocess
    import tempfile
    binp = _vision_bin()
    if not binp:
        return None
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "in." + ext)
        with open(p, "wb") as fh:
            fh.write(data)
        try:
            r = subprocess.run([binp, p, "--max-pages", str(max_pages), "--langs", "es-ES,en-US"],
                               capture_output=True, timeout=1200)
            out = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
        except Exception:
            return None
    if out.get("error") or not (out.get("text") or "").strip():
        return None
    pages = out.get("pages", [])
    text = re.sub(r"[ \t]+", " ", out.get("text", "")).strip()
    page_texts, locs, char = [], [], 0
    for pg in pages:
        t = (pg.get("text") or "").strip()
        if not t:
            continue
        page_texts.append(t)
        start = char
        char += len(t) + 2
        locs.append({"fragment_id": f"p{pg.get('page')}", "page": pg.get("page"),
                     "section": None, "char_start": start, "char_end": char})
    method = out.get("extraction_method") or "ocr"
    conf = out.get("confidence") or ("high" if method == "native_text" else "medium")
    warnings = []
    if out.get("page_count", 0) > out.get("processed_pages", 0):
        warnings.append(f"OCR limitado a las primeras {out.get('processed_pages')} de "
                        f"{out.get('page_count')} páginas (documento grande).")
    res = {"status": "completed", "text": text, "warnings": warnings,
           "source_locations": locs or chunk_text(text),
           "extraction_method": method,
           "page_texts": page_texts or ([text] if text else []),
           "confidence": conf}
    return res


def _extraction(status, text, warnings, source_locations, method, confidence):
    """Empaqueta una salida de extracción con los campos de honestidad sobre el origen
    (extraction_method / page_texts / confidence — Regla 4)."""
    return {"status": status, "text": text, "warnings": warnings,
            "source_locations": source_locations,
            "extraction_method": method,
            "page_texts": ([text] if (text or "").strip() else []),
            "confidence": confidence}


def extract_text(file_type, filename, text=None, base64=None):
    if file_type == "txt":
        t = (text or "").replace("\r\n", "\n"); empty = t.strip() == ""
        return _extraction("failed" if empty else "completed", t,
                           (["El archivo de texto está vacío o no contiene texto legible."] if empty else []),
                           chunk_text(t),
                           "manual_description_needed" if empty else "native_text",
                           "low" if empty else "high")
    if file_type == "pdf":
        data = _b64_to_bytes(base64)
        txt = re.sub(r"[ \t]+", " ", _pdf_text(data)).strip() if data else ""
        if sum(ch.isalpha() for ch in txt) >= 40:  # capa de texto legible
            return _extraction("completed", txt, [], chunk_text(txt), "native_text", "high")
        # PDF escaneado (sin capa de texto) → OCR LOCAL. Preferimos el motor NATIVO de
        # macOS (Vision/PDFKit), que además detecta páginas con texto (native_plus_ocr).
        if data and _vision_available():
            v = _vision_extract(data, "pdf")
            if v:
                return v
        # Fallback: poppler (pdftoppm) + tesseract, si están instalados.
        if data and _ocr_available():
            o = _ocr_pdf(data)
            if sum(ch.isalpha() for ch in o["text"]) >= 40:
                otext = re.sub(r"[ \t]+", " ", o["text"]).strip()
                return _extraction("completed", otext, o["warnings"],
                                   o["source_locations"] or chunk_text(otext), "ocr", "medium")
        return _extraction("failed", "",
                           ["Es un PDF ESCANEADO (imagen, sin capa de texto) y no hay motor OCR disponible. "
                            "Extrae el texto con Vista Previa de macOS (Live Text) y pégalo en el recuadro de abajo. "
                            "No se inventa contenido (Regla 4)."],
                           [], "manual_description_needed", "low")
    if file_type == "docx":
        data = _b64_to_bytes(base64)
        txt = (_docx_text(data) or "").strip() if data else ""
        if sum(ch.isalpha() for ch in txt) >= 5:
            return _extraction("completed", txt, [], chunk_text(txt), "native_text", "high")
        return _extraction("failed", "",
                           ["No se pudo extraer texto de este DOCX. Pega el texto del documento en el recuadro de abajo."],
                           [], "manual_description_needed", "low")
    if file_type in ("png", "jpg", "jpeg"):
        data = _b64_to_bytes(base64)
        # Motor NATIVO de macOS (Vision) primero; tesseract como fallback.
        if data and _vision_available():
            v = _vision_extract(data, file_type)
            if v:
                return v
        if data and _ocr_image_available():
            t = (_ocr_image(data, file_type) or "").strip()
            if sum(ch.isalpha() for ch in t) >= 20:
                return _extraction("completed", re.sub(r"[ \t]+", " ", t), [], chunk_text(t), "ocr", "medium")
        return _extraction("failed", "",
                           ["No puedo leer la imagen sin OCR y no invento contenido visual (Regla 4). No hay motor OCR "
                            "disponible; describe la imagen o pega abajo el texto que muestra."],
                           [], "manual_description_needed", "low")
    return _extraction("failed", "", [f"Tipo de archivo no soportado: {file_type}"], [],
                       "manual_description_needed", "low")


def get_checklist(area, topic):
    for c in CHECKLISTS["checklists"]:
        if c["area"] == area and c["topic"] == topic:
            return c["essential_facts"]
    return []


def _locate(signals, src):
    if src["id"] == "user-input":
        return "consulta del usuario"
    if not src["locs"]:
        return "documento completo"
    hay = _deaccent_lower(src["text"]); idx = -1
    for s in signals:
        parts = s.replace("*", "").split()
        needle = _deaccent_lower(parts[0]) if parts else ""
        if not needle:
            continue
        at = hay.find(needle)
        if at >= 0 and (idx < 0 or at < idx):
            idx = at
    if idx < 0:
        return "documento completo"
    for l in src["locs"]:
        if l["char_start"] is not None and l["char_end"] is not None and l["char_start"] <= idx < l["char_end"]:
            if l["page"] is not None:
                return f"página {l['page']}"
            if l["section"] is not None:
                return f'sección "{l["section"]}"'
            return f"fragmento {l['fragment_id']}"
    return "documento completo"


def extract_case_facts(question, files):
    all_files = files or []
    files = [f for f in all_files if f.get("upload_type") == "case_material"]
    dropped = len(all_files) - len(files)
    warnings, uncertainties = [], []
    if dropped > 0:  # separación: lo que no es material del caso no se procesa aquí
        warnings.append(f"Se ignoraron {dropped} archivo(s) que no son material del caso.")
    for f in files:
        for w in f.get("warnings", []):
            warnings.append(f"[{f['original_filename']}] {w}")
        if f.get("extraction_status") != "completed":
            uncertainties.append(f"No se pudo leer con fiabilidad \"{f['original_filename']}\" "
                                 f"(estado: {f.get('extraction_status')}).")
    readable = [f for f in files if f.get("extraction_status") == "completed"]
    combined = "\n".join([question or ""] + [f.get("extracted_text", "") for f in readable])
    scope = classify_scope(combined)
    possible = [] if scope["out_of_scope"] else [f"{scope['area']} / {scope['topic'] or '(tema no determinado)'}"]
    sources = [{"id": "user-input", "filename": "consulta del usuario", "text": question or "", "locs": []}] + [
        {"id": f["id"], "filename": f["original_filename"], "text": f.get("extracted_text", ""),
         "locs": f.get("source_locations", [])} for f in readable]
    relevant, missing, seq = [], [], 0
    checklist = get_checklist(scope["area"], scope["topic"]) if (not scope["out_of_scope"] and scope["topic"]) else []
    for fact in checklist:
        found = False
        for src in sources:
            tokens = normalize(src["text"])
            matched = [s for s in fact["signals"] if matches_any_keyword([s], tokens)]
            if not matched:
                continue
            found = True; seq += 1
            relevant.append({"fact_id": f"fact-{seq:03d}", "fact_text": fact["fact"],
                             "source_type": "user_description" if src["id"] == "user-input" else "uploaded_document",
                             "source_document_id": src["id"], "source_filename": src["filename"],
                             "page_or_location": _locate(matched, src),
                             "confidence": "medium" if len(matched) >= 2 else "low"})
        if not found:
            missing.append(fact["question"])
    tk = normalize("\n".join(s["text"] for s in sources))
    if matches_any_keyword(["registrad*", "registro"], tk) and matches_any_keyword(["sin registrar"], tk):
        uncertainties.append("Posible contradicción sobre el registro: aparecen indicios de 'registrada' y de 'sin registrar'.")
    evidence = [{"document_id": f["id"], "filename": f["original_filename"], "file_type": f["file_type"],
                 "extraction_status": f["extraction_status"]} for f in files]
    if scope["out_of_scope"]:
        summary = (f"Los materiales aportados ({len(files)} documento/s) no encajan en una materia cubierta por "
                   "el corpus, por lo que no se preparan hechos jurídicos. Esto no es una valoración del caso.")
    else:
        summary = (f"Materia probable: {possible[0]}. {len(files)} documento/s aportado/s; {len(relevant)} indicio/s "
                   f"de hecho detectado/s y {len(missing)} dato/s esencial/es pendiente/s. Es preparación factual "
                   "para comparar con criterios aprobados; no anticipa ningún resultado.")
    classified_area = None if scope["out_of_scope"] else scope["area"]
    classified_topic = scope["topic"]
    if has_forbidden_language(summary):
        return {"case_summary": "Resumen no disponible por una comprobación de seguridad (deny-by-default).",
                "classified_area": classified_area, "classified_topic": classified_topic,
                "relevant_facts": [], "missing_facts": missing, "evidence_items": evidence,
                "possible_topics": possible, "uncertainties": uncertainties, "extraction_warnings": warnings}
    return {"case_summary": summary, "classified_area": classified_area, "classified_topic": classified_topic,
            "relevant_facts": relevant, "missing_facts": missing,
            "evidence_items": evidence, "possible_topics": possible, "uncertainties": uncertainties,
            "extraction_warnings": warnings}


# ===========================================================================
# 9c. Scoreboard de alineación con criterios (espejo de caseScoreboard).
#     NUNCA "probabilidad de ganar": mide alineación de hechos con criterios.
# ===========================================================================
SCOREBOARD_EXTRA = [
    r"\bprobabilidad(?:es)?\s+de\s+(?:ganar|[ée]xito|victoria)\b",
    r"\bprobabilidad(?:es)?\s+de\s+[ée]xito\b",
    r"\b\d+\s*%\s*(?:de\s+)?(?:ganar|[ée]xito|exito|victoria|probabilidad)",
    r"\bperder[íi]as?\b",
    r"\bvas?\s+a\s+perder\b",
    r"\b[ée]xito\s+(?:garantizado|asegurado|seguro)\b",
]
LIMIT_ES = ("Este score NO predice el resultado de un procedimiento. Solo mide la alineación entre los "
            "hechos aportados y los criterios aprobados disponibles en el corpus. Es una herramienta "
            "orientativa basada en un corpus cerrado y no constituye asesoramiento jurídico.")
LIMIT_EN = ("This score does NOT predict the outcome of any proceeding. It only measures the alignment "
            "between the facts provided and the approved criteria available in the corpus. It is an "
            "informational tool based on a closed corpus and does not constitute legal advice.")


def has_scoreboard_forbidden(text):
    alt = _deaccent_text(text)
    return has_forbidden_language(text) or any(
        re.search(p, text, re.IGNORECASE) or re.search(p, alt, re.IGNORECASE) for p in SCOREBOARD_EXTRA)


def compute_scoreboard(scope, facts, retrieval, locale="es"):
    en = locale == "en"
    limit = LIMIT_EN if en else LIMIT_ES
    disc = SHORT_DISCLAIMER_EN if en else SHORT_DISCLAIMER
    criteria = retrieval["criteria"]
    base = {"computable": False, "case_fit_score": None, "score_label": "insuficiente",
            "confidence_level": "bajo", "favorable_factors": [], "unfavorable_factors": [],
            "uncertain_factors": [], "missing_facts": facts["missing_facts"], "criteria_used": [],
            "evidence_used": [f"{e['filename']} ({e['extraction_status']})" for e in facts["evidence_items"]],
            "limits": [limit], "next_information_needed": facts["missing_facts"], "reason": None,
            "disclaimer": disc}
    if retrieval["insufficient_criteria"] or not criteria:
        return {**base, "reason": "No hay criterios aprobados suficientes en el corpus para esta materia; el score no se calcula."}
    if scope["out_of_scope"] or not scope["topic"]:
        return {**base, "reason": "La consulta está fuera del alcance del corpus o sin tema determinado; el score no se calcula."}
    present, missing = facts["relevant_facts"], facts["missing_facts"]
    total = len(present) + len(missing)
    coverage = len(present) / total if total else 0
    contradictions = [u for u in facts["uncertainties"] if re.search("contradicc", u, re.IGNORECASE)]
    illegible = (any(re.search("no se pudo leer|ilegible", u, re.IGNORECASE) for u in facts["uncertainties"])
                 or any(re.search("no configurado|ilegible|vac[íi]o", w, re.IGNORECASE) for w in facts["extraction_warnings"]))
    score = max(0, min(100, round(coverage * 100) - 10 * len(contradictions)))
    favorable = [{"factor": f"Hecho presente alineado con un criterio del corpus: {rf['fact_text']}",
                  "criterion_id": criteria[i % len(criteria)]["id"],
                  "source_reference": criteria[i % len(criteria)]["source_reference"],
                  "judgment_id": criteria[i % len(criteria)]["judgment_id"],
                  "resolution": readable_citation(criteria[i % len(criteria)]),
                  "evidence": f"{rf['source_filename']} ({rf['page_or_location']})"} for i, rf in enumerate(present)]
    unfavorable = []
    for c in criteria:
        for dn in c["does_not_answer"]:
            unfavorable.append({"factor": f"El corpus no resuelve este punto: {dn}", "criterion_id": c["id"],
                                "source_reference": c["source_reference"], "judgment_id": c["judgment_id"],
                                "resolution": readable_citation(c), "evidence": "—"})
    uncertain = [{"factor": u, "why_it_matters": "Un dato ambiguo o contradictorio afecta a la alineación con los criterios del corpus.",
                  "what_is_missing": "Una aclaración o un documento legible que confirme el dato."} for u in facts["uncertainties"]]
    conf = "alto"
    if illegible or contradictions:
        conf = "bajo"
    elif not facts["evidence_items"]:
        conf = "medio"
    if total and len(missing) / total > 0.5:
        label = "insuficiente"
    else:
        label = "alto" if score >= 70 else ("medio" if score >= 40 else "bajo")
        if missing and label == "alto":
            label = "medio"
    limits = [limit] + list(dict.fromkeys([x for c in criteria for x in c["limits"]]))
    result = {"computable": True, "case_fit_score": score, "score_label": label, "confidence_level": conf,
              "favorable_factors": favorable, "unfavorable_factors": unfavorable, "uncertain_factors": uncertain,
              "missing_facts": missing,
              "criteria_used": [{"criterion_id": c["id"], "source_reference": c["source_reference"], "judgment_id": c["judgment_id"], "resolution": readable_citation(c)} for c in criteria],
              "evidence_used": base["evidence_used"] or ["consulta del usuario"],
              "limits": limits, "next_information_needed": missing, "reason": None, "disclaimer": disc}
    alltext = " ".join([f["factor"] for f in favorable] + [f["factor"] for f in unfavorable]
                       + [f"{f['factor']} {f['why_it_matters']} {f['what_is_missing']}" for f in uncertain] + limits)
    if has_scoreboard_forbidden(alltext):
        return {**base, "reason": "El contenido no superó la comprobación de seguridad (Regla 18)."}
    return result


def run_scoreboard(question, files, corpus, judgment_ids, locale="es"):
    norm = normalize_query(question, locale)
    scope = classify_scope(norm["spanish"])
    facts = extract_case_facts(norm["spanish"], files)
    retrieval = retrieve_approved_criteria(scope, corpus, judgment_ids)
    return compute_scoreboard(scope, facts, retrieval, locale)


# --- Evaluador de Caso (Case Fit Grade): calificación A-D sobre la alineación ---
EVAL_LIMIT = ("Esta calificación no predice el resultado de un procedimiento y no constituye asesoramiento "
              "jurídico. Solo mide la alineación entre los hechos aportados y los criterios aprobados "
              "disponibles en el corpus cerrado.")
PREDICTION_REQUEST = [
    r"\b(?:voy|vas?|vamos|van)\s+a\s+(?:ganar|perder|vencer|prosperar|triunfar)\b",
    r"\bprobabilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b",
    r"\bposibilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b",
    r"\b(?:tengo|hay|tienes?|tenemos)\s+(?:buenas?\s+|muchas?\s+|pocas?\s+|algunas?\s+)?(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+de\s+(?:ganar|[ée]xito|vencer|prosperar)\b",
    r"\bqu[ée]\s+(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?)\s+(?:tengo|hay|tienes?)",
    r"\b(?:gano|gane|ganes|ganemos|ganen|ganar[ée]|ganar[áa]s?|ganar[áa]n|ganaremos|ganar[íi]a(?:s|mos|n)?|pierdo|pierdes|perder[ée]|perder[áa]s?|perder[íi]a|venzo|venza|vencer[ée]|vencer[áa]s?)\s+(?:el\s+|mi\s+|la\s+|este\s+|ese\s+)?(?:juicio|caso|pleito|litigio|demanda|recurso|asunto)\b",
    r"\b(?:podr[íi]a?s?|podremos|podr[áa]n?)\s+(?:usted\s+)?(?:ganar|vencer|prosperar|tener\s+[ée]xito)\b",
    r"\b(?:gana|perde|vence|prospera|triunfa)r(?:[ée]|[áa]s?|[áa]n|emos|[íi]as?|[íi]amos|[íi]an)\b",
    r"\bes\s+probable\s+que\s+(?:\w+\s+){0,2}(?:gan|venz|prosper|triunf)",
    r"\b(?:me\s+conviene|debo|deber[íi]a|me\s+recomiendas?)\s+(?:demandar|reclamar|denunciar|querellar|recurrir|interponer)",
    r"\b(?:cu[áa]les?\s+son\s+)?(?:mis\s+)?(?:perspectivas|expectativas)\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|triunfo|del?\s+caso|del?\s+pleito)",
]


def asks_for_prediction(text):
    alt = _deaccent_text(text or "")
    return any(re.search(p, text or "", re.IGNORECASE) or re.search(p, alt, re.IGNORECASE) for p in PREDICTION_REQUEST)


def run_case_evaluation(description, asunto_hint, files, corpus, judgment_ids, locale="es"):
    asunto = asunto_hint or "No estoy seguro"

    def not_graded(reason, facts, area, topic):
        return {"decision": "cannot_evaluate_case",
                "case_fit_score": None, "case_fit_grade": "insuficiente",
                "score_label": "información insuficiente", "confidence_level": "baja",
                "case_summary": facts["case_summary"] if facts else "", "classified_area": area,
                "classified_topic": topic, "asunto_hint": asunto, "favorable_factors": [],
                "unfavorable_factors": [], "uncertain_factors": [],
                "missing_facts": facts["missing_facts"] if facts else [], "criteria_used": [],
                "evidence_used": [f"{e['filename']} ({e['extraction_status']})" for e in facts["evidence_items"]] if facts else [],
                "limits": [EVAL_LIMIT], "next_information_needed": facts["missing_facts"] if facts else [],
                "reason": reason, "disclaimer": SHORT_DISCLAIMER}

    # asunto_hint es texto libre no confiable: se inspecciona igual que la descripción (Regla 18).
    if asks_for_prediction(description) or asks_for_prediction(asunto):
        return not_graded("Has pedido una predicción de resultado. Esta herramienta no predice quién gana ni el "
                          "resultado de un litigio; solo mide la alineación de los hechos con los criterios aprobados. "
                          "Reformula describiendo únicamente los hechos del caso.", None, None, None)
    norm = normalize_query(description, locale)
    scope = classify_scope(norm["spanish"])
    facts = extract_case_facts(norm["spanish"], files)
    retrieval = retrieve_approved_criteria(scope, corpus, judgment_ids)
    sb = compute_scoreboard(scope, facts, retrieval, locale)
    if not sb["computable"]:
        return not_graded(sb["reason"] or "No se puede calificar.", facts,
                          (None if scope["out_of_scope"] else scope["area"]), scope["topic"])

    score = sb["case_fit_score"]
    missing_n = len(facts["missing_facts"])
    if score >= 80 and missing_n == 0:
        grade, label = "A", "alta alineación"
    elif score >= 60:
        grade, label = "B", "alineación media"
    elif score >= 40:
        grade, label = "C", "alineación media"
    else:
        grade, label = "D", "baja alineación"
    conf_map = {"bajo": "baja", "medio": "media", "alto": "alta"}
    favorable = [dict(f, explicacion="El hecho aportado coincide con una condición que el criterio del corpus considera "
                      "relevante para el análisis (no implica un resultado).") for f in sb["favorable_factors"]]
    unfavorable = [dict(f, explicacion="Es una cuestión que el corpus aprobado NO resuelve, lo que limita la alineación; "
                        "no implica un resultado adverso.") for f in sb["unfavorable_factors"]]
    uncertain = [dict(u, documents=[e["filename"] for e in facts["evidence_items"]]) for u in sb["uncertain_factors"]]
    result = {"decision": "evaluate_case",
              "case_fit_score": score, "case_fit_grade": grade, "score_label": label,
              "confidence_level": conf_map.get(sb["confidence_level"], "baja"), "case_summary": facts["case_summary"],
              "classified_area": scope["area"], "classified_topic": scope["topic"], "asunto_hint": asunto,
              "favorable_factors": favorable, "unfavorable_factors": unfavorable, "uncertain_factors": uncertain,
              "missing_facts": facts["missing_facts"], "criteria_used": sb["criteria_used"],
              "evidence_used": sb["evidence_used"], "limits": [EVAL_LIMIT] + sb["limits"][1:],
              "next_information_needed": facts["missing_facts"], "reason": None, "disclaimer": SHORT_DISCLAIMER}
    alltext = " ".join([f["factor"] + " " + f["explicacion"] for f in favorable + unfavorable] + result["limits"] + [asunto])
    if has_scoreboard_forbidden(alltext):
        return not_graded("El contenido no superó la comprobación de seguridad (Regla 18).", facts, scope["area"], scope["topic"])
    return result


def log_event(etype, actor, produced_ids, detail):
    """Traza ligera (Regla 16) en data/audit/ingestion_events.jsonl. Best-effort."""
    try:
        d = DATA / "audit"
        d.mkdir(parents=True, exist_ok=True)
        rec = {"id": f"evt-{uuid.uuid4()}", "type": etype, "at": _now(), "actor": actor or "anon",
               "file_id": None, "file_type": None, "upload_type": None, "extraction_status": None,
               "warnings": [], "produced_ids": produced_ids, "detail": detail}
        with open(d / "ingestion_events.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def load_case_materials(session_id, case_id=None):
    d = DATA / "case_materials"
    legacy = DATA / "uploads" / "case_materials"  # ubicación anterior (compatibilidad de lectura)
    out = []
    if not session_id:
        return out
    if not d.exists() and legacy.exists():
        d = legacy
    if not d.exists():
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".json"):
            continue
        try:
            f = json.loads((d / name).read_text(encoding="utf-8"))
        except Exception:
            continue
        if f.get("session_id") == session_id and f.get("upload_type") == "case_material":
            if case_id is None or f.get("case_id") == case_id:
                out.append(f)
    return out


# ===========================================================================
# 9d. PANEL DE INGESTA (interno): registrar sentencias → criterios pending →
#     aprobación humana. Hace crecer el corpus (Reglas 13-15). Escribe en data/.
# ===========================================================================
def _slug(s):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", (s or "").lower()))


def _admin_reload():
    global CORPUS, JUDGMENT_IDS
    CORPUS = load_approved_criteria()
    JUDGMENT_IDS = load_judgment_ids()


def _as_lines(v):
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return [x.strip() for x in str(v or "").split("\n") if x.strip()]


def admin_register_judgment(b):
    jid = (b.get("id") or "").strip() or ("jdg-" + _slug(b.get("resolution_number") or b.get("title") or str(uuid.uuid4())))[:60]
    area = b.get("legal_area") if b.get("legal_area") in ("marcas", "propiedad_intelectual", "patentes", "procesal") else "marcas"
    topics = b.get("topics") if isinstance(b.get("topics"), list) else [t.strip() for t in str(b.get("topics", "")).split(",") if t.strip()]
    now = _now()
    src_text, warnings = (b.get("text") or ""), []
    if b.get("file_type") and b.get("base64"):
        ex = extract_text(b["file_type"], b.get("filename", "doc"), base64=b.get("base64"))
        src_text = ex["text"] or src_text
        warnings = ex["warnings"]
    judgment = {"id": jid, "title": b.get("title") or jid, "court": b.get("court") or "",
                "date": b.get("date") or "", "resolution_number": b.get("resolution_number") or "",
                "jurisdiction": b.get("jurisdiction") or "", "legal_area": area, "topics": topics,
                "original_language": "es", "file_path": "data/source_judgments/" + (b.get("filename") or (jid + ".txt")),
                "summary_internal": (src_text[:500] or "Registrado desde el panel."), "created_at": now, "updated_at": now}
    d = DATA / "source_judgments"; d.mkdir(parents=True, exist_ok=True)
    (d / (jid + ".judgment.json")).write_text(json.dumps({"judgments": [judgment]}, ensure_ascii=False, indent=2), encoding="utf-8")
    if src_text:
        cd = DATA / "uploads" / "corpus_documents"; cd.mkdir(parents=True, exist_ok=True)
        (cd / (jid + ".source.txt")).write_text(src_text, encoding="utf-8")
    log_event("upload", b.get("by", "admin"), [jid], "Resolución registrada: " + jid)
    _admin_reload()
    return {"ok": True, "judgment_id": jid, "source_text": src_text[:12000], "warnings": warnings}


def admin_add_criterion(b):
    jid = (b.get("judgment_id") or "").strip()
    if jid not in JUDGMENT_IDS:
        return {"ok": False, "errors": ['La resolución "%s" no está registrada; regístrela primero.' % jid]}
    existing = set([c["id"] for c in _load_collection(DATA / "processed_criteria", "criteria")] + [c["id"] for c in CORPUS])
    n = 1
    while ("crit-%s-%03d" % (_slug(jid), n)) in existing:
        n += 1
    cid = "crit-%s-%03d" % (_slug(jid), n)
    now = _now()
    c = {"id": cid, "judgment_id": jid,
         "area": b.get("area") if b.get("area") in ("marcas", "propiedad_intelectual", "patentes", "procesal") else "marcas",
         "topic": (b.get("topic") or "").strip(), "subtopic": ((b.get("subtopic") or "").strip() or None),
         "criterion_text": (b.get("criterion_text") or "").strip(),
         "conditions_for_application": _as_lines(b.get("conditions_for_application")),
         "does_not_answer": _as_lines(b.get("does_not_answer")), "limits": _as_lines(b.get("limits")),
         "source_excerpt": (b.get("source_excerpt") or "").strip(), "source_reference": (b.get("source_reference") or "").strip(),
         "confidence_level": b.get("confidence_level") if b.get("confidence_level") in ("high", "medium", "low") else "low",
         "review_status": "pending_review", "approved": False, "approved_by": None, "approved_at": None,
         "created_at": now, "updated_at": now}
    if not validate_legal_criterion(c):
        return {"ok": False, "errors": ["Faltan campos o son inválidos: criterion_text, source_excerpt, source_reference y las listas (conditions/does_not_answer/limits) sin líneas vacías ni duplicadas."]}
    d = DATA / "processed_criteria"; d.mkdir(parents=True, exist_ok=True)
    (d / (cid + ".json")).write_text(json.dumps({"criteria": [c]}, ensure_ascii=False, indent=2), encoding="utf-8")
    log_event("criteria_extracted", b.get("by", "admin"), [cid], "Criterio candidato (pending) para " + jid)
    return {"ok": True, "id": cid}


def _admin_missing(c):
    m = []
    if c.get("judgment_id") not in JUDGMENT_IDS:
        m.append("resolución registrada")
    for k in ("criterion_text", "source_reference", "source_excerpt", "topic"):
        if not (isinstance(c.get(k), str) and c[k].strip()):
            m.append(k)
    if not (isinstance(c.get("limits"), list) and any(isinstance(x, str) and x.strip() for x in c["limits"])):
        m.append("limits")
    txt = " ".join([c.get("criterion_text", "")] + c.get("conditions_for_application", []) + c.get("does_not_answer", []) + c.get("limits", []))
    if has_forbidden_language(txt):
        m.append("lenguaje vetado (Regla 18)")
    return m


def admin_pending():
    out = []
    for c in _load_collection(DATA / "processed_criteria", "criteria"):
        if c.get("review_status") == "pending_review":
            out.append({"criterion": c, "missing_for_approval": _admin_missing(c)})
    return out


def admin_corpus_summary():
    by = {}
    for c in CORPUS:
        k = c["area"] + " / " + c["topic"]
        by[k] = by.get(k, 0) + 1
    pend = sum(1 for c in _load_collection(DATA / "processed_criteria", "criteria") if c.get("review_status") == "pending_review")
    return {"approved": len(CORPUS), "pending": pend, "judgments": len(JUDGMENT_IDS),
            "judgment_ids": sorted(JUDGMENT_IDS), "by_topic": by}


def _remove_pending(cid):
    d = DATA / "processed_criteria"
    if not d.exists():
        return
    for name in os.listdir(d):
        if not name.endswith(".json"):
            continue
        p = d / name
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        items = raw.get("criteria") if isinstance(raw, dict) else raw
        if not isinstance(items, list):
            continue
        if any(isinstance(x, dict) and x.get("id") == cid for x in items):
            rest = [x for x in items if not (isinstance(x, dict) and x.get("id") == cid)]
            if rest:
                p.write_text(json.dumps({"criteria": rest} if isinstance(raw, dict) else rest, ensure_ascii=False, indent=2), encoding="utf-8")
            else:
                p.unlink()
            return


def admin_approve(b):
    cid, by = (b.get("id") or "").strip(), (b.get("by") or "").strip()
    if not by:
        return {"ok": False, "errors": ["Falta el nombre del revisor (Regla 15)."]}
    c = next((x for x in _load_collection(DATA / "processed_criteria", "criteria") if x.get("id") == cid), None)
    if not c:
        return {"ok": False, "errors": ["Criterio no encontrado en pendientes."]}
    sealed = dict(c, review_status="approved", approved=True, approved_by=by, approved_at=_now(), updated_at=_now())
    miss = _admin_missing(sealed)
    if miss:
        return {"ok": False, "errors": ["No se puede aprobar; faltan/invalidos: " + ", ".join(miss)]}
    if not is_servable(sealed):
        return {"ok": False, "errors": ["No supera la puerta de servibilidad."]}
    (DATA / "approved_criteria" / (cid + ".json")).write_text(json.dumps({"criteria": [sealed]}, ensure_ascii=False, indent=2), encoding="utf-8")
    _remove_pending(cid)
    try:
        with open(DATA / "review_log.jsonl", "a", encoding="utf-8") as lg:
            lg.write(json.dumps({"id": "rev-approve-" + cid, "criterion_id": cid, "judgment_id": sealed["judgment_id"],
                                 "action": "approve", "actor": by, "at": _now(), "detail": "Aprobado desde el panel."}, ensure_ascii=False) + "\n")
    except Exception:
        pass
    _admin_reload()
    return {"ok": True}


def admin_reject(b):
    cid, by = (b.get("id") or "").strip(), (b.get("by") or "").strip()
    reason = (b.get("reason") or "").strip()
    if not reason:
        return {"ok": False, "errors": ["Falta el motivo de rechazo."]}
    _remove_pending(cid)
    try:
        with open(DATA / "review_log.jsonl", "a", encoding="utf-8") as lg:
            lg.write(json.dumps({"id": "rev-reject-" + cid, "criterion_id": cid, "judgment_id": "", "action": "reject",
                                 "actor": by or "admin", "at": _now(), "detail": "Rechazado: " + reason}, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return {"ok": True}


# ===========================================================================
# 10. Servidor HTTP (mismo contrato que backend/server.ts)
# ===========================================================================
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8"}
CORPUS = load_approved_criteria()
JUDGMENT_IDS = load_judgment_ids()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silencioso salvo errores
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, text, status=200, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        loc = "en" if qs.get("locale", ["es"])[0] == "en" else "es"
        if u.path == "/api/disclaimer":
            self._json({"ok": True, **disclaimer_config(loc)})
            return
        if u.path == "/api/catalog/tree":
            self._json({"ok": True, "tree": catalog_tree()})
            return
        if u.path == "/api/catalog/questions":
            items = catalog_list(qs.get("area", [""])[0], qs.get("topic", [""])[0], loc)
            self._json({"ok": True, "items": items})
            return
        if u.path == "/api/catalog/question":
            self._json({"ok": True, "question": catalog_get(qs.get("id", [""])[0], loc)})
            return
        if u.path == "/api/admin/pending":
            self._json({"ok": True, "items": admin_pending()})
            return
        if u.path == "/api/admin/corpus":
            self._json({"ok": True, "corpus": admin_corpus_summary()})
            return
        self._serve_static(u.path)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/acceptance":
            b = self._body()
            self._json({"ok": True, "record": {
                "id": f"acc-{uuid.uuid4()}", "session_id": str(b.get("session_id", "")),
                "user_id": b.get("user_id") if isinstance(b.get("user_id"), str) else None,
                "accepted_at": _now(), "disclaimer_version": DISCLAIMER_VERSION,
                "language": b.get("language") if isinstance(b.get("language"), str) else "es"}})
            return
        if u.path == "/api/consulta":
            b = self._body()
            if str(b.get("accepted_version", "")) != DISCLAIMER_VERSION:
                self._json({"ok": False, "acceptance_required": True,
                            "disclaimer_version": DISCLAIMER_VERSION,
                            "message": "Debe aceptar el aviso informativo antes de usar la herramienta."})
                return
            loc = "en" if b.get("locale") == "en" else "es"
            try:
                r = run_query(str(b.get("question", "")), loc, CORPUS, JUDGMENT_IDS)
                scope, ans = r["scope"], r["answer"]
                self._json({"ok": True, "decision": ans["decision"],
                            "area": area_label(scope["area"], "en") if loc == "en" else scope["area"],
                            "topic": topic_label(scope["topic"], "en")["label"] if loc == "en" else scope["topic"],
                            "answer_text": ans["answer_text"], "criteria_used": ans["criteria_used"],
                            "sources_used": ans["sources_used"], "disclaimer": ans["disclaimer"],
                            "clarify_options": build_clarify_options(scope, normalize(str(b.get("question", ""))), loc) if ans["decision"] == "clarify" else []})
            except Exception:
                self._json({"ok": True, "decision": "insufficient_criteria", "area": None, "topic": None,
                            "answer_text": "No puedo procesar la consulta en este momento por un problema técnico. "
                                           "Por seguridad, no ofrezco ninguna orientación de fondo.",
                            "criteria_used": [], "sources_used": [], "disclaimer": BANNER_DISCLAIMER})
            return
        if u.path == "/api/upload":
            self._handle_upload(self._body())
            return
        if u.path == "/api/scoreboard":
            b = self._body()
            loc = "en" if b.get("locale") == "en" else "es"
            sid = b.get("session_id") if isinstance(b.get("session_id"), str) else ""
            # Sin aceptación del aviso vigente, no se accede al scoreboard (gate).
            if str(b.get("accepted_version", "")) != DISCLAIMER_VERSION:
                log_event("access_denied", sid, [], "Scoreboard denegado: aviso no aceptado.")
                self._json({"ok": False, "acceptance_required": True, "disclaimer_version": DISCLAIMER_VERSION})
                return
            files = load_case_materials(sid)
            sb = run_scoreboard(str(b.get("question", "")), files, CORPUS, JUDGMENT_IDS, loc)
            log_event("scoreboard", sid, [c["criterion_id"] for c in sb["criteria_used"]],
                      f"Scoreboard servido (computable={sb['computable']}, score={sb['case_fit_score']}, label={sb['score_label']}).")
            self._json({"ok": True, "scoreboard": sb})
            return
        if u.path == "/api/evaluate":
            b = self._body()
            loc = "en" if b.get("locale") == "en" else "es"
            sid = b.get("session_id") if isinstance(b.get("session_id"), str) else ""
            if str(b.get("accepted_version", "")) != DISCLAIMER_VERSION:
                log_event("access_denied", sid, [], "Evaluador denegado: aviso no aceptado.")
                self._json({"ok": False, "acceptance_required": True, "disclaimer_version": DISCLAIMER_VERSION})
                return
            case_id = b.get("case_id") if isinstance(b.get("case_id"), str) else None
            files = load_case_materials(sid, case_id)
            ev = run_case_evaluation(str(b.get("description", "")), b.get("asunto_hint"), files, CORPUS, JUDGMENT_IDS, loc)
            # Regla 16 (auditoría del Evaluador de Caso): traza completa.
            log_event("case_evaluation", sid, [c["criterion_id"] for c in ev["criteria_used"]],
                      f"Evaluación de caso (case_id={case_id or '-'}, name={str(b.get('case_name', ''))[:40]}): "
                      f"grade={ev['case_fit_grade']}, score={ev['case_fit_score']}, conf={ev['confidence_level']}, "
                      f"docs={len(files)}, missing={len(ev['missing_facts'])}, descartados={'-' if ev['criteria_used'] else 0}.")
            self._json({"ok": True, "evaluation": ev})
            return
        if u.path == "/api/admin/register-judgment":
            self._json(admin_register_judgment(self._body()))
            return
        if u.path == "/api/admin/add-criterion":
            self._json(admin_add_criterion(self._body()))
            return
        if u.path == "/api/admin/approve":
            self._json(admin_approve(self._body()))
            return
        if u.path == "/api/admin/reject":
            self._json(admin_reject(self._body()))
            return
        self._text("Método no permitido", 405)

    def _handle_upload(self, b):
        # Subida de CASE MATERIAL. Rechaza corpus_document (los usuarios no amplían el corpus).
        if b.get("upload_type") == "corpus_document":
            self._json({"ok": False, "error": "Los usuarios no pueden ampliar el corpus. Los documentos del "
                        "corpus (sentencias) se cargan desde el panel interno de revisión."})
            return
        filename = str(b.get("filename", "")).strip()
        session_id = b.get("session_id") if isinstance(b.get("session_id"), str) and b.get("session_id") else None
        question = str(b.get("question", ""))
        file_type = (b.get("file_type") if isinstance(b.get("file_type"), str) else None) or file_type_from_name(filename)
        if not filename or file_type not in FILE_TYPES:
            self._json({"ok": False, "error": "Tipo de archivo no soportado. Use PDF, DOCX, TXT, PNG, JPG o JPEG."})
            return
        if not session_id:
            self._json({"ok": False, "error": "Falta session_id."})
            return
        now = _now()
        ex = extract_text(file_type, filename,
                          text=b.get("text") if isinstance(b.get("text"), str) else None,
                          base64=b.get("base64") if isinstance(b.get("base64"), str) else None)
        case_id = b.get("case_id") if isinstance(b.get("case_id"), str) and b.get("case_id") else None
        f = {"id": f"upl-{uuid.uuid4()}", "case_id": case_id, "original_filename": filename, "file_type": file_type,
             "upload_type": "case_material", "uploaded_at": now, "uploaded_by": None, "session_id": session_id,
             "extraction_status": ex["status"], "extraction_method": ex.get("extraction_method"),
             "page_texts": ex.get("page_texts", []), "confidence": ex.get("confidence"),
             "extracted_text": ex["text"], "summary": "",
             "detected_entities": [], "detected_legal_topics": [], "warnings": ex["warnings"],
             "source_locations": ex["source_locations"], "created_at": now, "updated_at": now}
        facts = extract_case_facts(question, [f])
        f["summary"] = facts["case_summary"]
        f["detected_legal_topics"] = facts["possible_topics"]
        try:  # persistir (decisión del usuario) — carpeta de primer nivel data/case_materials
            d = DATA / "case_materials"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{f['id']}.json").write_text(json.dumps(f, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
        self._json({"ok": True, "file": {"id": f["id"], "file_type": f["file_type"],
                    "extraction_status": f["extraction_status"], "warnings": f["warnings"]}, "facts": facts})

    def _serve_static(self, path):
        rel = "index.html" if path == "/" else path.lstrip("/")
        if ".." in rel or "/" in rel:
            self._text("No encontrado", 404)
            return
        f = FRONTEND / rel
        if not f.exists():
            self._text("No encontrado", 404)
            return
        self._text(f.read_text(encoding="utf-8"), 200, MIME.get(f.suffix, "application/octet-stream"))


# ===========================================================================
# 11. Autocomprobación de fidelidad contra docs/answerComposer-examples.md
# ===========================================================================
def _golden_blocks() -> dict:
    text = (ROOT / "docs" / "answerComposer-examples.md").read_text(encoding="utf-8")
    blocks = {}
    for m in re.finditer(r"## Decisión `(\w+)`.*?```\n(.*?)\n```", text, re.DOTALL):
        blocks[m.group(1)] = m.group(2)
    return blocks


def self_check() -> bool:
    ok = True
    cbi = {c["id"]: c for c in CORPUS}
    golden = _golden_blocks()

    # (a) answer: recompone crit-mock-0001 y compara con el golden snapshot.
    c1 = cbi.get("crit-mock-0001")
    if c1:
        scope = {"area": "Marcas", "topic": "riesgo de confusión", "subtopics": ["similitud de signos"],
                 "out_of_scope": False, "confidence": "high"}
        ans = compose_answer("q", scope, {"decision": "answer"}, [c1], "es", False)
        if ans["answer_text"].strip() != golden.get("answer", "").strip():
            ok = False
            print("  ✗ answer: el texto compuesto NO coincide con el golden snapshot")
        else:
            print("  ✓ answer: idéntico al golden snapshot (crit-mock-0001)")

    # (b) clarify / out_of_scope / insufficient: comparar contra golden.
    for dec, scope in [("out_of_scope", {"area": "Fuera de alcance", "topic": None, "subtopics": [], "out_of_scope": True, "confidence": "high"}),
                       ("insufficient_criteria", {"area": "Patentes", "topic": "validez", "subtopics": [], "out_of_scope": False, "confidence": "high"})]:
        ans = compose_answer("q", scope, {"decision": dec, "clarifying_questions": []}, [], "es", False)
        if ans["answer_text"].strip() != golden.get(dec, "").strip():
            ok = False
            print(f"  ✗ {dec}: NO coincide con el golden snapshot")
        else:
            print(f"  ✓ {dec}: idéntico al golden snapshot")

    # (c) invariantes de seguridad sobre el motor completo.
    cases = [
        ("Mi marca está registrada en España, vendemos productos de cosmética y una empresa competidora usa un logo muy parecido.", "answer"),
        ("Tengo un problema penal, ¿qué hago?", "out_of_scope"),
        ("¿Qué impuestos paga mi marca registrada?", "out_of_scope"),
        ("Quiero anular la patente registrada de mi competidor por falta de novedad: ya existía divulgación previa publicada.", "insufficient_criteria"),
        ("Mi logo se parece al de otra empresa, ¿voy a ganar?", "clarify"),
    ]
    for q, expected in cases:
        got = run_query(q, "es", CORPUS, JUDGMENT_IDS)["answer"]["decision"]
        mark = "✓" if got == expected else "✗"
        if got != expected:
            ok = False
        print(f"  {mark} motor: «{q[:48]}…» → {got} (esperado {expected})")

    # (d) las pendientes (ECLI real) NUNCA se sirven.
    pend = _load_collection(DATA / "processed_criteria", "criteria")
    served = sum(1 for c in pend if is_servable(c))
    print(f"  {'✓' if served == 0 else '✗'} aislamiento: {len(pend)} criterios pendientes, servibles={served} (debe ser 0)")
    if served != 0:
        ok = False
    return ok


def main():
    print("Locked Legal Advisor — DEMO (espejo Python, sin Node)\n")
    print(f"Corpus aprobado: {len(CORPUS)} criterios | resoluciones: {len(JUDGMENT_IDS)}\n")
    print("Autocomprobación de fidelidad contra docs/answerComposer-examples.md:")
    ok = self_check()
    print("\n" + ("FIDELIDAD: OK ✅" if ok else "FIDELIDAD: FALLOS ❌"))
    if "--check" in sys.argv:
        sys.exit(0 if ok else 1)
    if not ok:
        print("Aviso: hay divergencias con el motor real; revísalas antes de fiarte de la demo.")
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\n▶  Abre http://127.0.0.1:{port}  (chat)   ·   http://127.0.0.1:{port}/catalog.html  (catálogo)")
    print("   Ctrl+C para parar.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDemo detenida.")


if __name__ == "__main__":
    main()
