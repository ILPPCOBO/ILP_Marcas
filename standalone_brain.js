/*
 * standalone_brain.js — Cerebro cerrado portado a JavaScript para el HTML
 * autónomo (offline, sin servidor). Traducción FIEL del espejo Python
 * (demo/serve_demo.py), que a su vez es fiel al motor TypeScript. Los DATOS
 * (LÉXICO, CHECKLISTS, criterios aprobados, resoluciones, avisos) se inyectan en
 * la constante global LLA_DATA por el build (build_standalone.py) desde las
 * fuentes de verdad; aquí NO se inventa nada.
 */
(function (global) {
  "use strict";
  var D = global.LLA_DATA;

  // ---- normalización y coincidencia de keywords (scopeClassifier) ----
  function normalize(t) {
    return (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  }
  function normKw(k) {
    return k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9*]+/).filter(Boolean);
  }
  function tokenMatches(kt, qt) { return kt.charAt(kt.length - 1) === "*" ? qt.indexOf(kt.slice(0, -1)) === 0 : qt === kt; }
  function allMatches(keyword, tokens) {
    var kw = normKw(keyword); if (!kw.length) return [];
    var weight = kw.length > 1 ? 2 : 1, out = [];
    for (var i = 0; i + kw.length <= tokens.length; i++) {
      var ok = true;
      for (var j = 0; j < kw.length; j++) { if (!tokenMatches(kw[j], tokens[i + j])) { ok = false; break; } }
      if (ok) out.push({ kw: keyword, weight: weight, start: i, length: kw.length });
    }
    return out;
  }
  function matchesAnyKeyword(keywords, tokens) {
    for (var i = 0; i < keywords.length; i++) if (allMatches(keywords[i], tokens).length) return true;
    return false;
  }
  function scoreKeywords(keywords, tokens) {
    var cands = [];
    keywords.forEach(function (kw, order) { allMatches(kw, tokens).forEach(function (m) { cands.push({ kw: m.kw, weight: m.weight, start: m.start, length: m.length, order: order }); }); });
    cands.sort(function (a, b) { return (b.weight - a.weight) || (a.start - b.start) || (a.order - b.order); });
    var consumed = new Array(tokens.length).fill(false), used = {}, score = 0, hits = [];
    for (var c = 0; c < cands.length; c++) {
      var x = cands[c]; if (used[x.kw]) continue;
      var free = true;
      for (var t = x.start; t < x.start + x.length; t++) { if (consumed[t]) { free = false; break; } }
      if (!free) continue;
      for (var t2 = x.start; t2 < x.start + x.length; t2++) consumed[t2] = true;
      used[x.kw] = true; score += x.weight; hits.push(x.kw);
    }
    return { score: score, hits: hits };
  }

  function confFor(s) { return s >= 4 ? "high" : s >= 2 ? "medium" : "low"; }

  function classifyScope(question) {
    var tokens = normalize(question);
    if (!tokens.length) return { area: "Fuera de alcance", topic: null, subtopics: [], out_of_scope: true, confidence: "high", reason: "" };
    var cands = [];
    D.lexicon.areas.forEach(function (area) {
      var areaHits = scoreKeywords(area.area_keywords, tokens).hits;
      var bonus = areaHits.length ? 1 : 0, bestTopic = null, bestScore = 0;
      area.topics.forEach(function (topic) {
        var sc = scoreKeywords(topic.keywords, tokens).score;
        if (sc > bestScore) { bestTopic = topic; bestScore = sc; }
      });
      var total = bestScore + bonus;
      if (total === 0) return;
      cands.push({ area: area, topic: bestTopic, topicScore: bestScore, bonus: bonus, total: total });
    });
    var best = null;
    cands.forEach(function (c) { if (best === null || c.total > best.total || (c.total === best.total && c.bonus > best.bonus)) best = c; });
    var runnerUp = 0;
    cands.forEach(function (c) { if (best && c.area.name !== best.area.name && c.total > runnerUp) runnerUp = c.total; });
    var outBest = null;
    D.lexicon.out_of_domain.forEach(function (dom) {
      var sc = scoreKeywords(dom.keywords, tokens).score;
      if (sc > 0 && (outBest === null || sc > outBest.score)) outBest = { domain: dom.domain, score: sc };
    });
    var inTotal = best ? best.total : 0;
    if (outBest !== null && outBest.score >= inTotal)
      return { area: "Fuera de alcance", topic: null, subtopics: [], out_of_scope: true, confidence: "high", reason: 'Materia no cubierta ("' + outBest.domain + '").' };
    if (best === null)
      return { area: "Fuera de alcance", topic: null, subtopics: [], out_of_scope: true, confidence: "low", reason: "Ninguna materia del corpus se reconoce." };
    var subtopics = [];
    if (best.topic) best.topic.subtopics.forEach(function (st) { if (scoreKeywords(st.keywords, tokens).hits.length) subtopics.push(st.name); });
    var confidence = confFor(best.total);
    if (runnerUp > 0 && best.total - runnerUp <= 1) confidence = "low";
    var topic = best.topic && best.topicScore > 0 ? best.topic.name : null;
    return { area: best.area.name, topic: topic, subtopics: subtopics, out_of_scope: false, confidence: confidence, reason: "Coincidencias del léxico cerrado." };
  }
  function legalArea(area) { for (var i = 0; i < D.lexicon.areas.length; i++) if (D.lexicon.areas[i].name === area) return D.lexicon.areas[i].corpus_area; return null; }
  function topicKey(topic) { return normalize(topic).join("_"); }

  // ---- missingFactsDetector ----
  function getChecklist(area, topic) {
    for (var i = 0; i < D.checklists.checklists.length; i++) { var c = D.checklists.checklists[i]; if (c.area === area && c.topic === topic) return c.essential_facts; }
    return [];
  }
  function detectMissingFacts(question, scope) {
    if (scope.out_of_scope) return { needs_clarification: false, missing_facts: [], clarifying_questions: [] };
    var tokens = normalize(question);
    var fb = D.checklists.area_fallback[scope.area];
    if (scope.topic === null) {
      if (fb) return { needs_clarification: true, missing_facts: [fb.fact], clarifying_questions: [fb.question] };
      return { needs_clarification: true, missing_facts: ["tema concreto de la consulta"], clarifying_questions: ["¿Podría concretar el tema de su consulta?"] };
    }
    var checklist = getChecklist(scope.area, scope.topic);
    if (!checklist.length) {
      var fact = fb ? fb.fact : "tema concreto de la consulta", q = fb ? fb.question : "¿Podría concretar el tema de su consulta?";
      return { needs_clarification: true, missing_facts: [fact], clarifying_questions: [q] };
    }
    var missing = checklist.filter(function (f) { return !matchesAnyKeyword(f.signals, tokens); });
    return { needs_clarification: missing.length > 0, missing_facts: missing.map(function (f) { return f.fact; }), clarifying_questions: missing.map(function (f) { return f.question; }) };
  }

  // ---- corpus: isServable + retrieve ----
  function nonempty(s) { return typeof s === "string" && s.trim() !== ""; }
  function strArray(v) { return Array.isArray(v) && v.every(function (x) { return nonempty(x); }) && v.length === new Set(v).size; }
  function iso(s) { return typeof s === "string" && s.length >= 10 && s.indexOf("T") >= 0; }
  function validCriterion(c) {
    if (!c || typeof c !== "object") return false;
    var req = ["id", "judgment_id", "topic", "criterion_text", "source_excerpt", "source_reference"];
    for (var i = 0; i < req.length; i++) if (!nonempty(c[req[i]])) return false;
    if (["marcas", "propiedad_intelectual", "patentes", "procesal"].indexOf(c.area) < 0) return false;
    if (c.subtopic !== null && !nonempty(c.subtopic)) return false;
    if (!strArray(c.conditions_for_application) || !strArray(c.does_not_answer) || !strArray(c.limits)) return false;
    if (["high", "medium", "low"].indexOf(c.confidence_level) < 0) return false;
    if (["pending_review", "approved", "rejected"].indexOf(c.review_status) < 0) return false;
    if (typeof c.approved !== "boolean") return false;
    if (c.approved !== (c.review_status === "approved")) return false;
    if (c.review_status === "approved") { if (!nonempty(c.approved_by) || !iso(c.approved_at)) return false; }
    else { if (c.approved_by !== null || c.approved_at !== null) return false; }
    return iso(c.created_at) && iso(c.updated_at);
  }
  function isServable(c) {
    return c.review_status === "approved" && c.approved === true && nonempty(c.approved_by) && iso(c.approved_at) && validCriterion(c);
  }
  function retrieve(scope) {
    var la = legalArea(scope.area);
    if (la === null || scope.topic === null) return { criteria: [], insufficient_criteria: true };
    var key = topicKey(scope.topic);
    var subs = {}; (scope.subtopics || []).forEach(function (s) { subs[topicKey(s)] = true; });
    var matched = D.criteria.filter(function (c) { return isServable(c) && c.area === la && c.topic === key && D.judgmentIds.indexOf(c.judgment_id) >= 0; });
    matched.sort(function (a, b) { var sa = a.subtopic && subs[a.subtopic] ? 0 : 1, sb = b.subtopic && subs[b.subtopic] ? 0 : 1; return sa !== sb ? sa - sb : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return { criteria: matched, insufficient_criteria: matched.length < 1 };
  }

  // ---- decisionEngine ----
  var AMBIG = "Su consulta podría encajar en más de una materia del corpus. ¿Podría reformularla concretando el aspecto que más le interesa?";
  function decide(scope, missing, retrieval) {
    if (scope.out_of_scope) return { decision: "out_of_scope", clarifying_questions: [] };
    if (missing.needs_clarification) return { decision: "clarify", clarifying_questions: missing.clarifying_questions.slice() };
    if (scope.confidence === "low") return { decision: "clarify", clarifying_questions: [AMBIG] };
    if (retrieval.insufficient_criteria || retrieval.criteria.length === 0) return { decision: "insufficient_criteria", clarifying_questions: [] };
    if (!retrieval.criteria.every(isServable)) return { decision: "insufficient_criteria", clarifying_questions: [] };
    return { decision: "answer", clarifying_questions: [] };
  }

  // ---- guardarraíl de lenguaje vetado (Regla 18) ----
  // En JS `\b` es ASCII: un patrón terminado en vocal acentuada ("ganará") no
  // casaría. Se prueba también el texto SIN acentos para que casen los patrones.
  function deaccent(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  var FORBIDDEN = D.forbidden.map(function (p) { return new RegExp(p, "i"); });
  function hasForbidden(text) { var alt = deaccent(text); for (var i = 0; i < FORBIDDEN.length; i++) if (FORBIDDEN[i].test(text) || FORBIDDEN[i].test(alt)) return true; return false; }

  // ---- answerComposer (plantillas ES, idénticas al motor) ----
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function lowestConf(cs) { var rank = { low: 0, medium: 1, high: 2 }, acc = "high"; cs.forEach(function (c) { if (rank[c.confidence_level] < rank[acc]) acc = c.confidence_level; }); return acc; }
  var DISC = D.disclaimer.short, DISC_BREVE = "Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye asesoramiento jurídico.";
  var DISC_EN = D.disclaimer.short_en || DISC;

  // ---- Presentación EN (capa fina; el razonamiento corre siempre en español) ----
  // Mapas/glosario EMBEBIDOS desde serve_demo (fuente única). Las FUENTES, citas,
  // números, fechas y el texto de criterios NUNCA se traducen (Reglas 2/3/4/9).
  var AREA_EN = D.area_en || {}, TOPIC_EN = D.topic_en || {}, CHECK_EN = D.checklist_en || {};
  var GLOSS = D.glossary || [];
  var NOTICE_SRC = (D.notices && D.notices.english_source) || "", NOTICE_DOUBT = (D.notices && D.notices.translation_doubt) || "";
  function areaLabel(a, lang) { return lang === "en" ? (AREA_EN[a] || a) : a; }
  function areaKnown(a) { return Object.prototype.hasOwnProperty.call(AREA_EN, a); }
  function topicLabel(t, lang) { if (t === null || t === undefined) return { label: null, known: true }; if (lang !== "en") return { label: t, known: true }; var en = TOPIC_EN[t]; return { label: en != null ? en : t, known: en != null }; }
  function trQuestion(q, lang) { return lang === "en" ? (CHECK_EN[q] || q) : q; }
  function englishNotices(uncertain) { var n = NOTICE_SRC; if (uncertain) n += "\n" + NOTICE_DOUBT; return n; }
  // Capitaliza al estilo de str.capitalize() de Python (1ª mayúscula, resto minúscula),
  // para que las etiquetas genéricas coincidan byte a byte con serve_demo.
  function capWord(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
  // Normaliza una consulta EN a español añadiendo los términos del glosario cerrado,
  // para que la clasificación corra sobre el vocabulario español (espejo de normalize_query).
  function normalizeQuery(text, lang) {
    if (lang !== "en") return { spanish: text, uncertain: false, matched: 0 };
    var low = " " + String(text || "").toLowerCase() + " ", add = [], matched = 0;
    GLOSS.forEach(function (e) { if ((e.en || []).some(function (p) { return low.indexOf(String(p).toLowerCase()) >= 0; })) { matched++; add.push(e.es); } });
    return { spanish: (text + " " + add.join(" ")).trim(), uncertain: matched === 0, matched: matched };
  }

  // ---- Nombres de resolución LEGIBLES (mismo criterio que el motor servido; FIEL, Regla 9) ----
  var ECLI_COURT = { TS: "del Tribunal Supremo", AN: "de la Audiencia Nacional", APB: "de la Audiencia Provincial de Barcelona", APM: "de la Audiencia Provincial de Madrid", APA: "de la Audiencia Provincial de Alicante", AP: "de la Audiencia Provincial", TSJ: "del Tribunal Superior de Justicia" };
  function cleanSr(sr) { sr = (sr || "").trim(); sr = sr.replace(/\s*Fecha:\s*/g, ", ").replace(/\s*(Materia|Sentencia|Auto):\s*$/, ""); var parts = sr.split(",").map(function (p) { return p.trim(); }).filter(function (p) { return p !== ""; }); var out = []; parts.forEach(function (p) { if (out.length && out[out.length - 1].toLowerCase() === p.toLowerCase()) return; out.push(p); }); return out.join(", "); }
  function resolutionName(raw) {
    raw = (raw || "").trim(); var sr = cleanSr(raw);
    var ci = sr.indexOf(","), head = ci >= 0 ? sr.slice(0, ci).trim() : sr, fecha = ci >= 0 ? sr.slice(ci + 1).trim() : "";
    var m = head.match(/^STJUE\s+(.*)$/); if (m) { var n = "Sentencia del Tribunal de Justicia de la UE, asunto " + m[1].trim(); return n + (fecha ? ", de " + fecha : ""); }
    m = head.match(/^(?:([SA])\s*)?JM\s*(?:n[ºo°]\s*)?(\d+)\s+([A-ZÁÉÍÓÚ][\wÁÉÍÓÚáéíóúñ]+)\s*(.*)$/);
    if (m) {
      var tletter = m[1], njz = m[2], city = m[3], inline = (m[4] || "").trim();
      var org = "del Juzgado de lo Mercantil nº " + njz + " de " + city, tipo = (tletter || "S") === "S" ? "Sentencia" : "Auto", num = "";
      var mb = fecha.match(/^(Sentencia|Auto)\s+(\d+\/\d+)/);
      if (mb) { tipo = mb[1]; num = mb[2]; fecha = fecha.slice(mb[0].length).replace(/^[,\s]+/, "").trim(); }
      else if (inline) { var mi = inline.match(/^(\d+\/\d+)/); if (mi) num = mi[1]; }
      var name = tipo + " " + org; if (num) name += ", nº " + num; if (fecha) name += ", de " + fecha; return name;
    }
    m = head.match(/^([SA])\s+(.*)$/); if (!m) return raw;
    var tip = m[1] === "S" ? "Sentencia" : "Auto", rest = m[2].trim(), o = null, r2 = "";
    var mm = rest.match(/^TS(?![A-Z])\s*(.*)$/);
    if (mm) { o = "del Tribunal Supremo"; r2 = mm[1].trim(); }
    else { mm = rest.match(/^AP\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+(?:\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚñáéíóú]+)?)\s*(.*)$/); if (mm) { o = "de la Audiencia Provincial de " + mm[1].trim(); r2 = mm[2].trim(); } else { mm = rest.match(/^TSJ\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+)\s*(.*)$/); if (mm) { o = "del Tribunal Superior de Justicia de " + mm[1].trim(); r2 = mm[2].trim(); } } }
    if (o === null) return raw;
    var nm = r2.trim(), name2 = tip + " " + o; if (nm) name2 += /^\d/.test(nm) ? ", nº " + nm : " " + nm; if (fecha) name2 += ", de " + fecha; return name2;
  }
  function readableJudgmentId(jid) { jid = (jid || "").trim(); var m = jid.match(/^ECLI[-:]ES[-:]([A-Z]+)[-:](\d{4})[-:](.+)$/); if (m) { var code = m[1], year = m[2], num = m[3], court = ECLI_COURT[code] || "", tipo = /A$/i.test(num.trim()) ? "Auto" : "Sentencia", ecli = "ECLI:ES:" + code + ":" + year + ":" + num; return court ? (tipo + " " + court + " (" + ecli + ")") : ("Resolución (" + ecli + ")"); } return ""; }
  function readableCitation(c) { var sr = (c.source_reference || "").trim(), jid = (c.judgment_id || "").trim(), name = resolutionName(sr); if (name && name !== sr) return name; var j = readableJudgmentId(jid); if (j) return sr ? (j + ", " + sr) : j; if (sr && jid) return sr + " (resolución " + jid + ")"; return sr || jid; }

  function renderAnswer(scope, criteria) {
    var area = scope.area, topic = scope.topic || "(tema no determinado)";
    var subt = scope.subtopics.length ? "; en concreto: " + scope.subtopics.join(", ") : "";
    var s1 = "1. Lo que he entendido\nHe entendido que su consulta se refiere a " + area.toLowerCase() + ", en relación con «" + topic + "»" + subt + ". Tomo como base únicamente lo que usted ha descrito, sin añadir hechos que no haya mencionado.";
    var s2 = "2. Encaje dentro del corpus\nLa consulta encaja en el área «" + area + "», tema «" + topic + "».";
    var s3 = "3. Criterios aplicables\n" + criteria.map(function (c) { return "   • [" + c.id + "] " + c.criterion_text + "\n     Fuente: " + readableCitation(c) + "."; }).join("\n");
    var s4items = criteria.map(function (c) { var cond = c.conditions_for_application.length ? " Esto podría ser relevante si concurren: " + c.conditions_for_application.join("; ") + "." : ""; return "   • Según los criterios disponibles, el corpus recoge que " + c.criterion_text + cond; });
    var s4 = "4. Orientación informativa\nSegún los criterios disponibles en el corpus, los siguientes elementos podrían ser relevantes para orientar el análisis, sin que ello anticipe ningún resultado:\n" + s4items.join("\n") + "\nEl corpus no permite afirmar un resultado: estos criterios solo orientan el análisis.";
    var no = uniq([].concat.apply([], criteria.map(function (c) { return c.does_not_answer; })));
    var lim = uniq([].concat.apply([], criteria.map(function (c) { return c.limits; })));
    var limits = "Esta respuesta no concluye su caso. En particular, los criterios usados no resuelven: " + no.join("; ") + ". Además, presentan estos límites: " + lim.join("; ") + ". El resultado real dependería de la prueba que se practique y de la normativa vigente, que esta herramienta no verifica.";
    var s5 = "5. Límites de esta respuesta\n" + limits;
    var s6 = "6. Aviso\n" + DISC;
    return { text: [s1, s2, s3, s4, s5, s6].join("\n\n"), limits: limits };
  }
  // Andamiaje EN (espejo de _render_answer_en): cabeceras y conectores en inglés;
  // el texto de criterios y las FUENTES se incrustan VERBATIM en español (Regla 9).
  function renderAnswerEn(scope, criteria, uncertain) {
    var area = areaLabel(scope.area, "en"), t = topicLabel(scope.topic, "en");
    var topic = t.label || "(topic not determined)";
    var subt = scope.subtopics.length ? " (specifically: " + scope.subtopics.join(", ") + ")" : "";
    var unc = uncertain || (!t.known) || (!areaKnown(scope.area));
    var s1 = "1. What I understood\nI understand that your query concerns " + area.toLowerCase() + ", regarding «" + topic + "»" + subt + ". I rely only on what you have described, without adding facts you did not mention.";
    var s2 = "2. Fit within the corpus\nThe query fits the area «" + area + "», topic «" + topic + "».";
    var s3 = "3. Applicable criteria\n" + criteria.map(function (c) { return "   • [" + c.id + "] " + c.criterion_text + "\n     Source (in Spanish): " + readableCitation(c) + "."; }).join("\n");
    var s4items = criteria.map(function (c) { var cond = c.conditions_for_application.length ? " This may be relevant if the following concur: " + c.conditions_for_application.join("; ") + "." : ""; return "   • According to the available criteria, the corpus records that: " + c.criterion_text + cond; });
    var s4 = "4. Informational guidance\nBased on the available criteria in the corpus, the following points may be relevant to guide the analysis, without anticipating any outcome:\n" + s4items.join("\n") + "\nThe corpus does not allow asserting an outcome: these criteria only guide the analysis.";
    var no = uniq([].concat.apply([], criteria.map(function (c) { return c.does_not_answer; })));
    var lim = uniq([].concat.apply([], criteria.map(function (c) { return c.limits; })));
    var limits = "This response does not resolve your case. In particular, the criteria used do not address: " + no.join("; ") + ". They also carry these limits: " + lim.join("; ") + ". The actual outcome would depend on the evidence produced and on the applicable law in force, which this tool does not verify.";
    var s5 = "5. Limits of this response\n" + limits;
    var s6 = "6. Notice\n" + DISC_EN + "\n" + englishNotices(unc);
    return { text: [s1, s2, s3, s4, s5, s6].join("\n\n"), limits: limits };
  }
  function composeAnswer(scope, decision, criteria, lang, uncertain) {
    var en = lang === "en";
    var d = decision.decision, criteria_used = [], sources_used = [], conf = null, text, limits;
    if (d === "answer") {
      var serv = criteria.filter(isServable), seen = {}, uq = [];
      serv.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = true; uq.push(c); } });
      if (!uq.length || scope.topic === null) throw new Error("answer sin criterios");
      var r = en ? renderAnswerEn(scope, uq, uncertain) : renderAnswer(scope, uq); text = r.text; limits = r.limits;
      criteria_used = uq.map(function (c) { return c.id; });
      sources_used = uq.map(function (c) { return { criterion_id: c.id, judgment_id: c.judgment_id, resolution: readableCitation(c) }; });
      conf = lowestConf(uq);
    } else if (d === "clarify") {
      if (en) {
        var qs = decision.clarifying_questions.map(function (q) { return trQuestion(q, "en"); });
        text = "I cannot analyse the merits yet: essential information is missing to apply the corpus criteria. To guide you, I would need you to clarify:\n" + qs.map(function (q) { return "   • " + q; }).join("\n") + "\n\n" + DISC_EN + "\n" + englishNotices(uncertain);
        limits = "The merits were not analysed: essential information is missing.";
      } else {
        text = "No puedo analizar el fondo todavía: faltan datos esenciales para aplicar los criterios del corpus. Para poder orientarle, necesitaría que precise:\n" + decision.clarifying_questions.map(function (q) { return "   • " + q; }).join("\n") + "\n\n" + DISC_BREVE;
        limits = "No se ha analizado el fondo: faltan datos esenciales.";
      }
    } else if (d === "out_of_scope") {
      if (en) {
        text = "This question is not covered by the decisions in the analysed corpus, so I cannot give you legal guidance on it. The corpus is limited to trademarks, intellectual property, patents and related procedural matters. If your query has any component within those areas, you can rephrase it focusing on that. For common, already-validated questions you may consult the catalogue of standard questions; for your specific case, turn to a professional.\n\n" + DISC_EN + "\n" + englishNotices(uncertain);
        limits = "The matter falls outside the analysed corpus.";
      } else {
        text = "Esta cuestión no está cubierta por las resoluciones del corpus analizado, por lo que no puedo darle una orientación jurídica sobre ella. El corpus se limita a materias de marcas, propiedad intelectual, patentes y aspectos procesales relacionados. Si su consulta tiene algún componente de esas materias, puede reformularla centrándose en él. Para preguntas frecuentes ya validadas, puede consultar el catálogo de preguntas estándar; para su caso concreto, dirigirse a un profesional.\n\n" + DISC_BREVE;
        limits = "La materia queda fuera del corpus analizado.";
      }
    } else {
      if (en) {
        text = "There are not enough approved criteria in the knowledge base to guide this query, so I prefer not to improvise an answer. You may consult the catalogue of validated standard questions or turn to a professional for your specific case.\n\n" + DISC_EN + "\n" + englishNotices(uncertain);
        limits = "The corpus contains no approved criteria applicable to this query.";
      } else {
        text = "No hay criterios aprobados suficientes en la base de conocimiento para orientar esta consulta, de modo que prefiero no improvisar una respuesta. Puede consultar el catálogo de preguntas estándar validadas o dirigirse a un profesional para su caso concreto.\n\n" + DISC_BREVE;
        limits = "El corpus no contiene criterios aprobados aplicables a esta consulta.";
      }
    }
    if (hasForbidden(text)) throw new Error("lenguaje vetado");
    return { decision: d, answer_text: text, criteria_used: criteria_used, sources_used: sources_used, limits: limits, confidence_level: conf, disclaimer: en ? DISC_EN : DISC };
  }

  // ---- Aclaración GUIADA (opciones / multiple choice) ----
  function lexTopic(ak, tk, field) {
    for (var i = 0; i < D.lexicon.areas.length; i++) {
      if (D.lexicon.areas[i].corpus_area !== ak) continue;
      var ts = D.lexicon.areas[i].topics;
      for (var j = 0; j < ts.length; j++) if (topicKey(ts[j].name) === tk) return field === "kw" ? (ts[j].keywords || []) : ts[j].name;
    }
    return field === "kw" ? [] : tk.replace(/_/g, " ");
  }
  // Localiza una config de aclaración (question_en/label_en); las "adds" se
  // mantienen en español porque alimentan al clasificador cerrado (espejo de _localize_cfg).
  function localizeCfg(c, lang) {
    if (lang !== "en") return c;
    return { question: c.question_en || c.question, options: (c.options || []).map(function (o) { return { label: o.label_en || o.label, adds: o.adds }; }) };
  }
  function buildClarifyOptions(scope, tokens, lang) {
    var cfg = D.clarify_options || {};
    var areaKey = legalArea(scope.area), topic = scope.topic;
    if (areaKey && topic && cfg[areaKey + "|" + topicKey(topic)]) return [localizeCfg(cfg[areaKey + "|" + topicKey(topic)], lang)];
    var twc = {};
    D.criteria.forEach(function (c) { if (isServable(c)) { (twc[c.area] = twc[c.area] || {})[c.topic] = 1; } });
    var areas = (areaKey && twc[areaKey]) ? [areaKey] : Object.keys(twc);
    var qtoks = (tokens || []).filter(function (t) { return t.length >= 4; });
    var cand = [];
    areas.forEach(function (ak) {
      Object.keys(twc[ak] || {}).forEach(function (tk) {
        var c = cfg[ak + "|" + tk];
        var adds = (c && c.options && c.options[0]) ? c.options[0].adds : lexTopic(ak, tk, "name");
        var blob = deaccent(lexTopic(ak, tk, "kw").join(" ") + " " + tk.replace(/_/g, " ")).toLowerCase();
        var score = qtoks.reduce(function (s, t) { return s + (blob.indexOf(t) >= 0 ? 1 : 0); }, 0);
        var disp = lexTopic(ak, tk, "name");
        var lbl = lang === "en" ? capWord(topicLabel(disp, "en").label || disp) : capWord(disp);
        cand.push([score, disp, { label: lbl, adds: adds }]);
      });
    });
    if (!cand.length) return [];
    cand.sort(function (a, b) { return (b[0] - a[0]) || (a[1] < b[1] ? -1 : 1); });
    var genQ = lang === "en" ? "Which of these matters does your case concern? Choose to refine:" : "¿Sobre cuál de estas cuestiones trata su caso? Elija para precisar:";
    return [{ question: genQ, options: cand.slice(0, 10).map(function (c) { return c[2]; }) }];
  }

  function queryHasScenario(scope, text) {
    var areaKey = legalArea(scope.area); if (!areaKey) return false;
    var norm = normalize(text).join(" "), cfg = D.clarify_options || {};
    for (var key in cfg) {
      if (key.indexOf(areaKey + "|") !== 0) continue;
      var opts = cfg[key].options || [];
      for (var i = 0; i < opts.length; i++) {
        var an = normalize(opts[i].adds || "").join(" ");
        if (an.length >= 25 && norm.indexOf(an) >= 0) return true;
      }
    }
    return false;
  }

  function runQuery(question, lang) {
    lang = lang === "en" ? "en" : "es";
    var scope = { area: "Fuera de alcance", topic: null, subtopics: [], out_of_scope: false, confidence: "low", reason: "" };
    try {
      var norm = normalizeQuery(question, lang), q = norm.spanish;
      scope = classifyScope(q);
      var missing = detectMissingFacts(q, scope);
      // 1 clic: escenario del corpus elegido → ya hay información → no repreguntar.
      if (missing.needs_clarification && queryHasScenario(scope, q)) {
        missing.needs_clarification = false;
        if (scope.confidence === "low") scope.confidence = "medium";
      }
      var retrieval = retrieve(scope);
      var decision = decide(scope, missing, retrieval);
      var answer = composeAnswer(scope, decision, retrieval.criteria, lang, norm.uncertain);
      var co = decision.decision === "clarify" ? buildClarifyOptions(scope, normalize(q), lang) : [];
      return { scope: scope, answer: answer, clarify_options: co };
    } catch (e) {
      var dec = { decision: "insufficient_criteria", clarifying_questions: [] };
      return { scope: scope, answer: composeAnswer(scope, dec, [], lang, false), clarify_options: [] };
    }
  }

  // ---- caseFactsExtractor ----
  function deacc(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function locate(signals, src) {
    if (src.id === "user-input") return "consulta del usuario";
    if (!src.locs.length) return "documento completo";
    var hay = deacc(src.text), idx = -1;
    signals.forEach(function (s) { var p = s.replace(/\*/g, "").split(/\s+/)[0] || ""; var n = deacc(p); if (!n) return; var at = hay.indexOf(n); if (at >= 0 && (idx < 0 || at < idx)) idx = at; });
    if (idx < 0) return "documento completo";
    for (var i = 0; i < src.locs.length; i++) { var l = src.locs[i]; if (l.char_start != null && l.char_end != null && idx >= l.char_start && idx < l.char_end) { if (l.page != null) return "página " + l.page; if (l.section != null) return 'sección "' + l.section + '"'; return "fragmento " + l.fragment_id; } }
    return "documento completo";
  }
  function extractCaseFacts(question, files) {
    files = (files || []).filter(function (f) { return f.upload_type === "case_material"; });
    var warnings = [], uncertainties = [];
    files.forEach(function (f) { (f.warnings || []).forEach(function (w) { warnings.push("[" + f.original_filename + "] " + w); }); if (f.extraction_status !== "completed") uncertainties.push('No se pudo leer con fiabilidad "' + f.original_filename + '" (estado: ' + f.extraction_status + ")."); });
    var readable = files.filter(function (f) { return f.extraction_status === "completed"; });
    var combined = [question || ""].concat(readable.map(function (f) { return f.extracted_text; })).join("\n");
    var scope = classifyScope(combined);
    var possible = scope.out_of_scope ? [] : [scope.area + " / " + (scope.topic || "(tema no determinado)")];
    var sources = [{ id: "user-input", filename: "consulta del usuario", text: question || "", locs: [] }].concat(readable.map(function (f) { return { id: f.id, filename: f.original_filename, text: f.extracted_text, locs: f.source_locations || [] }; }));
    var relevant = [], missing = [], seq = 0;
    var checklist = !scope.out_of_scope && scope.topic ? getChecklist(scope.area, scope.topic) : [];
    checklist.forEach(function (fact) {
      var found = false;
      sources.forEach(function (src) {
        var tokens = normalize(src.text), matched = fact.signals.filter(function (s) { return matchesAnyKeyword([s], tokens); });
        if (!matched.length) return;
        found = true; seq++;
        relevant.push({ fact_id: "fact-" + String(seq).padStart(3, "0"), fact_text: fact.fact, source_type: src.id === "user-input" ? "user_description" : "uploaded_document", source_document_id: src.id, source_filename: src.filename, page_or_location: locate(matched, src), confidence: matched.length >= 2 ? "medium" : "low" });
      });
      if (!found) missing.push(fact.question);
    });
    var tk = normalize(sources.map(function (s) { return s.text; }).join("\n"));
    if (matchesAnyKeyword(["registrad*", "registro"], tk) && matchesAnyKeyword(["sin registrar"], tk)) uncertainties.push("Posible contradicción sobre el registro: aparecen indicios de 'registrada' y de 'sin registrar'.");
    var evidence = files.map(function (f) { return { document_id: f.id, filename: f.original_filename, file_type: f.file_type, extraction_status: f.extraction_status }; });
    var summary = scope.out_of_scope
      ? "Los materiales aportados (" + files.length + " documento/s) no encajan en una materia cubierta por el corpus, por lo que no se preparan hechos jurídicos. Esto no es una valoración del caso."
      : "Materia probable: " + possible[0] + ". " + files.length + " documento/s aportado/s; " + relevant.length + " indicio/s de hecho detectado/s y " + missing.length + " dato/s esencial/es pendiente/s. Es preparación factual para comparar con criterios aprobados; no anticipa ningún resultado.";
    if (hasForbidden(summary)) return { case_summary: "Resumen no disponible por una comprobación de seguridad (deny-by-default).", relevant_facts: [], missing_facts: missing, evidence_items: evidence, possible_topics: possible, uncertainties: uncertainties, extraction_warnings: warnings };
    return { case_summary: summary, relevant_facts: relevant, missing_facts: missing, evidence_items: evidence, possible_topics: possible, uncertainties: uncertainties, extraction_warnings: warnings };
  }

  // ---- scoreboard ----
  var SB_EXTRA = D.scoreboard_extra.map(function (p) { return new RegExp(p, "i"); });
  function hasScoreboardForbidden(t) { if (hasForbidden(t)) return true; var alt = deaccent(t); for (var i = 0; i < SB_EXTRA.length; i++) if (SB_EXTRA[i].test(t) || SB_EXTRA[i].test(alt)) return true; return false; }
  var LIMIT_ES = D.scoreboard_limit;
  function computeScoreboard(scope, facts, retrieval) {
    var disc = DISC, base = { computable: false, case_fit_score: null, score_label: "insuficiente", confidence_level: "bajo", favorable_factors: [], unfavorable_factors: [], uncertain_factors: [], missing_facts: facts.missing_facts, criteria_used: [], evidence_used: facts.evidence_items.map(function (e) { return e.filename + " (" + e.extraction_status + ")"; }), limits: [LIMIT_ES], next_information_needed: facts.missing_facts, reason: null, disclaimer: disc };
    var criteria = retrieval.criteria;
    if (retrieval.insufficient_criteria || !criteria.length) { base.reason = "No hay criterios aprobados suficientes en el corpus para esta materia; el score no se calcula."; return base; }
    if (scope.out_of_scope || !scope.topic) { base.reason = "La consulta está fuera del alcance del corpus o sin tema determinado; el score no se calcula."; return base; }
    var present = facts.relevant_facts, missing = facts.missing_facts, total = present.length + missing.length, coverage = total ? present.length / total : 0;
    var contradictions = facts.uncertainties.filter(function (u) { return /contradicc/i.test(u); });
    var illegible = facts.uncertainties.some(function (u) { return /no se pudo leer|ilegible/i.test(u); }) || facts.extraction_warnings.some(function (w) { return /no configurado|ilegible|escanead|vac[ií]o|no se pudo extraer/i.test(w); });
    var score = Math.max(0, Math.min(100, Math.round(coverage * 100) - 10 * contradictions.length));
    var favorable = present.map(function (rf, i) { var c = criteria[i % criteria.length]; return { factor: "Hecho presente alineado con un criterio del corpus: " + rf.fact_text, criterion_id: c.id, source_reference: c.source_reference, judgment_id: c.judgment_id, resolution: readableCitation(c), evidence: rf.source_filename + " (" + rf.page_or_location + ")" }; });
    var unfavorable = [];
    criteria.forEach(function (c) { c.does_not_answer.forEach(function (dn) { unfavorable.push({ factor: "El corpus no resuelve este punto: " + dn, criterion_id: c.id, source_reference: c.source_reference, judgment_id: c.judgment_id, resolution: readableCitation(c), evidence: "—" }); }); });
    var uncertain = facts.uncertainties.map(function (u) { return { factor: u, why_it_matters: "Un dato ambiguo o contradictorio afecta a la alineación con los criterios del corpus.", what_is_missing: "Una aclaración o un documento legible que confirme el dato." }; });
    var conf = "alto"; if (illegible || contradictions.length) conf = "bajo"; else if (!facts.evidence_items.length) conf = "medio";
    var label; if (total && missing.length / total > 0.5) label = "insuficiente"; else { label = score >= 70 ? "alto" : score >= 40 ? "medio" : "bajo"; if (missing.length && label === "alto") label = "medio"; }
    var limits = [LIMIT_ES].concat(uniq([].concat.apply([], criteria.map(function (c) { return c.limits; }))));
    var result = { computable: true, case_fit_score: score, score_label: label, confidence_level: conf, favorable_factors: favorable, unfavorable_factors: unfavorable, uncertain_factors: uncertain, missing_facts: missing, criteria_used: criteria.map(function (c) { return { criterion_id: c.id, source_reference: c.source_reference, judgment_id: c.judgment_id, resolution: readableCitation(c) }; }), evidence_used: base.evidence_used.length ? base.evidence_used : ["consulta del usuario"], limits: limits, next_information_needed: missing, reason: null, disclaimer: disc };
    var all = favorable.map(function (f) { return f.factor; }).concat(unfavorable.map(function (f) { return f.factor; })).concat(uncertain.map(function (f) { return f.factor + " " + f.why_it_matters + " " + f.what_is_missing; })).concat(limits).join(" ");
    if (hasScoreboardForbidden(all)) { base.reason = "El contenido no superó la comprobación de seguridad (Regla 18)."; return base; }
    return result;
  }
  function runScoreboard(question, files) {
    var scope = classifyScope(question), facts = extractCaseFacts(question, files), retrieval = retrieve(scope);
    return computeScoreboard(scope, facts, retrieval);
  }

  // ---- extracción de texto en el navegador (TXT directo; PDF vía inflate) ----
  function chunkText(text, prefix) {
    prefix = prefix || "frag"; var out = [], i = 0, n = 0;
    while (i < text.length) { var end = Math.min(i + 1200, text.length); n++; out.push({ fragment_id: prefix + "-" + String(n).padStart(3, "0"), page: null, section: null, char_start: i, char_end: end }); i = end; }
    if (!out.length) out.push({ fragment_id: prefix + "-001", page: null, section: null, char_start: 0, char_end: 0 });
    return out;
  }
  function pdfDecodeString(b) {
    var out = [], i = 0, esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
    while (i < b.length) {
      var c = b[i];
      if (c === 92 && i + 1 < b.length) {
        var nx = b[i + 1];
        if (esc[nx] != null) { out.push(esc[nx]); i += 2; continue; }
        if (nx >= 48 && nx <= 55) { var j = i + 1, o = ""; while (j < b.length && o.length < 3 && b[j] >= 48 && b[j] <= 55) { o += String.fromCharCode(b[j]); j++; } out.push(parseInt(o, 8) & 0xff); i = j; continue; }
        out.push(nx); i += 2; continue;
      }
      out.push(c); i++;
    }
    var s = ""; out.forEach(function (ch) { s += String.fromCharCode(ch); });
    return s;
  }
  async function inflate(bytes) {
    try {
      var ds = new DecompressionStream("deflate");
      var stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
      var buf = await stream.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }
  function bytesToLatin1(u8) {
    try { return new TextDecoder("latin1").decode(u8); }  // rápido y nativo
    catch (e) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }
  }
  // Rápido aunque el PDF sea grande: localiza streams con indexOf (no regex sobre
  // todo el binario), descomprime SOLO streams de texto (cabecera zlib 0x78) y
  // salta las imágenes (DCTDecode/JPEG) sin correr ninguna regex sobre binario.
  async function pdfText(u8) {
    var raw = bytesToLatin1(u8), parts = [], pos = 0, count = 0;
    while (true) {
      var s = raw.indexOf("stream", pos); if (s < 0) break;
      var e = raw.indexOf("endstream", s); if (e < 0) break;
      var b = s + 6;
      if (raw.charCodeAt(b) === 13 && raw.charCodeAt(b + 1) === 10) b += 2;
      else if (raw.charCodeAt(b) === 10 || raw.charCodeAt(b) === 13) b += 1;
      pos = e + 9; count++;
      if (count > 6000) break;
      var cs = null;
      if (u8[b] === 0x78) {                              // FlateDecode (texto comprimido)
        var content = await inflate(u8.subarray(b, e));
        if (content) cs = bytesToLatin1(content);
      } else if ((e - b) < 50000) {                      // posible texto SIN comprimir (pequeño)
        var bt = raw.indexOf("BT", b);
        if (bt >= 0 && bt < e) cs = raw.slice(b, e);
      }
      if (!cs || (cs.indexOf("Tj") < 0 && cs.indexOf("TJ") < 0)) continue;
      var t1 = /\(((?:\\.|[^\\()])*)\)\s*Tj/g, x;
      while ((x = t1.exec(cs)) !== null) { var by = []; for (var a = 0; a < x[1].length; a++) by.push(x[1].charCodeAt(a) & 0xff); parts.push(pdfDecodeString(by)); }
      var t2 = /\[([\s\S]*?)\]\s*TJ/g, y;
      while ((y = t2.exec(cs)) !== null) { var inner = y[1], s2 = /\(((?:\\.|[^\\()])*)\)/g, z; while ((z = s2.exec(inner)) !== null) { var by2 = []; for (var b2 = 0; b2 < z[1].length; b2++) by2.push(z[1].charCodeAt(b2) & 0xff); parts.push(pdfDecodeString(by2)); } parts.push(" "); }
      parts.push("\n");
    }
    return parts.join("");
  }
  // Devuelve {status, text, warnings, source_locations}
  function extractionOut(status, text, warnings, source_locations, method, confidence) {
    return { status: status, text: text, warnings: warnings, source_locations: source_locations,
             extraction_method: method, page_texts: (text || "").trim() ? [text] : [], confidence: confidence };
  }
  async function extractFile(fileType, name, opts) {
    if (fileType === "txt") {
      var t = (opts.text || "").replace(/\r\n/g, "\n"), empty = t.trim() === "";
      return extractionOut(empty ? "failed" : "completed", t, empty ? ["El archivo de texto está vacío."] : [], chunkText(t),
                           empty ? "manual_description_needed" : "native_text", empty ? "low" : "high");
    }
    if (fileType === "pdf" && opts.bytes) {
      var txt = (await pdfText(opts.bytes)).replace(/[ \t]+/g, " ").trim();
      var letters = (txt.match(/[a-záéíóúñ]/gi) || []).length;
      if (letters >= 40) return extractionOut("completed", txt, [], chunkText(txt), "native_text", "high");
      return extractionOut("failed", "", ["Este PDF no tiene capa de texto (es un ESCANEADO de imágenes). Puede leerlo aquí mismo con el botón «Escanear con OCR» que aparece justo debajo (funciona en su navegador; el documento no se sube a ningún sitio) o pegar el texto a mano. No se inventa contenido (Regla 4)."], [], "manual_description_needed", "low");
    }
    if (fileType === "png" || fileType === "jpg" || fileType === "jpeg" || fileType === "pdf") {
      return extractionOut("failed", "", ["No puedo leer este archivo directamente y no se inventa contenido (Regla 4). Puede escanearlo aquí mismo con el botón «Escanear con OCR» que aparece justo debajo (en su navegador; no se sube a ningún sitio) o pegar el texto que contiene."], [], "manual_description_needed", "low");
    }
    if (fileType === "docx") {
      return extractionOut("failed", "", ["No puedo leer este DOCX aquí (sin descompresión de DOCX en modo offline). Pegue el texto del documento en el recuadro de abajo."], [], "manual_description_needed", "low");
    }
    return extractionOut("failed", "", ["Tipo de archivo no soportado: " + fileType], [], "manual_description_needed", "low");
  }

  // ---- Evaluador de Caso (Case Fit Grade) ----
  var EVAL_LIMIT = "Esta calificación no predice el resultado de un procedimiento y no constituye asesoramiento jurídico. Solo mide la alineación entre los hechos aportados y los criterios aprobados disponibles en el corpus cerrado.";
  var PREDICTION_REQUEST = [
    /\b(?:voy|vas?|vamos|van)\s+a\s+(?:ganar|perder|vencer|prosperar|triunfar)\b/i,
    /\bprobabilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b/i,
    /\bposibilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b/i,
    /\b(?:tengo|hay|tienes?|tenemos)\s+(?:buenas?\s+|muchas?\s+|pocas?\s+|algunas?\s+)?(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+de\s+(?:ganar|[ée]xito|vencer|prosperar)\b/i,
    /\bqu[ée]\s+(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?)\s+(?:tengo|hay|tienes?)/i,
    /\b(?:gano|gane|ganes|ganemos|ganen|ganar[ée]|ganar[áa]s?|ganar[áa]n|ganaremos|ganar[íi]a(?:s|mos|n)?|pierdo|pierdes|perder[ée]|perder[áa]s?|perder[íi]a|venzo|venza|vencer[ée]|vencer[áa]s?)\s+(?:el\s+|mi\s+|la\s+|este\s+|ese\s+)?(?:juicio|caso|pleito|litigio|demanda|recurso|asunto)\b/i,
    /\b(?:podr[íi]a?s?|podremos|podr[áa]n?)\s+(?:usted\s+)?(?:ganar|vencer|prosperar|tener\s+[ée]xito)\b/i,
    /\b(?:gana|perde|vence|prospera|triunfa)r(?:[ée]|[áa]s?|[áa]n|emos|[íi]as?|[íi]amos|[íi]an)\b/i,
    /\bes\s+probable\s+que\s+(?:\w+\s+){0,2}(?:gan|venz|prosper|triunf)/i,
    /\b(?:me\s+conviene|debo|deber[íi]a|me\s+recomiendas?)\s+(?:demandar|reclamar|denunciar|querellar|recurrir|interponer)/i,
    /\b(?:cu[áa]les?\s+son\s+)?(?:mis\s+)?(?:perspectivas|expectativas)\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|triunfo|del?\s+caso|del?\s+pleito)/i,
  ];
  function asksForPrediction(t) { var alt = deaccent(t); for (var i = 0; i < PREDICTION_REQUEST.length; i++) if (PREDICTION_REQUEST[i].test(t || "") || PREDICTION_REQUEST[i].test(alt)) return true; return false; }

  function runCaseEvaluation(description, asuntoHint, files) {
    var asunto = asuntoHint || "No estoy seguro";
    function notGraded(reason, facts, area, topic) {
      return { decision: "cannot_evaluate_case", case_fit_score: null, case_fit_grade: "insuficiente", score_label: "información insuficiente", confidence_level: "baja",
        case_summary: facts ? facts.case_summary : "", classified_area: area, classified_topic: topic, asunto_hint: asunto,
        favorable_factors: [], unfavorable_factors: [], uncertain_factors: [], missing_facts: facts ? facts.missing_facts : [],
        criteria_used: [], evidence_used: facts ? facts.evidence_items.map(function (e) { return e.filename + " (" + e.extraction_status + ")"; }) : [],
        limits: [EVAL_LIMIT], next_information_needed: facts ? facts.missing_facts : [], reason: reason, disclaimer: DISC };
    }
    if (asksForPrediction(description) || asksForPrediction(asunto)) return notGraded("Has pedido una predicción de resultado. Esta herramienta no predice quién gana ni el resultado de un litigio; solo mide la alineación de los hechos con los criterios aprobados. Reformula describiendo únicamente los hechos del caso.", null, null, null);
    var scope = classifyScope(description), facts = extractCaseFacts(description, files || []), retrieval = retrieve(scope);
    var sb = computeScoreboard(scope, facts, retrieval);
    if (!sb.computable) return notGraded(sb.reason || "No se puede calificar.", facts, scope.out_of_scope ? null : scope.area, scope.topic);
    var score = sb.case_fit_score, missingN = facts.missing_facts.length, grade, label;
    if (score >= 80 && missingN === 0) { grade = "A"; label = "alta alineación"; }
    else if (score >= 60) { grade = "B"; label = "alineación media"; }
    else if (score >= 40) { grade = "C"; label = "alineación media"; }
    else { grade = "D"; label = "baja alineación"; }
    var confMap = { bajo: "baja", medio: "media", alto: "alta" };
    var favorable = sb.favorable_factors.map(function (f) { return Object.assign({}, f, { explicacion: "El hecho aportado coincide con una condición que el criterio del corpus considera relevante para el análisis (no implica un resultado)." }); });
    var unfavorable = sb.unfavorable_factors.map(function (f) { return Object.assign({}, f, { explicacion: "Es una cuestión que el corpus aprobado NO resuelve, lo que limita la alineación; no implica un resultado adverso." }); });
    var uncertain = sb.uncertain_factors.map(function (u) { return Object.assign({}, u, { documents: facts.evidence_items.map(function (e) { return e.filename; }) }); });
    var result = { decision: "evaluate_case", case_fit_score: score, case_fit_grade: grade, score_label: label, confidence_level: confMap[sb.confidence_level] || "baja",
      case_summary: facts.case_summary, classified_area: scope.area, classified_topic: scope.topic, asunto_hint: asunto,
      favorable_factors: favorable, unfavorable_factors: unfavorable, uncertain_factors: uncertain, missing_facts: facts.missing_facts,
      criteria_used: sb.criteria_used, evidence_used: sb.evidence_used, limits: [EVAL_LIMIT].concat(sb.limits.slice(1)),
      next_information_needed: facts.missing_facts, reason: null, disclaimer: DISC };
    var all = favorable.concat(unfavorable).map(function (f) { return f.factor + " " + f.explicacion; }).concat(result.limits).concat([asunto]).join(" ");
    if (hasScoreboardForbidden(all)) return notGraded("El contenido no superó la comprobación de seguridad (Regla 18).", facts, scope.area, scope.topic);
    return result;
  }

  global.LLA = {
    runQuery: runQuery,
    readableCitation: readableCitation,
    extractCaseFacts: extractCaseFacts,
    runScoreboard: runScoreboard,
    runCaseEvaluation: runCaseEvaluation,
    asksForPrediction: asksForPrediction,
    extractFile: extractFile,
    hasForbidden: hasForbidden,
    hasScoreboardForbidden: hasScoreboardForbidden,
    classifyScope: classifyScope,
  };
})(window);
