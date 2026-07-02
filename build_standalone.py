#!/usr/bin/env python3
"""
build_standalone.py — Genera el HTML AUTÓNOMO de la VERSIÓN WEB (un solo archivo,
desplegable en Vercel/GitHub Pages; también abre en local). Todo corre en el
navegador del usuario: los documentos NO se suben a ningún servidor y viven solo
en la memoria de la pestaña (se borran al refrescar o cerrar; botón «quitar» para
borrado inmediato). Embebe el cerebro (demo/standalone_brain.js) y
los DATOS (léxico, checklists, criterios aprobados, resoluciones, avisos) leídos
de las MISMAS fuentes de verdad que usa el demo Python, para que no diverja.

Uso:  python3 demo/build_standalone.py   →  demo/locked-legal-advisor.html
"""
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))
import serve_demo as S  # noqa: E402

DATA = {
    "lexicon": S.LEXICON,
    "checklists": S.CHECKLISTS,
    "criteria": S.CORPUS,
    "judgmentIds": sorted(S.JUDGMENT_IDS),
    "disclaimer": {
        "short": S.SHORT_DISCLAIMER,
        "acceptance": S.ACCEPTANCE_TEXT,
        "banner": S.BANNER_DISCLAIMER,
        "short_en": S.SHORT_DISCLAIMER_EN,
        "acceptance_en": S.ACCEPTANCE_TEXT_EN,
        "banner_en": S.BANNER_DISCLAIMER_EN,
        "version": S.DISCLAIMER_VERSION,
    },
    "forbidden": S.FORBIDDEN_PATTERNS,
    "scoreboard_extra": S.SCOREBOARD_EXTRA,
    "scoreboard_limit": S.LIMIT_ES,
    "clarify_options": S.CLARIFY_OPTIONS,
    # Presentación EN (FUENTE ÚNICA = serve_demo / glossary.ts). Las fuentes,
    # citas y el texto de criterios NUNCA se traducen (Reglas 2/3/4/9).
    "area_en": S.AREA_EN,
    "topic_en": S.TOPIC_EN,
    "checklist_en": S.CHECKLIST_EN,
    "glossary": S.GLOSSARY,
    "notices": {
        "english_source": S.ENGLISH_SOURCE_NOTICE,
        "translation_doubt": S.TRANSLATION_DOUBT_NOTICE_EN,
    },
}

# Catálogo: árbol de materias + preguntas estándar servibles en su forma servida
# (pregunta, respuesta breve/completa, fuentes legibles, límites, aviso) — para
# que el catálogo funcione OFFLINE igual que en la app servida.
_cat_tree = S.catalog_tree()
_cat_qs = []
for _a in _cat_tree["areas"]:
    for _t in _a["topics"]:
        if _t["approved_count"] > 0:
            _cat_qs.extend(S.catalog_list(_a["area"], _t["topic"], "es"))
DATA["catalog"] = {"tree": _cat_tree, "questions": _cat_qs}

CSS = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")
CSS += "\n" + (ROOT / "frontend" / "evaluar.css").read_text(encoding="utf-8")
CSS += "\n" + (ROOT / "frontend" / "catalog.css").read_text(encoding="utf-8")
BRAIN = (ROOT / "demo" / "standalone_brain.js").read_text(encoding="utf-8")
# Favicon corporativo de ilpabogados.com embebido en base64 (un solo archivo).
# El logotipo de la cabecera/pie NO es una imagen: está recreado en HTML/CSS
# (clases .logo-caja / .logo-palabra) para que sea nítido a cualquier escala.
FAVICON_B64 = base64.b64encode((ROOT / "frontend" / "assets" / "favicon.png").read_bytes()).decode()
DATA_JSON = json.dumps(DATA, ensure_ascii=False).replace("</", "<\\/")

UI = r"""
(function () {
  "use strict";
  var V = LLA_DATA.disclaimer.version;
  var SESSION = { files: [] };
  // Intentos consecutivos sin respuesta de fondo (límite de 3 → derivar a ILP).
  // BASE = consulta original del formulario (una consulta NUEVA reinicia el contador:
  // la Regla 7 exige repreguntar ante cada consulta ambigua fresca). ULTIMA = texto
  // acumulado (consulta + aclaraciones), para que las respuestas NO se pierdan
  // entre rondas (espejo del patrón ultimaConsulta de la app servida).
  var SIN_RESPUESTA = 0, BASE = "", ULTIMA = "";

  // ---- Idioma (capa fina de presentación; el contenido jurídico NO se traduce) ----
  var LANG = (function () { try { return localStorage.getItem("lla:lang") === "en" ? "en" : "es"; } catch (e) { return "es"; } })();
  var T = {
    es: {
      escritorio: "Versión web", idioma: "Idioma:",
      kicker: "Marcas · Propiedad intelectual · Patentes · Procesal",
      heroH1: "Inteligencia que <em>entiende</em> tu caso.",
      subtituloHero: "Orientación basada en un corpus cerrado de criterios aprobados de resoluciones reales. Sus documentos se procesan en su navegador: no se guardan ni se suben a ningún servidor.",
      c1Titulo: "Preguntas estándar",
      c1P: "Catálogo navegable por materias —marcas, propiedad intelectual, patentes y procesal—. Cada pregunta tiene una respuesta validada de antemano, fiel a los criterios del corpus y con la resolución de la que procede.",
      c1Nota: "El camino rápido, predecible y de máxima fiabilidad.", c1Cta: "Abrir catálogo →",
      c2Titulo: "Pregunta específica",
      c2P: "Redacta tu propia consulta. Si es ambigua o mezcla materias, la herramienta <strong>repregunta</strong> para precisar; si es clara, ofrece una <strong>orientación</strong> construida solo con los criterios del corpus, citando su fuente.",
      c2Nota: "Lectura orientativa de criterios jurisprudenciales — nunca un dictamen ni una recomendación de actuación.", c2Cta: "Escribir consulta →",
      menuRotulo: "También:", menuAsistida: "Pregunta específica", menuCatalogo: "Catálogo", menuEvaluar: "Evaluar caso", menuScore: "Ver score de alineación",
      labelConsulta: "Escriba su consulta", phConsulta: "Ej.: Una empresa usa un logo parecido a mi marca registrada…",
      labelHechos: "Hechos o reporte del caso (opcional)", phHechos: "Pega aquí el reporte del caso…",
      labelMateriales: "Materiales del caso (archivos: PDF, DOCX, TXT, PNG, JPG, JPEG)", dropAyuda: "Arrastra aquí tus archivos o", examinar: "examinar…",
      notaEvidencia: "Evidencia del caso, no fuente jurídica. No constituye asesoramiento ni predice el resultado. Se procesa en tu navegador: no se sube a ningún servidor y se borra al refrescar o cerrar la página.",
      enviar: "Enviar consulta",
      etDecision: "Decisión del sistema", etArea: "Área detectada", etTema: "Tema detectado", etCriterios: "Criterios usados", etFuentes: "Fuentes usadas",
      labelAclaracion: "Responda a las preguntas anteriores", phAclaracion: "Añada aquí los datos que le piden…", enviarAclaracion: "Enviar respuesta",
      pieAviso: "Asesor informativo de marcas y propiedad intelectual. Responde solo con criterios aprobados de resoluciones reales, cita su fuente, declara sus límites y nunca predice el resultado. No es asesoramiento jurídico.",
      contacto: "Contacto", pieDir: "Paseo de la Castellana 120, 5º Izq.<br />28046 Madrid, España",
      pieLegal: "Versión web · Corpus cerrado · Los documentos del usuario se procesan en el navegador, no se suben a ningún servidor y se borran al salir · La aprobación de criterios es siempre un acto humano.",
      quitar: "quitar",
      titulos: { answer: "Orientación informativa", clarify: "Necesito algunas aclaraciones", out_of_scope: "Consulta fuera del corpus", insufficient_criteria: "Sin criterios aprobados suficientes" },
      limite: {
        titulo: "Su caso necesita la valoración de un profesional",
        texto: "Hemos hecho varios intentos y esta herramienta no ha logrado darle una orientación completa con el corpus disponible, así que no le hacemos más preguntas. Su caso tiene matices que conviene valorar con un abogado: contacte con ILP Abogados con el botón de abajo y el equipo le orientará."
      },
      respuesta: "Respuesta", verTodo: "Ver todo el texto", verTarjetas: "Ver en tarjetas",
      clarifyDefault: "Elija la opción que encaje con su caso:",
      cta: {
        titulo: "¿Su caso tiene más matices?", texto: "Esta orientación se basa en un corpus cerrado de resoluciones. Para resolver las dudas concretas de su caso, contacte con ILP Abogados.",
        tituloFuerte: "Su caso conviene valorarlo con un profesional", textoFuerte: "Su caso puede tener matices que el corpus no resuelve o quedar fuera de las resoluciones analizadas. Contacte con ILP Abogados para resolver sus dudas.",
        boton: "Contactar con ILP Abogados",
        emailAsunto: "Solicitud de servicios — ILP Abogados (marcas y propiedad intelectual)",
        emailCuerpo: "Estimado equipo de ILP Abogados:\n\nLes escribo a través de su Asesor Informativo. Me gustaría contar con sus servicios profesionales en materia de marcas y propiedad intelectual y recibir una valoración de mi caso.\n\nResumen de mi caso:\n\n\nDatos de contacto:\n- Nombre:\n- Teléfono:\n\nQuedo a la espera de su respuesta. Un cordial saludo."
      },
      gate: { titulo: "Antes de empezar", check: " He leído y acepto este aviso.", btn: "Acceder a la herramienta", version: "Versión del aviso: " },
      popup: { altoTit: "Para tu caso concreto, cuenta con ILP Abogados", altoTxt: "Esta herramienta solo orienta sobre el corpus: no valora tu caso ni anticipa ningún resultado. Para tu situación concreta, en ILP Abogados podemos orientarte: escríbenos.", bajoTit: "Tu caso conviene valorarlo con un profesional", bajoTxt: "Tu consulta queda en parte fuera de los criterios analizados, así que esta herramienta no alcanza a orientarte del todo. Para tu situación concreta, busca ayuda profesional en ILP Abogados.", aviso: "La alineación mide cuánto cubre el corpus tu caso; no es un pronóstico del resultado ni una recomendación de actuación.", boton: "Contactar con ILP Abogados" }
    },
    en: {
      escritorio: "Web version", idioma: "Language:",
      kicker: "Trademarks · Intellectual property · Patents · Procedure",
      heroH1: "Intelligence that <em>understands</em> your case.",
      subtituloHero: "Guidance based on a closed corpus of approved criteria from real court decisions. Your documents are processed in your browser: never stored, never uploaded to any server.",
      c1Titulo: "Standard questions",
      c1P: "Catalogue browsable by area —trademarks, intellectual property, patents and procedure—. Each question has a pre-validated answer, faithful to the corpus criteria and showing the decision it comes from.",
      c1Nota: "The fast, predictable, maximum-reliability path.", c1Cta: "Open catalogue →",
      c2Titulo: "Specific question",
      c2P: "Write your own query. If it is ambiguous or mixes areas, the tool <strong>asks back</strong> to narrow it down; if it is clear, it offers <strong>guidance</strong> built only from the corpus criteria, citing their source.",
      c2Nota: "Informational reading of case-law criteria — never an opinion or a recommendation to act.", c2Cta: "Write query →",
      menuRotulo: "Also:", menuAsistida: "Specific question", menuCatalogo: "Catalogue", menuEvaluar: "Evaluate case", menuScore: "View alignment score",
      labelConsulta: "Type your query", phConsulta: "E.g.: A company uses a logo similar to my registered trademark…",
      labelHechos: "Case facts or report (optional)", phHechos: "Paste the case report here…",
      labelMateriales: "Case materials (files: PDF, DOCX, TXT, PNG, JPG, JPEG)", dropAyuda: "Drag your files here or", examinar: "browse…",
      notaEvidencia: "Case evidence, not a legal source. It is not legal advice and does not predict the outcome. Processed in your browser: never uploaded to any server, and erased when you refresh or close the page.",
      enviar: "Send query",
      etDecision: "System decision", etArea: "Detected area", etTema: "Detected topic", etCriterios: "Criteria used", etFuentes: "Sources used",
      labelAclaracion: "Answer the questions above", phAclaracion: "Add here the details requested…", enviarAclaracion: "Send answer",
      pieAviso: "Informational advisor on trademarks and intellectual property. It answers only with approved criteria from real court decisions, cites its source, states its limits and never predicts the outcome. It is not legal advice.",
      contacto: "Contact", pieDir: "Paseo de la Castellana 120, 5º Izq.<br />28046 Madrid, Spain",
      pieLegal: "Web version · Closed corpus · Your documents are processed in the browser, never uploaded to any server and erased when you leave · Approving criteria is always a human act.",
      quitar: "remove",
      titulos: { answer: "Informational guidance", clarify: "I need some clarifications", out_of_scope: "Query outside the corpus", insufficient_criteria: "Not enough approved criteria" },
      limite: {
        titulo: "Your case needs a professional's assessment",
        texto: "After several attempts, this tool has not been able to give you complete guidance with the available corpus, so we will not ask you further questions. Your case has nuances best assessed by a lawyer: contact ILP Abogados with the button below and the team will guide you."
      },
      respuesta: "Response", verTodo: "Show full text", verTarjetas: "Show as cards",
      clarifyDefault: "Choose the option that fits your case:",
      cta: {
        titulo: "Does your case have further nuances?", texto: "This guidance is based on a closed corpus of decisions. To resolve the specific questions in your case, contact ILP Abogados.",
        tituloFuerte: "Your case is best assessed by a professional", textoFuerte: "Your case may involve nuances the corpus does not resolve, or fall outside the analysed decisions. Contact ILP Abogados to resolve your questions.",
        boton: "Contact ILP Abogados",
        emailAsunto: "Request for services — ILP Abogados (trademarks and IP)",
        emailCuerpo: "Dear ILP Abogados team,\n\nI am writing through your Informational Advisor. I would like to engage your professional services in trademark and intellectual property matters and receive an assessment of my case.\n\nSummary of my case:\n\n\nContact details:\n- Name:\n- Phone:\n\nI look forward to your reply. Best regards."
      },
      gate: { titulo: "Before you start", check: " I have read and accept this notice.", btn: "Enter the tool", version: "Notice version: " },
      popup: { altoTit: "For your specific case, count on ILP Abogados", altoTxt: "This tool only orients on the corpus: it does not assess your case or anticipate any outcome. For your specific situation, ILP Abogados can help — get in touch.", bajoTit: "Your case is best assessed by a professional", bajoTxt: "Your query falls partly outside the analysed criteria, so this tool cannot fully orient you. For your specific situation, seek professional help at ILP Abogados.", aviso: "Alignment measures how much the corpus covers your case — not the merits or outcome of any proceeding.", boton: "Contact ILP Abogados" }
    }
  };
  function tt() { return T[LANG] || T.es; }
  function setLang(l) { l = l === "en" ? "en" : "es"; try { localStorage.setItem("lla:lang", l); } catch (e) {} window.location.reload(); }
  function applyLang() {
    var t = tt();
    document.documentElement.lang = LANG;
    document.querySelectorAll("[data-i18n]").forEach(function (e) { var k = e.getAttribute("data-i18n"); if (t[k] != null) e.textContent = t[k]; });
    document.querySelectorAll("[data-i18n-html]").forEach(function (e) { var k = e.getAttribute("data-i18n-html"); if (t[k] != null) e.innerHTML = t[k]; });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (e) { var k = e.getAttribute("data-i18n-ph"); if (t[k] != null) e.setAttribute("placeholder", t[k]); });
    document.querySelectorAll("[data-disclaimer-banner]").forEach(function (b) { b.textContent = LANG === "en" ? (LLA_DATA.disclaimer.banner_en || LLA_DATA.disclaimer.banner) : LLA_DATA.disclaimer.banner; });
    var be = $("lang-es"), ben = $("lang-en"); if (be) be.className = "lang" + (LANG === "es" ? " activo" : ""); if (ben) ben.className = "lang" + (LANG === "en" ? " activo" : "");
    var pe = $("pie-email"); if (pe) pe.setAttribute("href", mailtoILP());
  }

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function $(id) { return document.getElementById(id); }
  function fuenteLegible(o) { return o.resolution || (o.source_reference + " (resolución " + o.judgment_id + ")"); }
  // Email-plantilla (ya redactado pidiendo sus servicios) para los botones de contacto.
  function mailtoILP() {
    var c = tt().cta;
    return "mailto:atencionalcliente@ilpabogados.com?subject=" + encodeURIComponent(c.emailAsunto) + "&body=" + encodeURIComponent(c.emailCuerpo);
  }
  function accepted() { try { return localStorage.getItem("lla:acc") === V; } catch (e) { return false; } }

  // ---- Gate de aceptación (offline) ----
  function gate() {
    if (accepted()) return;
    var g = tt().gate;
    var acc = LANG === "en" ? (LLA_DATA.disclaimer.acceptance_en || LLA_DATA.disclaimer.acceptance) : LLA_DATA.disclaimer.acceptance;
    var ov = el("div", "lla-gate");
    var card = el("div", "lla-gate-card");
    card.appendChild(el("h2", null, g.titulo));
    card.appendChild(el("p", "lla-gate-texto", acc));
    var label = el("label", "lla-gate-check");
    var chk = document.createElement("input"); chk.type = "checkbox"; label.appendChild(chk);
    label.appendChild(document.createTextNode(g.check));
    card.appendChild(label);
    var btn = el("button", null, g.btn); btn.disabled = true; card.appendChild(btn);
    card.appendChild(el("p", "lla-gate-version", g.version + V));
    chk.addEventListener("change", function () { btn.disabled = !chk.checked; });
    btn.addEventListener("click", function () { try { localStorage.setItem("lla:acc", V); } catch (e) {} ov.parentNode.removeChild(ov); });
    ov.appendChild(card); document.body.appendChild(ov);
  }

  function currentQuestion() {
    var c = $("consulta"), h = $("hechos");
    return [c ? c.value.trim() : "", h ? h.value.trim() : ""].filter(Boolean).join("\n\n");
  }

  // ---- Pregunta asistida (los títulos vienen del diccionario por idioma) ----

  // ---- Flashcards de la respuesta (carrusel; solo reorganiza la presentación) ----
  var FC = { cards: [], idx: 0 };
  function parseCards(text) {
    var t = (text || "").trim(); if (!t) return [];
    return t.split(/\n+(?=\d{1,2}\.\s)/).map(function (p) {
      var s = p.replace(/^\n+/, ""), nl = s.indexOf("\n");
      var first = nl >= 0 ? s.slice(0, nl).trim() : s.trim();
      var m = first.match(/^(\d{1,2})\.\s*(.*)$/);
      if (m) return { num: m[1], title: m[2], body: nl >= 0 ? s.slice(nl + 1) : "" };
      return { num: "", title: "", body: s };
    });
  }
  function fcGoTo(i, instant) {
    var cards = FC.cards; if (!cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i)); FC.idx = i;
    var track = $("fc-track"); if (!track) return;
    if (instant) track.style.transition = "none";
    track.style.transform = "translateX(" + (-i * 100) + "%)";
    if (instant) { void track.offsetWidth; track.style.transition = ""; }
    var active = track.children[i], vp = track.parentElement;
    if (active && vp && active.offsetHeight) vp.style.height = active.offsetHeight + "px";
    var dots = $("fc-dots"); if (dots) for (var k = 0; k < dots.children.length; k++) dots.children[k].classList.toggle("activo", k === i);
    var count = $("fc-count"); if (count) count.textContent = (i + 1) + " / " + cards.length;
    var fc = $("flashcards"), prev = fc && fc.querySelector(".fc-prev"), next = fc && fc.querySelector(".fc-next");
    if (prev) prev.disabled = i === 0; if (next) next.disabled = i === cards.length - 1;
  }
  // Presentación LEGIBLE del cuerpo de una tarjeta (solo tipografía; el contenido
  // es VERBATIM, Regla 4). Destaca el TÍTULO del criterio en los ítems
  // "• [crit-id] Título: texto" y atenúa la línea "Fuente:". Si una línea no
  // encaja en ese patrón, se muestra tal cual (sin transformar).
  function fcBody(text) {
    var raw = String(text == null ? "" : text).replace(/\s+$/, "");
    var box = el("div", "fc-body fc-fmt");
    var lines = raw.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.trim()) continue;
      var m = ln.match(/^\s*•\s*\[([^\]]+)\]\s*([^:]{3,110}):\s*(.*)$/);
      if (m) {
        var item = el("div", "fc-item");
        var head = el("p", "fc-item-head");
        head.appendChild(el("strong", "crit-tit", m[2].trim()));
        head.appendChild(el("span", "crit-id", " · " + m[1]));
        item.appendChild(head);
        if (m[3]) item.appendChild(el("p", "fc-item-txt", m[3]));
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*•/.test(lines[i + 1])) {
          i++;
          var cont = lines[i].trim();
          item.appendChild(el("p", /^(Fuente|Source)/.test(cont) ? "fc-fuente" : "fc-item-txt", cont));
        }
        box.appendChild(item);
      } else {
        var lnT = ln.trim();
        var cls = /^\s*•/.test(ln) ? "fc-bullet" : (/^(Fuente:|Source \(in Spanish\):|Source:)/.test(lnT) ? "fc-fuente" : "fc-par");
        box.appendChild(el("p", cls, lnT));
      }
    }
    if (!box.childNodes.length) { box.className = "fc-body"; box.textContent = raw; }
    return box;
  }
  function renderFlashcards(text) {
    var fc = $("flashcards"); if (!fc) return false;
    var cards = parseCards(text); FC.cards = cards; FC.idx = 0; fc.textContent = "";
    if (!cards.length) { fc.classList.add("oculto"); return false; }
    var vp = el("div", "fc-viewport"), track = el("div", "fc-track"); track.id = "fc-track";
    cards.forEach(function (c) {
      var card = el("article", "fc-card");
      if (c.title) { var head = el("div", "fc-card-head"); if (c.num) head.appendChild(el("span", "fc-num", c.num)); head.appendChild(el("h3", "fc-title", c.title)); card.appendChild(head); }
      card.appendChild(fcBody(c.body)); track.appendChild(card);
    });
    vp.appendChild(track); fc.appendChild(vp);
    if (cards.length > 1) {
      var nav = el("div", "fc-nav");
      var prev = el("button", "fc-btn fc-prev", "‹"); prev.type = "button"; prev.setAttribute("aria-label", "Tarjeta anterior"); prev.addEventListener("click", function () { fcGoTo(FC.idx - 1); });
      var dots = el("span", "fc-dots"); dots.id = "fc-dots";
      cards.forEach(function (_, i) { var d = el("button", "fc-dot"); d.type = "button"; d.setAttribute("aria-label", "Ir a la tarjeta " + (i + 1)); d.addEventListener("click", function () { fcGoTo(i); }); dots.appendChild(d); });
      var count = el("span", "fc-count"); count.id = "fc-count";
      var next = el("button", "fc-btn fc-next", "›"); next.type = "button"; next.setAttribute("aria-label", "Tarjeta siguiente"); next.addEventListener("click", function () { fcGoTo(FC.idx + 1); });
      nav.appendChild(prev); nav.appendChild(dots); nav.appendChild(count); nav.appendChild(next); fc.appendChild(nav);
    }
    var x0 = null;
    vp.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    vp.addEventListener("touchend", function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) fcGoTo(FC.idx + (dx < 0 ? 1 : -1)); x0 = null; }, { passive: true });
    fc.classList.remove("oculto"); fcGoTo(0, true);
    // Re-medir cuando terminen de cargar las webfonts (el font-swap cambia la altura).
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(function () { fcGoTo(FC.idx, true); });
    return true;
  }
  document.addEventListener("keydown", function (e) {
    var fc = $("flashcards"); if (!fc || fc.classList.contains("oculto")) return;
    var tag = (document.activeElement && document.activeElement.tagName) || ""; if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === "ArrowRight") { fcGoTo(FC.idx + 1); e.preventDefault(); } else if (e.key === "ArrowLeft") { fcGoTo(FC.idx - 1); e.preventDefault(); }
  });
  // Re-medir la tarjeta activa al redimensionar (la altura fija recortaría el texto).
  window.addEventListener("resize", function () { fcGoTo(FC.idx, true); });

  function pintar(r) {
    var a = r.answer, scope = r.scope, esFondo = a.decision === "answer";
    // Límite de interacciones (petición del despacho): tras 3 intentos seguidos sin
    // respuesta de fondo, la herramienta deja de repreguntar y deriva a ILP Abogados.
    // Es una política de PRESENTACIÓN (deny-by-default hacia el profesional, Regla 17);
    // el motor y su decisión no cambian. Los fallos técnicos (_tecnico) no cuentan.
    var tecnico = !!r._tecnico;
    if (esFondo) { SIN_RESPUESTA = 0; } else if (!tecnico) { SIN_RESPUESTA += 1; }
    var limite = !esFondo && !tecnico && SIN_RESPUESTA >= 3;
    $("decision").textContent = a.decision; $("decision").className = "valor badge " + a.decision;
    $("area").textContent = scope.area ? (LANG === "en" ? (LLA_DATA.area_en[scope.area] || scope.area) : scope.area) : "—";
    $("tema").textContent = scope.topic ? (LANG === "en" ? (LLA_DATA.topic_en[scope.topic] || scope.topic) : scope.topic) : "—";
    $("criterios").textContent = esFondo && a.criteria_used.length ? a.criteria_used.join(", ") : "—";
    if (esFondo && a.sources_used.length) { var nn = [], vs = {}; a.sources_used.forEach(function (s) { var n = s.resolution || (s.criterion_id + " → " + s.judgment_id); if (!vs[n]) { vs[n] = 1; nn.push(n); } }); $("fuentes").textContent = nn.join("; "); } else $("fuentes").textContent = "—";
    $("titulo-respuesta").textContent = limite ? tt().limite.titulo : (tt().titulos[a.decision] || tt().respuesta);
    $("texto-respuesta").textContent = limite ? tt().limite.texto : a.answer_text;
    $("texto-respuesta").classList.add("oculto");
    $("aviso-respuesta").textContent = a.disclaimer;
    renderClarifyOpts(!limite && a.decision === "clarify" ? r.clarify_options : null);
    var fa = $("form-aclaracion");
    if (!limite && a.decision === "clarify") { $("aclaracion").value = ""; fa.classList.remove("oculto"); } else fa.classList.add("oculto");
    var cta = $("cta-ilp");
    if (cta) {
      var fuerte = limite || a.decision === "out_of_scope" || a.decision === "insufficient_criteria" || a.decision === "clarify";
      var ctaT = tt().cta;
      $("cta-ilp-titulo").textContent = fuerte ? ctaT.tituloFuerte : ctaT.titulo;
      $("cta-ilp-texto").textContent = fuerte ? ctaT.textoFuerte : ctaT.texto;
      $("cta-ilp-email").textContent = ctaT.boton;
      if (fuerte) cta.classList.add("fuerte"); else cta.classList.remove("fuerte");
      var ctaEmail = $("cta-ilp-email"); if (ctaEmail) ctaEmail.setAttribute("href", mailtoILP());
      cta.classList.remove("oculto");
    }
    $("resultado").classList.remove("oculto");
    var hayCards = !limite && renderFlashcards(a.answer_text), tg = $("toggle-texto");
    if (limite) { var fc = $("flashcards"); if (fc) { fc.textContent = ""; fc.classList.add("oculto"); } }
    if (tg) { if (hayCards) { $("texto-respuesta").classList.add("oculto"); tg.textContent = tt().verTodo; tg.classList.remove("oculto"); } else { $("texto-respuesta").classList.remove("oculto"); tg.classList.add("oculto"); } }
    // La vista aterriza al INICIO de la respuesta, no en el CTA del final.
    // setTimeout(0), NO requestAnimationFrame: rAF no dispara nunca en pestañas
    // en segundo plano (el usuario cambiaría de pestaña y no habría scroll).
    // Instantáneo tras asentarse el layout: el scroll suave lo cancelan los
    // ajustes de altura de las tarjetas.
    setTimeout(function () { $("resultado").scrollIntoView({ block: "start" }); }, 0);
  }
  function renderClarifyOpts(groups) {
    var cont = $("clarify-options"); if (!cont) return;
    cont.textContent = "";
    if (!groups || !groups.length) { cont.classList.add("oculto"); return; }
    groups.forEach(function (g) {
      var blk = el("div", "clarify-group");
      var q = el("p", "clarify-q", g.question || tt().clarifyDefault); blk.appendChild(q);
      var row = el("div", "clarify-opts");
      (g.options || []).forEach(function (o) {
        var b = document.createElement("button"); b.type = "button"; b.className = "opt-btn"; b.textContent = o.label;
        b.addEventListener("click", function () { enviar((ULTIMA || currentQuestion()) + "\n" + (o.adds || o.label)); });
        row.appendChild(b);
      });
      blk.appendChild(row); cont.appendChild(blk);
    });
    cont.classList.remove("oculto");
  }
  function enviar(texto) {
    ULTIMA = texto;
    try { pintar(LLA.runQuery(texto, LANG)); }
    catch (e) {
      // _tecnico: los fallos técnicos NO cuentan para el límite de 3 intentos
      // (el mensaje de derivación no debe enmascarar una avería).
      pintar({ _tecnico: true, scope: { area: null, topic: null }, answer: { decision: "insufficient_criteria", answer_text: LANG === "en" ? "Technical error; for safety, no substantive guidance is offered." : "Error técnico; por seguridad no se ofrece orientación de fondo.", criteria_used: [], sources_used: [], disclaimer: LANG === "en" ? (LLA_DATA.disclaimer.short_en || LLA_DATA.disclaimer.short) : LLA_DATA.disclaimer.short } });
    }
  }

  // ---- Materiales del caso ----
  function rid() { return "upl-" + Math.random().toString(36).slice(2); }
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; }
  // Botón «quitar»: elimina el documento de la memoria de la sesión al instante.
  // Los documentos NUNCA se guardan: viven solo en esta pestaña (memoria JS) y
  // se borran también al refrescar o cerrar la página. Helper con parámetros
  // para capturar el registro correcto (el bucle usa var + await).
  function quitarBtn(rec, li) {
    var b = el("button", "enlace quitar-doc", tt().quitar); b.type = "button";
    b.addEventListener("click", function () {
      var ix = SESSION.files.indexOf(rec); if (ix >= 0) SESSION.files.splice(ix, 1);
      if (li.parentNode) li.parentNode.removeChild(li);
      var panel = $("hechos-detectados");
      if (!SESSION.files.length) { panel.textContent = ""; panel.classList.add("oculto"); }
      else renderFacts(SESSION.files[SESSION.files.length - 1]);
    });
    return b;
  }
  async function handleFiles(list) {
    var allowed = ["pdf", "docx", "txt", "png", "jpg", "jpeg"], lista = $("lista-materiales");
    for (var i = 0; i < list.length; i++) {
      var file = list[i], ext = extOf(file.name);
      if (allowed.indexOf(ext) < 0) { lista.appendChild(el("li", "mal", "✗ " + file.name + " (tipo no admitido)")); continue; }
      var item = el("li", "cargando", "⏳ " + file.name); lista.appendChild(item);
      var opts = {};
      try {
        if (ext === "txt") opts.text = await file.text();
        else opts.bytes = new Uint8Array(await file.arrayBuffer());
        var ex = await LLA.extractFile(ext, file.name, opts);
        var f = { id: rid(), original_filename: file.name, file_type: ext, upload_type: "case_material", extraction_status: ex.status, extracted_text: ex.text, warnings: ex.warnings, source_locations: ex.source_locations, _file: file };
        SESSION.files.push(f);
        item.className = "ok"; item.textContent = "✓ " + file.name + " (" + ex.status + ") ";
        item.appendChild(quitarBtn(f, item));
        renderFacts(f);
      } catch (e) { item.className = "mal"; item.textContent = "✗ " + file.name + " (error al leer)"; }
    }
  }
  function renderFacts(f) {
    var facts = LLA.extractCaseFacts(currentQuestion(), SESSION.files);
    var panel = $("hechos-detectados"); panel.textContent = ""; panel.classList.remove("oculto");
    (f.warnings || []).forEach(function (w) { panel.appendChild(el("p", "warning-item", "⚠ " + w)); });
    // El botón de OCR va JUSTO debajo del aviso que lo anuncia (no al final del panel).
    var conOCR = f.extraction_status !== "completed" && f._file && ["png", "jpg", "jpeg", "pdf"].indexOf(f.file_type) >= 0;
    if (conOCR) panel.appendChild(ocrBox(f));
    panel.appendChild(el("p", "resumen", facts.case_summary));
    if (facts.relevant_facts.length) {
      panel.appendChild(el("h3", null, "Hechos detectados (evidencia, trazados al documento)"));
      var ul = el("ul", "hechos-lista");
      facts.relevant_facts.forEach(function (rf) { var li = el("li", null); li.appendChild(el("span", "hecho-txt", rf.fact_text)); li.appendChild(el("span", "hecho-fuente", " — " + rf.source_filename + " (" + rf.page_or_location + "), confianza " + rf.confidence)); ul.appendChild(li); });
      panel.appendChild(ul);
    }
    if (facts.missing_facts.length) { panel.appendChild(el("h3", null, "Datos esenciales que faltan")); var um = el("ul", "faltan-lista"); facts.missing_facts.forEach(function (m) { um.appendChild(el("li", null, m)); }); panel.appendChild(um); }
    facts.uncertainties.forEach(function (u) { panel.appendChild(el("p", "warning-item", "⚠ " + u)); });
    if (f.extraction_status !== "completed") {
      panel.appendChild(pasteBox());
    }
    panel.appendChild(el("p", "aviso-item", "Esto es evidencia del caso, no fuente jurídica, no asesoramiento y no predice el resultado. Se compara con los criterios aprobados del corpus."));
  }
  function pasteBox() {
    var box = el("div", "paste-fallback");
    box.appendChild(el("label", null, "¿No se pudo leer? Pega aquí el texto del documento:"));
    var ta = document.createElement("textarea"); ta.rows = 4; ta.placeholder = "Transcribe o pega el texto del documento…"; box.appendChild(ta);
    var b = el("button", "enlace", "Procesar texto pegado"); b.type = "button";
    b.addEventListener("click", function () { var t = ta.value.trim(); if (!t) return; var f = { id: rid(), original_filename: "texto-pegado.txt", file_type: "txt", upload_type: "case_material", extraction_status: "completed", extracted_text: t, warnings: [], source_locations: [{ fragment_id: "frag-001", page: null, section: null, char_start: 0, char_end: t.length }] }; SESSION.files.push(f); renderFacts(f); });
    box.appendChild(b); return box;
  }

  // ---- OCR en el navegador (Tesseract.js + pdf.js, carga PEREZOSA desde CDN) ----
  // El documento NO se sube a ningún sitio: el reconocimiento corre en LOCAL, en
  // tu navegador. El razonamiento jurídico sigue siendo solo del corpus (esto solo
  // pasa de imagen a texto, igual que pegarlo a mano).
  var _tess = null, _pdfjs = null;
  function loadScript(src) { return new Promise(function (ok, err) { var s = document.createElement("script"); s.src = src; s.onload = function () { ok(); }; s.onerror = function () { err(new Error("no se pudo cargar el motor (¿sin conexión?)")); }; document.head.appendChild(s); }); }
  function loadTesseract() { if (!_tess) _tess = loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js").then(function () { return window.Tesseract; }); return _tess; }
  function loadPdfjs() { if (!_pdfjs) _pdfjs = loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js").then(function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"; return window.pdfjsLib; }); return _pdfjs; }
  async function runOCR(f, prog) {
    var T = await loadTesseract();
    var logger = function (m) { if (m.status === "recognizing text") prog.textContent = "Reconociendo texto… " + Math.round((m.progress || 0) * 100) + "%"; };
    if (f.file_type === "pdf") {
      var pdfjs = await loadPdfjs();
      var bytes = new Uint8Array(await f._file.arrayBuffer());
      var pdf = await pdfjs.getDocument({ data: bytes }).promise;
      var total = pdf.numPages, n = Math.min(total, 20), out = [];
      for (var p = 1; p <= n; p++) {
        prog.textContent = "OCR página " + p + " de " + n + "…";
        var page = await pdf.getPage(p);
        var vp = page.getViewport({ scale: 2 });
        var cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        var r = await T.recognize(cv, "spa", { logger: logger });
        out.push(r.data.text);
      }
      return { text: out.join("\n\n"), truncated: total > n, total: total, processed: n };
    }
    var ri = await T.recognize(f._file, "spa", { logger: logger });
    return { text: ri.data.text, truncated: false };
  }
  function ocrBox(f) {
    var box = el("div", "paste-fallback");
    box.appendChild(el("label", null, "¿Es un escaneo o una imagen? Léelo aquí mismo con OCR (en tu navegador; el documento NO se sube a ningún sitio; la primera vez descarga el motor y necesita internet):"));
    var b = el("button", "enlace", "Escanear con OCR"); b.type = "button";
    var prog = el("p", "ocr-prog", "");
    b.addEventListener("click", async function () {
      b.disabled = true; prog.textContent = "Cargando el motor OCR (la primera vez ~15 MB)…";
      try {
        var res = await runOCR(f, prog);
        var text = res && res.text;
        if (text && text.replace(/\s+/g, "").length > 10) {
          f.extracted_text = text.trim(); f.extraction_status = "completed";
          f.warnings = ["Texto extraído por OCR en el navegador (puede contener errores de reconocimiento)."];
          if (res.truncated) f.warnings.push("El documento tiene " + res.total + " páginas; el OCR procesó solo las primeras " + res.processed + ". Para el resto, súbelas aparte o pega el texto.");
          f.source_locations = [{ fragment_id: "frag-001", page: null, section: null, char_start: 0, char_end: text.length }];
          renderFacts(f);
        } else { prog.textContent = "El OCR no encontró texto legible. Prueba a pegar el texto abajo."; b.disabled = false; }
      } catch (e) { prog.textContent = "✗ " + (e.message || "no se pudo hacer OCR"); b.disabled = false; }
    });
    box.appendChild(b); box.appendChild(prog); return box;
  }

  // ---- Scoreboard ----
  function factorLine(fc) { var li = el("li", null); li.appendChild(el("span", "f-txt", fc.factor)); var s = " — criterio " + fc.criterion_id + " · fuente " + fuenteLegible(fc); if (fc.evidence && fc.evidence !== "—") s += " · evidencia: " + fc.evidence; li.appendChild(el("span", "f-fuente", s)); return li; }
  // Pop-up del score de ALINEACIÓN según umbral (≥70 / <70). Ambos promueven
  // consultar con ILP (Reglas 11-12); NO es pronóstico ni recomendación de litigar
  // (Regla 18): por eso ningún texto dice "ganar" ni "litigar".
  function mostrarPopupScore(score) {
    var ov = $("popup-score"); if (!ov || score == null) return;
    var alto = score >= 70, p = tt().popup;
    $("popup-score-titulo").textContent = alto ? p.altoTit : p.bajoTit;
    $("popup-score-texto").textContent = alto ? p.altoTxt : p.bajoTxt;
    $("popup-score-aviso").textContent = p.aviso;
    var em = $("popup-score-email"); if (em) { em.textContent = p.boton; em.setAttribute("href", mailtoILP()); }
    ov.classList.remove("oculto");
  }

  function renderScore(sb) {
    var panel = $("scoreboard"); panel.textContent = ""; panel.classList.remove("oculto");
    panel.appendChild(el("h2", null, "Score de alineación con criterios del corpus"));
    if (!sb.computable) { panel.appendChild(el("p", "sb-reason", "No se puede generar el score: " + (sb.reason || "datos insuficientes") + ".")); if (sb.next_information_needed.length) { panel.appendChild(el("h3", null, "Información necesaria")); var u0 = el("ul", "factores"); sb.next_information_needed.forEach(function (m) { u0.appendChild(el("li", null, m)); }); panel.appendChild(u0); } panel.appendChild(el("p", "aviso-item", sb.limits[0] || "")); panel.appendChild(el("p", "aviso-item", sb.disclaimer)); return; }
    var head = el("div", "sb-head"); head.appendChild(el("div", "sb-num", sb.case_fit_score + "/100")); head.appendChild(el("div", "sb-label", "Alineación con criterios del corpus: " + sb.score_label.toUpperCase() + " · Confianza: " + sb.confidence_level)); panel.appendChild(head);
    var bar = el("div", "sb-bar"); var fill = el("div", "sb-fill"); fill.style.width = sb.case_fit_score + "%"; bar.appendChild(fill); panel.appendChild(bar);
    function sec(t, arr) { if (!arr.length) return; panel.appendChild(el("h3", null, t)); var ul = el("ul", "factores"); arr.forEach(function (fc) { ul.appendChild(factorLine(fc)); }); panel.appendChild(ul); }
    sec("Factores favorables (hechos alineados con criterios)", sb.favorable_factors);
    sec("Factores desfavorables (cuestiones que el corpus no resuelve)", sb.unfavorable_factors);
    if (sb.uncertain_factors.length) { panel.appendChild(el("h3", null, "Factores inciertos")); var ui = el("ul", "factores"); sb.uncertain_factors.forEach(function (fc) { var li = el("li", null); li.appendChild(el("span", "f-txt", fc.factor)); li.appendChild(el("span", "f-fuente", " — " + fc.why_it_matters + " Falta: " + fc.what_is_missing)); ui.appendChild(li); }); panel.appendChild(ui); }
    if (sb.missing_facts.length) { panel.appendChild(el("h3", null, "Información faltante")); var um = el("ul", "factores"); sb.missing_facts.forEach(function (m) { um.appendChild(el("li", null, m)); }); panel.appendChild(um); }
    panel.appendChild(el("h3", null, "Criterios usados y fuentes")); var uc = el("ul", "factores"); sb.criteria_used.forEach(function (c) { uc.appendChild(el("li", null, c.criterion_id + " · " + fuenteLegible(c))); }); panel.appendChild(uc);
    if (sb.evidence_used.length) panel.appendChild(el("p", "sb-ev", "Documentos del usuario usados: " + sb.evidence_used.join(", ")));
    panel.appendChild(el("h3", null, "Límites")); var ulm = el("ul", "factores"); sb.limits.forEach(function (l) { ulm.appendChild(el("li", null, l)); }); panel.appendChild(ulm);
    panel.appendChild(el("p", "aviso-item", sb.disclaimer));
    mostrarPopupScore(sb.case_fit_score);
  }

  // ---- wiring ----
  document.addEventListener("DOMContentLoaded", function () {
    gate();
    applyLang();
    var be = $("lang-es"), ben = $("lang-en");
    if (be) be.addEventListener("click", function () { if (LANG !== "es") setLang("es"); });
    if (ben) ben.addEventListener("click", function () { if (LANG !== "en") setLang("en"); });
    $("formulario").addEventListener("submit", function (e) {
      e.preventDefault(); var t = currentQuestion(); if (!t) return;
      // Consulta NUEVA → contador de intentos a cero (Regla 7: cada consulta
      // fresca tiene derecho a sus preguntas de aclaración).
      if (t !== BASE) { BASE = t; SIN_RESPUESTA = 0; }
      enviar(t);
    });
    // Las aclaraciones se ACUMULAN sobre el texto anterior (ULTIMA), no sobre el
    // formulario: así lo ya contestado no se pierde entre rondas.
    $("form-aclaracion").addEventListener("submit", function (e) { e.preventDefault(); var r = $("aclaracion").value.trim(); if (!r) return; enviar((ULTIMA || currentQuestion()) + "\n" + r); });
    var tg = $("toggle-texto"); if (tg) tg.addEventListener("click", function () { var pre = $("texto-respuesta"), fc = $("flashcards"), full = pre.classList.contains("oculto"); if (full) { pre.classList.remove("oculto"); if (fc) fc.classList.add("oculto"); tg.textContent = tt().verTarjetas; } else { pre.classList.add("oculto"); if (fc) fc.classList.remove("oculto"); tg.textContent = tt().verTodo; fcGoTo(FC.idx); } });
    var ovsc = $("popup-score"); if (ovsc) { var xb = $("popup-score-cerrar"); var cerrar = function () { ovsc.classList.add("oculto"); }; if (xb) xb.addEventListener("click", cerrar); ovsc.addEventListener("click", function (e) { if (e.target === ovsc) cerrar(); }); document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(); }); }
    var zona = $("zona-materiales"), inp = $("archivo-materiales");
    ["dragenter", "dragover"].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("arrastrando"); }); });
    ["dragleave", "dragend", "drop"].forEach(function (ev) { zona.addEventListener(ev, function () { zona.classList.remove("arrastrando"); }); });
    zona.addEventListener("drop", function (e) { e.preventDefault(); handleFiles(e.dataTransfer.files); });
    $("examinar-materiales").addEventListener("click", function () { inp.click(); });
    inp.addEventListener("change", function () { handleFiles(inp.files); inp.value = ""; });
    $("menu-scoreboard").addEventListener("click", function () { var q = currentQuestion(); var panel = $("scoreboard"); panel.classList.remove("oculto"); if (!q) { panel.textContent = ""; panel.appendChild(el("p", "sb-reason", "Escribe tu consulta (y, si quieres, sube materiales) antes de ver el score.")); return; } renderScore(LLA.runScoreboard(q, SESSION.files)); panel.scrollIntoView({ block: "start" }); });

    // ---- vistas: asistida / catalogo / evaluar ----
    var VIEWS = { asistida: $("view-asistida"), catalogo: $("view-catalogo"), evaluar: $("view-evaluar") };
    function showView(v) {
      Object.keys(VIEWS).forEach(function (k) { if (VIEWS[k]) VIEWS[k].classList.toggle("oculto", k !== v); });
      document.querySelectorAll(".menu-item[data-view]").forEach(function (x) { x.classList.toggle("activo", x.getAttribute("data-view") === v); });
      if (v === "catalogo") {
        catRenderNav();
        // Portada del catálogo: donut de materias mientras no haya tema elegido.
        if (!$("navegacion").querySelector("li.activo")) catVisualGeneral();
      }
    }
    document.querySelectorAll(".menu-item[data-view]").forEach(function (b) { b.addEventListener("click", function () { showView(b.getAttribute("data-view")); }); });
    $("menu-scoreboard").addEventListener("click", function () { showView("asistida"); });
    var irCat = $("ir-catalogo"); if (irCat) irCat.addEventListener("click", function () { showView("catalogo"); $("view-catalogo").scrollIntoView({ block: "start" }); });
    var irAsi = $("ir-asistida"); if (irAsi) irAsi.addEventListener("click", function () { showView("asistida"); $("formulario").scrollIntoView({ block: "start" }); });

    // ---- Catálogo (offline, datos embebidos en LLA_DATA.catalog) ----
    var CAT = (window.LLA_DATA && window.LLA_DATA.catalog) || { tree: { areas: [] }, questions: [] };
    function catBy(area, topic) { return CAT.questions.filter(function (q) { return q.area === area && q.topic === topic; }); }
    function catById(id) { return CAT.questions.filter(function (q) { return q.id === id; })[0]; }
    function catRenderNav() {
      var nav = $("navegacion"); if (!nav || nav.getAttribute("data-listo")) return;
      nav.textContent = ""; nav.setAttribute("data-listo", "1");
      (CAT.tree.areas || []).forEach(function (a) {
        var area = el("div", "area"); area.appendChild(el("div", "titulo", a.area));
        var ul = el("ul", "temas");
        a.topics.forEach(function (t) {
          var li = el("li", t.approved_count > 0 ? "" : "sin-preguntas");
          li.appendChild(el("span", null, t.topic)); li.appendChild(el("span", "conteo", String(t.approved_count)));
          if (t.approved_count > 0) li.addEventListener("click", (function (ar, tp, node) { return function () { catSelect(ar, tp, node); }; })(a.area, t.topic, li));
          ul.appendChild(li);
        });
        area.appendChild(ul); nav.appendChild(area);
      });
    }
    function catSelect(area, topic, li) {
      var nav = $("navegacion"); var act = nav.querySelectorAll("li.activo"); for (var i = 0; i < act.length; i++) act[i].classList.remove("activo");
      if (li) li.classList.add("activo");
      $("detalle-pregunta").classList.add("oculto"); $("lista-preguntas").classList.remove("oculto");
      var items = catBy(area, topic);
      catRenderList(items);
      catVisual(topic, items);
    }
    // ---- Panorama visual del tema (SOLO metadatos del corpus: recuento de
    // criterios, órgano de origen de cada resolución y años; presentación
    // decorativa sin contenido jurídico nuevo — Regla 4). ----
    function catCourtOf(nombre) {
      if (/Tribunal de Justicia de la UE/.test(nombre)) return "Tribunal de Justicia de la UE";
      if (/Tribunal Supremo/.test(nombre)) return "Tribunal Supremo";
      if (/Audiencia Provincial/.test(nombre)) return "Audiencias Provinciales";
      if (/Juzgado de lo Mercantil/.test(nombre)) return "Juzgados de lo Mercantil";
      if (/Tribunal Superior de Justicia/.test(nombre)) return "Tribunales Superiores de Justicia";
      if (/Audiencia Nacional/.test(nombre)) return "Audiencia Nacional";
      return "Otras resoluciones";
    }
    // Portada del catálogo: donut con el reparto de criterios aprobados por
    // materia + totales del corpus (mismos metadatos; nada inventado).
    var CAT_AREAS = { marcas: "Marcas", propiedad_intelectual: "Propiedad intelectual", patentes: "Patentes", procesal: "Procesal" };
    var CAT_COLORES = ["#c5a55a", "#0f1e35", "#8a6a3f", "#9aa7bd", "#d4ba7a", "#6b6b76"];
    function catVisualGeneral() {
      var box = $("cat-visual"); if (!box) return;
      box.textContent = ""; box.classList.add("oculto");
      var crits = window.LLA_DATA.criteria || [];
      if (!crits.length) return;
      var porArea = {}, seenJ = {}, nRes = 0, years = [];
      crits.forEach(function (c) {
        var a = CAT_AREAS[c.area] || c.area;
        porArea[a] = (porArea[a] || 0) + 1;
        var j = c.judgment_id || c.source_reference || c.id;
        if (!seenJ[j]) {
          seenJ[j] = 1; nRes++;
          var nombre = LLA.readableCitation ? LLA.readableCitation(c) : String(c.source_reference || j);
          var m = String(nombre + " " + j).match(/(19|20)\d{2}/g);
          if (m) years.push(parseInt(m[m.length - 1], 10));
        }
      });
      box.appendChild(el("h3", null, "Panorama del corpus"));
      var tiles = el("div", "cv-tiles");
      function tile(num, label) { var t = el("div", "cv-tile"); t.appendChild(el("span", "cv-num", String(num))); t.appendChild(el("span", "cv-label", label)); tiles.appendChild(t); }
      var mn = years.length ? Math.min.apply(null, years) : null, mx = years.length ? Math.max.apply(null, years) : null;
      tile(crits.length, "criterios aprobados");
      tile(nRes, "resoluciones citadas");
      tile(years.length ? (mn === mx ? String(mn) : mn + "–" + mx) : "—", "periodo");
      box.appendChild(tiles);
      // Donut SVG (segmentos con pathLength=100) + leyenda
      var areas = Object.keys(porArea).sort(function (a, b) { return porArea[b] - porArea[a]; });
      var total = crits.length, NS = "http://www.w3.org/2000/svg";
      var wrap = el("div", "cv-donut-wrap");
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("class", "cv-donut"); svg.setAttribute("aria-hidden", "true");
      var acum = 0;
      areas.forEach(function (a, i) {
        var pct = 100 * porArea[a] / total;
        var seg = document.createElementNS(NS, "circle");
        seg.setAttribute("cx", "60"); seg.setAttribute("cy", "60"); seg.setAttribute("r", "48");
        seg.setAttribute("fill", "none"); seg.setAttribute("stroke", CAT_COLORES[i % CAT_COLORES.length]);
        seg.setAttribute("stroke-width", "17"); seg.setAttribute("pathLength", "100");
        seg.setAttribute("stroke-dasharray", pct + " " + (100 - pct));
        seg.setAttribute("stroke-dashoffset", String(-acum));
        seg.setAttribute("transform", "rotate(-90 60 60)");
        var tt2 = document.createElementNS(NS, "title");
        tt2.textContent = a + ": " + porArea[a] + (porArea[a] === 1 ? " criterio" : " criterios");
        seg.appendChild(tt2); svg.appendChild(seg);
        acum += pct;
      });
      var tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", "60"); tx.setAttribute("y", "58"); tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("font-size", "22"); tx.setAttribute("font-weight", "700"); tx.setAttribute("fill", "#0f1e35");
      tx.textContent = String(total); svg.appendChild(tx);
      var tx2 = document.createElementNS(NS, "text");
      tx2.setAttribute("x", "60"); tx2.setAttribute("y", "72"); tx2.setAttribute("text-anchor", "middle");
      tx2.setAttribute("font-size", "7.5"); tx2.setAttribute("fill", "#6b6b76"); tx2.setAttribute("letter-spacing", "0.5");
      tx2.textContent = "CRITERIOS"; svg.appendChild(tx2);
      wrap.appendChild(svg);
      var leyenda = el("div", "cv-legend");
      areas.forEach(function (a, i) {
        var row = el("div", "cv-leg-row");
        var sw = el("span", "cv-leg-swatch"); sw.style.background = CAT_COLORES[i % CAT_COLORES.length];
        row.appendChild(sw);
        row.appendChild(el("span", "cv-leg-name", a));
        row.appendChild(el("span", "cv-leg-count", porArea[a] + " · " + Math.round(100 * porArea[a] / total) + "%"));
        leyenda.appendChild(row);
      });
      wrap.appendChild(leyenda);
      box.appendChild(el("p", "cv-sub", "Criterios aprobados por materia"));
      box.appendChild(wrap);
      box.appendChild(el("p", "cv-caption", "Recuento del corpus embebido por materia (metadatos). No es una valoración ni anticipa ningún resultado."));
      box.classList.remove("oculto");
    }
    function catVisual(topic, items) {
      var box = $("cat-visual"); if (!box) return;
      box.textContent = ""; box.classList.add("oculto");
      var ids = {};
      (items || []).forEach(function (q) { (q.related_criteria_ids || []).forEach(function (id) { ids[id] = 1; }); });
      var crits = (window.LLA_DATA.criteria || []).filter(function (c) { return ids[c.id]; });
      if (!crits.length) return;
      var seenJ = {}, courts = {}, years = [], nRes = 0;
      crits.forEach(function (c) {
        var j = c.judgment_id || c.source_reference || c.id;
        if (seenJ[j]) return;
        seenJ[j] = 1; nRes++;
        var nombre = LLA.readableCitation ? LLA.readableCitation(c) : String(c.source_reference || j);
        var ct = catCourtOf(nombre); courts[ct] = (courts[ct] || 0) + 1;
        var m = String(nombre + " " + j).match(/(19|20)\d{2}/g);
        if (m) years.push(parseInt(m[m.length - 1], 10));
      });
      box.appendChild(el("h3", null, "Panorama del corpus · " + topic));
      var tiles = el("div", "cv-tiles");
      function tile(num, label) { var t = el("div", "cv-tile"); t.appendChild(el("span", "cv-num", String(num))); t.appendChild(el("span", "cv-label", label)); tiles.appendChild(t); }
      var mn = years.length ? Math.min.apply(null, years) : null, mx = years.length ? Math.max.apply(null, years) : null;
      tile(crits.length, crits.length === 1 ? "criterio aprobado" : "criterios aprobados");
      tile(nRes, nRes === 1 ? "resolución citada" : "resoluciones citadas");
      tile(years.length ? (mn === mx ? String(mn) : mn + "–" + mx) : "—", "periodo");
      box.appendChild(tiles);
      var nombres = Object.keys(courts).sort(function (a, b) { return courts[b] - courts[a]; });
      if (nombres.length) {
        box.appendChild(el("p", "cv-sub", "Órgano de las resoluciones"));
        var maxN = courts[nombres[0]], lista = el("div", "cv-courts");
        nombres.forEach(function (n) {
          var row = el("div", "cv-court");
          row.appendChild(el("span", "cv-name", n));
          var bar = el("span", "cv-bar"), fill = el("span", "cv-fill");
          fill.style.width = Math.round(100 * courts[n] / maxN) + "%";
          bar.appendChild(fill); row.appendChild(bar);
          row.appendChild(el("span", "cv-count", String(courts[n])));
          lista.appendChild(row);
        });
        box.appendChild(lista);
      }
      if (years.length) {
        var NS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 320 44"); svg.setAttribute("class", "cv-timeline");
        svg.setAttribute("width", "100%"); svg.setAttribute("height", "44"); svg.setAttribute("aria-hidden", "true");
        var line = document.createElementNS(NS, "line");
        line.setAttribute("x1", "14"); line.setAttribute("x2", "306"); line.setAttribute("y1", "16"); line.setAttribute("y2", "16");
        line.setAttribute("stroke", "#0f1e35"); line.setAttribute("stroke-width", "1.5"); line.setAttribute("opacity", "0.3");
        svg.appendChild(line);
        var porAno = {};
        years.forEach(function (y) { porAno[y] = (porAno[y] || 0) + 1; });
        var span = Math.max(1, mx - mn);
        Object.keys(porAno).map(Number).sort(function (a, b) { return a - b; }).forEach(function (y) {
          var x = mn === mx ? 160 : 14 + 292 * (y - mn) / span;
          var dot = document.createElementNS(NS, "circle");
          dot.setAttribute("cx", String(x)); dot.setAttribute("cy", "16");
          dot.setAttribute("r", porAno[y] > 1 ? "6" : "4.5"); dot.setAttribute("fill", "#c5a55a");
          var tt2 = document.createElementNS(NS, "title");
          tt2.textContent = porAno[y] + (porAno[y] === 1 ? " resolución de " : " resoluciones de ") + y;
          dot.appendChild(tt2); svg.appendChild(dot);
          if (y === mn || y === mx) {
            var tx = document.createElementNS(NS, "text");
            tx.setAttribute("x", String(x)); tx.setAttribute("y", "38"); tx.setAttribute("text-anchor", "middle");
            tx.setAttribute("font-size", "9.5"); tx.setAttribute("fill", "#6b6b76");
            tx.textContent = String(y); svg.appendChild(tx);
          }
        });
        box.appendChild(el("p", "cv-sub", "Resoluciones por año"));
        box.appendChild(svg);
      }
      box.appendChild(el("p", "cv-caption", "Recuento y origen de los criterios aprobados de este tema (metadatos del corpus). No es una valoración ni anticipa ningún resultado."));
      box.classList.remove("oculto");
    }
    function catRenderList(items) {
      var lista = $("lista-preguntas"); lista.textContent = "";
      if (!items.length) { lista.appendChild(el("p", "placeholder", "No hay preguntas en este tema.")); return; }
      var ul = el("ul");
      items.forEach(function (q) {
        var li = el("li");
        li.appendChild(el("div", "preg", q.question)); li.appendChild(el("div", "corta", q.short_answer));
        if (q.disclaimer) li.appendChild(el("div", "aviso-item", q.disclaimer));
        li.addEventListener("click", (function (id) { return function () { catOpen(id); }; })(q.id));
        ul.appendChild(li);
      });
      lista.appendChild(ul);
    }
    function catBlock(parent, titulo, arr) { if (!arr || !arr.length) return; parent.appendChild(el("h3", null, titulo)); var ul = el("ul"); arr.forEach(function (x) { ul.appendChild(el("li", null, x)); }); parent.appendChild(ul); }
    function catOpen(id) {
      var q = catById(id), det = $("detalle-pregunta"); det.textContent = "";
      var volver = el("span", "volver", "← Volver a las preguntas");
      volver.addEventListener("click", function () { det.classList.add("oculto"); $("lista-preguntas").classList.remove("oculto"); });
      det.appendChild(volver);
      if (!q) { det.appendChild(el("p", "placeholder", "No disponible.")); det.classList.remove("oculto"); $("lista-preguntas").classList.add("oculto"); return; }
      det.appendChild(el("h2", null, q.question));
      det.appendChild(el("h3", null, "Respuesta breve")); det.appendChild(el("p", null, q.short_answer));
      det.appendChild(el("h3", null, "Respuesta completa")); det.appendChild(el("pre", "texto", q.full_answer));
      catBlock(det, "Fuentes", q.source_references); catBlock(det, "Criterios relacionados", q.related_criteria_ids); catBlock(det, "Límites de esta respuesta", q.limits);
      det.appendChild(el("p", "disclaimer", q.disclaimer));
      det.classList.remove("oculto"); $("lista-preguntas").classList.add("oculto");
    }

    // ---- Evaluar Caso (offline) ----
    var EVAL_FILES = [];
    function evExt(n) { var m = /\.([a-z0-9]+)$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; }
    // «quitar» en el evaluador: borra el documento de la memoria al instante
    // (nada se guarda: la memoria muere al refrescar o cerrar la página).
    function evQuitar(rec, li, avisoLi) {
      var b = el("button", "enlace quitar-doc", tt().quitar); b.type = "button";
      b.addEventListener("click", function () {
        var ix = EVAL_FILES.indexOf(rec); if (ix >= 0) EVAL_FILES.splice(ix, 1);
        if (li.parentNode) li.parentNode.removeChild(li);
        if (avisoLi && avisoLi.parentNode) avisoLi.parentNode.removeChild(avisoLi);
      });
      return b;
    }
    async function evHandle(list) {
      var allowed = ["pdf", "docx", "txt", "png", "jpg", "jpeg"], lista = $("ev-lista");
      for (var i = 0; i < list.length; i++) {
        var file = list[i], ext = evExt(file.name);
        if (allowed.indexOf(ext) < 0) { lista.appendChild(el("li", "mal", "✗ " + file.name + " (tipo no admitido)")); continue; }
        var item = el("li", "cargando", "⏳ " + file.name); lista.appendChild(item);
        var opts = {};
        try {
          if (ext === "txt") opts.text = await file.text(); else opts.bytes = new Uint8Array(await file.arrayBuffer());
          var ex = await LLA.extractFile(ext, file.name, opts);
          var rec = { id: "upl-" + Math.random().toString(36).slice(2), case_id: "case-local", original_filename: file.name, file_type: ext, upload_type: "case_material", extraction_status: ex.status, extracted_text: ex.text, warnings: ex.warnings, source_locations: ex.source_locations };
          EVAL_FILES.push(rec);
          item.className = ex.status === "completed" ? "ok" : "mal";
          item.textContent = (ex.status === "completed" ? "✓ " : "⚠ ") + file.name + " (" + ex.status + ") ";
          var avisoLi = null;
          if (ex.status !== "completed" && ex.warnings.length) {
            // Esta vista NO tiene botón de OCR: no prometer un control inexistente
            // (Regla 10, honestidad). Se sustituye ese aviso por la vía real.
            var avisoEv = /«Escanear con OCR»/.test(ex.warnings[0])
              ? "No se pudo leer el documento (escaneado o imagen) y esta vista no tiene OCR; no se inventa contenido (Regla 4)."
              : ex.warnings[0];
            avisoLi = el("li", "cargando", "   " + avisoEv + " (pega el texto en la descripción)");
            lista.appendChild(avisoLi);
          }
          item.appendChild(evQuitar(rec, item, avisoLi));
        } catch (e) { item.className = "mal"; item.textContent = "✗ " + file.name + " (error al leer)"; }
      }
    }
    var ez = $("ev-zona"), ei = $("ev-file");
    if (ez) {
      ["dragenter", "dragover"].forEach(function (e) { ez.addEventListener(e, function (ev) { ev.preventDefault(); ez.classList.add("arrastrando"); }); });
      ["dragleave", "dragend"].forEach(function (e) { ez.addEventListener(e, function () { ez.classList.remove("arrastrando"); }); });
      ez.addEventListener("drop", function (ev) { ev.preventDefault(); ez.classList.remove("arrastrando"); evHandle(ev.dataTransfer.files); });
      $("ev-examinar").addEventListener("click", function () { ei.click(); });
      ei.addEventListener("change", function () { evHandle(ei.files); ei.value = ""; });
    }
    function evFactorList(title, arr) {
      if (!arr || !arr.length) return null;
      var box = document.createDocumentFragment(); box.appendChild(el("h3", null, title));
      var ul = el("ul", "factores");
      arr.forEach(function (f) { var li = el("li", null); li.appendChild(el("span", "f-txt", f.factor)); li.appendChild(el("span", "f-fuente", " — " + f.explicacion + " [criterio " + f.criterion_id + " · fuente " + fuenteLegible(f) + (f.evidence && f.evidence !== "—" ? " · evidencia: " + f.evidence : "") + "]")); ul.appendChild(li); });
      box.appendChild(ul); return box;
    }
    function evRender(ev) {
      var panel = $("ev-resultado"); panel.textContent = ""; panel.classList.remove("oculto");
      if (ev.case_fit_grade === "insuficiente" || ev.case_fit_score === null) {
        panel.appendChild(el("h2", null, "No se puede calificar todavía"));
        panel.appendChild(el("p", "ev-reason", ev.reason || "Datos insuficientes."));
        if (ev.next_information_needed.length) { panel.appendChild(el("h3", null, "Información necesaria")); var u = el("ul", "factores"); ev.next_information_needed.forEach(function (m) { u.appendChild(el("li", null, m)); }); panel.appendChild(u); }
        panel.appendChild(el("p", "aviso-item", ev.limits[0] || "")); panel.appendChild(el("p", "aviso-item", ev.disclaimer)); return;
      }
      var head = el("div", "grade-head"); head.appendChild(el("div", "grade-badge grade-" + ev.case_fit_grade, ev.case_fit_grade));
      var info = el("div", "grade-info"); info.appendChild(el("div", "grade-label", "Calificación de alineación con criterios del corpus: " + ev.case_fit_grade + " — " + ev.score_label)); info.appendChild(el("div", "grade-sub", "Score orientativo: " + ev.case_fit_score + "/100 · Confianza: " + ev.confidence_level)); head.appendChild(info); panel.appendChild(head);
      panel.appendChild(el("h3", null, "Resumen del caso entendido")); panel.appendChild(el("p", "ev-summary", ev.case_summary));
      var fav = evFactorList("Factores favorables (alineados con criterios)", ev.favorable_factors); if (fav) panel.appendChild(fav);
      var unf = evFactorList("Factores desfavorables (cuestiones que el corpus no resuelve)", ev.unfavorable_factors); if (unf) panel.appendChild(unf);
      if (ev.uncertain_factors.length) { panel.appendChild(el("h3", null, "Factores inciertos")); var ui = el("ul", "factores"); ev.uncertain_factors.forEach(function (u) { var li = el("li", null); li.appendChild(el("span", "f-txt", u.factor)); li.appendChild(el("span", "f-fuente", " — " + u.why_it_matters + " Falta: " + u.what_is_missing)); ui.appendChild(li); }); panel.appendChild(ui); }
      if (ev.missing_facts.length) { panel.appendChild(el("h3", null, "Información faltante")); var um = el("ul", "factores"); ev.missing_facts.forEach(function (m) { um.appendChild(el("li", null, m)); }); panel.appendChild(um); }
      panel.appendChild(el("h3", null, "Criterios usados y fuentes")); var uc = el("ul", "factores"); ev.criteria_used.forEach(function (c) { uc.appendChild(el("li", null, c.criterion_id + " · " + fuenteLegible(c))); }); panel.appendChild(uc);
      if (ev.evidence_used.length) panel.appendChild(el("p", "sb-ev", "Evidencia usada: " + ev.evidence_used.join(", ")));
      panel.appendChild(el("h3", null, "Límites")); var ul2 = el("ul", "factores"); ev.limits.forEach(function (l) { ul2.appendChild(el("li", null, l)); }); panel.appendChild(ul2);
      panel.appendChild(el("p", "aviso-item", ev.disclaimer));
    }
    $("form-eval").addEventListener("submit", function (e) {
      e.preventDefault();
      var desc = $("ev-desc").value.trim(); var panel = $("ev-resultado"); panel.classList.remove("oculto"); panel.textContent = "";
      if (!desc) { panel.appendChild(el("p", "ev-reason", "Describe brevemente el caso antes de analizar.")); return; }
      evRender(LLA.runCaseEvaluation(desc, $("ev-asunto").value, EVAL_FILES));
      panel.scrollIntoView({ block: "start" });
    });
  });
})();
"""

SHELL = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ILP · Asesor Informativo — marcas y propiedad intelectual</title>
<link rel="icon" type="image/png" href="data:image/png;base64,__FAVICON__" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600&display=swap" />
<style>
__CSS__
.lla-gate{position:fixed;inset:0;background:rgba(20,25,35,.55);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
.lla-gate-card{background:#fff;border-radius:12px;padding:22px;max-width:560px;width:100%}
.lla-gate-texto{background:var(--aviso-bg);border:1px solid var(--aviso-borde);border-radius:8px;padding:12px}
.lla-gate-check{display:block;margin:12px 0}.lla-gate-version{color:var(--suave);font-size:.8rem;margin:8px 0 0}
</style>
</head>
<body>
<header class="topbar"><div class="topbar-inner">
  <span class="brand"><span class="logo-ilp" role="img" aria-label="ILP Abogados"><span class="logo-caja">ilp</span><span class="logo-palabra">ABOGADOS</span></span><span class="brand-sub">Asesor Informativo</span></span>
  <span style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span class="brand-sub" data-i18n="escritorio" style="letter-spacing:.2em">Versión web</span>
    <span class="barra-idioma"><span id="idioma-label" data-i18n="idioma">Idioma:</span><button type="button" id="lang-es" class="lang activo">Español</button><button type="button" id="lang-en" class="lang">English</button></span>
  </span>
</div></header>
<main class="contenedor">
  <section class="hero">
    <p class="kicker" data-i18n="kicker">Marcas · Propiedad intelectual · Patentes · Procesal</p>
    <h1 data-i18n-html="heroH1">Inteligencia que <em>entiende</em> tu caso.</h1>
    <p class="subtitulo" data-i18n="subtituloHero">Orientación basada en un corpus cerrado de criterios aprobados de resoluciones reales. Sus documentos se procesan en su navegador: no se guardan ni se suben a ningún servidor.</p>
  </section>
  <p class="aviso-fijo" role="note" data-disclaimer-banner></p>
  <section class="dos-caminos" aria-label="Elige cómo empezar">
    <article class="camino-card">
      <span class="camino-num">01</span>
      <h2 data-i18n="c1Titulo">Preguntas estándar</h2>
      <p data-i18n="c1P">Catálogo navegable por materias —marcas, propiedad intelectual, patentes y procesal—. Cada pregunta tiene una respuesta validada de antemano, fiel a los criterios del corpus y con la resolución de la que procede.</p>
      <p class="camino-nota" data-i18n="c1Nota">El camino rápido, predecible y de máxima fiabilidad.</p>
      <button type="button" id="ir-catalogo" class="camino-cta" data-i18n="c1Cta">Abrir catálogo →</button>
    </article>
    <article class="camino-card destacada">
      <span class="camino-num">02</span>
      <h2 data-i18n="c2Titulo">Pregunta específica</h2>
      <p data-i18n-html="c2P">Redacta tu propia consulta. Si es ambigua o mezcla materias, la herramienta <strong>repregunta</strong> para precisar; si es clara, ofrece una <strong>orientación</strong> construida solo con los criterios del corpus, citando su fuente.</p>
      <p class="camino-nota" data-i18n="c2Nota">Lectura orientativa de criterios jurisprudenciales — nunca un dictamen ni una recomendación de actuación.</p>
      <button type="button" id="ir-asistida" class="camino-cta primaria" data-i18n="c2Cta">Escribir consulta →</button>
    </article>
  </section>
  <nav class="menu menu-secundario" aria-label="Otras herramientas">
    <span class="menu-rotulo" data-i18n="menuRotulo">También:</span>
    <button type="button" class="menu-item" data-view="asistida" data-i18n="menuAsistida">Pregunta específica</button>
    <button type="button" class="menu-item" data-view="catalogo" data-i18n="menuCatalogo">Catálogo</button>
    <button type="button" class="menu-item" data-view="evaluar" data-i18n="menuEvaluar">Evaluar caso</button>
    <button id="menu-scoreboard" type="button" class="menu-item" data-i18n="menuScore">Ver score de alineación</button>
  </nav>
  <div id="view-catalogo" class="oculto">
    <h2 class="seccion-titulo">Preguntas estándar</h2>
    <p class="subtitulo">Respuestas preaprobadas, fieles a los criterios del corpus. Elige una materia y un tema.</p>
    <div class="layout">
      <nav id="navegacion" class="navegacion" aria-label="Áreas y temas"></nav>
      <section class="contenido">
        <div id="lista-preguntas" class="lista-preguntas"><p class="placeholder">Elige una materia y un tema a la izquierda.</p></div>
        <article id="detalle-pregunta" class="detalle-pregunta oculto"></article>
        <aside id="cat-visual" class="cat-visual oculto"></aside>
      </section>
    </div>
  </div>
  <div id="view-asistida">
  <form id="formulario" class="caja">
    <label for="consulta" data-i18n="labelConsulta">Escriba su consulta</label>
    <textarea id="consulta" rows="4" data-i18n-ph="phConsulta" placeholder="Ej.: Una empresa usa un logo parecido a mi marca registrada…"></textarea>
    <label for="hechos" data-i18n="labelHechos">Hechos o reporte del caso (opcional)</label>
    <textarea id="hechos" rows="3" data-i18n-ph="phHechos" placeholder="Pega aquí el reporte del caso…"></textarea>
    <label id="label-materiales" data-i18n="labelMateriales">Materiales del caso (archivos: PDF, DOCX, TXT, PNG, JPG, JPEG)</label>
    <div id="zona-materiales" class="dropzone dropzone-archivos">
      <p class="dropzone-ayuda"><span data-i18n="dropAyuda">Arrastra aquí tus archivos o</span>
        <button type="button" id="examinar-materiales" class="enlace" data-i18n="examinar">examinar…</button>
        <input type="file" id="archivo-materiales" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" multiple hidden /></p>
      <p class="nota-evidencia" data-i18n="notaEvidencia">Evidencia del caso, no fuente jurídica. No constituye asesoramiento ni predice el resultado. Se procesa en tu navegador: no se sube a ningún servidor y se borra al refrescar o cerrar la página.</p>
      <ul id="lista-materiales" class="materiales" aria-live="polite"></ul>
      <div id="hechos-detectados" class="hechos-detectados oculto"></div>
    </div>
    <button id="enviar" type="submit" data-i18n="enviar">Enviar consulta</button>
  </form>
  <section id="resultado" class="resultado oculto" aria-live="polite">
    <div class="panel">
      <div class="campo"><span class="etiqueta" data-i18n="etDecision">Decisión del sistema</span><span id="decision" class="valor badge"></span></div>
      <div class="campo"><span class="etiqueta" data-i18n="etArea">Área detectada</span><span id="area" class="valor"></span></div>
      <div class="campo"><span class="etiqueta" data-i18n="etTema">Tema detectado</span><span id="tema" class="valor"></span></div>
      <div class="campo"><span class="etiqueta" data-i18n="etCriterios">Criterios usados</span><span id="criterios" class="valor"></span></div>
      <div class="campo"><span class="etiqueta" data-i18n="etFuentes">Fuentes usadas</span><span id="fuentes" class="valor"></span></div>
    </div>
    <h2 id="titulo-respuesta"></h2>
    <div id="flashcards" class="flashcards oculto" aria-live="polite"></div>
    <pre id="texto-respuesta" class="texto"></pre>
    <button type="button" id="toggle-texto" class="toggle-texto oculto" data-i18n="verTodo">Ver todo el texto</button>
    <div id="clarify-options" class="clarify-options oculto" aria-live="polite"></div>
    <form id="form-aclaracion" class="caja aclaracion oculto">
      <label for="aclaracion" data-i18n="labelAclaracion">Responda a las preguntas anteriores</label>
      <textarea id="aclaracion" rows="3" data-i18n-ph="phAclaracion" placeholder="Añada aquí los datos que le piden…"></textarea>
      <button id="enviar-aclaracion" type="submit" data-i18n="enviarAclaracion">Enviar respuesta</button>
    </form>
    <p id="aviso-respuesta" class="aviso-respuesta"></p>
    <aside id="cta-ilp" class="cta-ilp oculto" aria-live="polite">
      <div class="cta-ilp-inner">
        <p id="cta-ilp-titulo" class="cta-ilp-titulo">¿Su caso tiene más matices?</p>
        <p id="cta-ilp-texto" class="cta-ilp-texto">Esta orientación se basa en un corpus cerrado de resoluciones. Para resolver las dudas concretas de su caso, contacte con ILP Abogados.</p>
        <div class="cta-ilp-acciones">
          <a id="cta-ilp-email" class="cta-ilp-btn" href="mailto:atencionalcliente@ilpabogados.com?subject=Consulta%20sobre%20marcas%20y%20propiedad%20intelectual">Contactar con ILP Abogados</a>
          <a class="cta-ilp-tel" href="tel:+34914582492">+34 914 582 492</a>
        </div>
      </div>
    </aside>
  </section>
  <section id="scoreboard" class="scoreboard oculto" aria-live="polite"></section>
  </div>

  <div id="view-evaluar" class="oculto">
    <form id="form-eval" class="caja">
      <label for="ev-nombre">Nombre del caso (opcional)</label>
      <input id="ev-nombre" type="text" placeholder="Ej.: NÓVALU vs NOVALÚ" />
      <label for="ev-desc">Descripción breve del caso</label>
      <textarea id="ev-desc" rows="5" placeholder="Cuenta con tus palabras qué ocurrió (hechos, no preguntes si vas a ganar)…"></textarea>
      <label for="ev-asunto">Tipo de asunto</label>
      <select id="ev-asunto">
        <option value="No estoy seguro">No estoy seguro</option>
        <option value="Marcas">Marcas</option>
        <option value="Propiedad intelectual">Propiedad intelectual</option>
        <option value="Patentes">Patentes</option>
        <option value="Procesal">Procesal</option>
      </select>
      <label>Documentos del caso (PDF, DOCX, TXT, PNG, JPG, JPEG)</label>
      <div id="ev-zona" class="dropzone dropzone-archivos">
        <p class="dropzone-ayuda"><span>Arrastra aquí tus documentos o</span>
          <button type="button" id="ev-examinar" class="enlace">examinar…</button>
          <input id="ev-file" type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" multiple hidden /></p>
        <p class="nota-evidencia">Solo material factual del caso. No son fuente jurídica, no crean criterios y no predicen el resultado. Se procesan en tu navegador: no se suben a ningún servidor y se borran al refrescar o cerrar la página.</p>
        <ul id="ev-lista" class="materiales" aria-live="polite"></ul>
      </div>
      <button id="ev-analizar" type="submit">Analizar caso</button>
    </form>
    <section id="ev-resultado" class="caja eval-result oculto" aria-live="polite"></section>
  </div>
</main>
<footer class="pie"><div class="pie-inner">
  <div>
    <span class="logo-ilp logo-pie" role="img" aria-label="ILP Abogados"><span class="logo-caja">ilp</span><span class="logo-palabra">ABOGADOS</span></span>
    <p class="pie-aviso" data-i18n="pieAviso">Asesor informativo de marcas y propiedad intelectual. Responde solo con criterios aprobados de resoluciones reales, cita su fuente, declara sus límites y nunca predice el resultado. No es asesoramiento jurídico.</p>
  </div>
  <div>
    <h4 data-i18n="contacto">Contacto</h4>
    <p data-i18n-html="pieDir">Paseo de la Castellana 120, 5º Izq.<br />28046 Madrid, España</p>
    <p>+34 914 582 492</p>
    <p><a id="pie-email" href="mailto:atencionalcliente@ilpabogados.com">atencionalcliente@ilpabogados.com</a></p>
  </div>
  <p class="pie-legal" data-i18n="pieLegal">Versión web · Corpus cerrado · Los documentos del usuario se procesan en el navegador, no se suben a ningún servidor y se borran al salir · La aprobación de criterios es siempre un acto humano.</p>
</div></footer>
<div id="popup-score" class="popup-overlay oculto" role="dialog" aria-modal="true" aria-labelledby="popup-score-titulo">
  <div class="popup-box">
    <button type="button" id="popup-score-cerrar" class="popup-cerrar" aria-label="Cerrar">&times;</button>
    <p id="popup-score-titulo" class="popup-titulo"></p>
    <p id="popup-score-texto" class="popup-texto"></p>
    <p id="popup-score-aviso" class="popup-aviso"></p>
    <div class="popup-acciones">
      <a id="popup-score-email" class="popup-btn" href="mailto:atencionalcliente@ilpabogados.com?subject=Consulta%20sobre%20marcas%20y%20propiedad%20intelectual">Contactar con ILP Abogados</a>
      <a class="popup-tel" href="tel:+34914582492">+34 914 582 492</a>
    </div>
  </div>
</div>
<script>window.LLA_DATA = __DATA__;</script>
<script>__BRAIN__</script>
<script>__UI__</script>
</body>
</html>
"""

html = (SHELL
        .replace("__CSS__", CSS)
        .replace("__FAVICON__", FAVICON_B64)
        .replace("__DATA__", DATA_JSON)
        .replace("__BRAIN__", BRAIN)
        .replace("__UI__", UI))

out = ROOT / "demo" / "locked-legal-advisor.html"
out.write_text(html, encoding="utf-8")
size_kb = len(html.encode("utf-8")) / 1024
print(f"Generado: {out}  ({size_kb:.0f} KB)")
print(f"Corpus embebido: {len(DATA['criteria'])} criterios aprobados · {len(DATA['judgmentIds'])} resoluciones")
