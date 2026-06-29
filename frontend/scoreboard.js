/*
 * scoreboard.js — "Score de alineación con criterios del corpus" (Case Fit Score).
 *
 * Capa tonta: pide /api/scoreboard con la consulta + los materiales de la sesión
 * y pinta el resultado. NUNCA muestra "probabilidad de ganar" ni pronóstico: el
 * backend lo garantiza (deny-by-default) y aquí solo se renderiza lo recibido.
 */
(function () {
  "use strict";
  var btn = document.getElementById("menu-scoreboard");
  var panel = document.getElementById("scoreboard");
  if (!btn || !panel) return;

  function el(t, c, x) {
    var e = document.createElement(t);
    if (c) e.className = c;
    if (x != null) e.textContent = x;
    return e;
  }
  function sessionId() { try { return localStorage.getItem("lla:session_id") || ""; } catch (e) { return ""; } }
  function acceptedVersion() { return typeof window.LLA_acceptedVersion === "function" ? window.LLA_acceptedVersion() : ""; }
  function getLocale() { try { return localStorage.getItem("lla:locale") === "en" ? "en" : "es"; } catch (e) { return "es"; } }
  function question() {
    var c = document.getElementById("consulta");
    var h = document.getElementById("hechos");
    return [c ? c.value.trim() : "", h ? h.value.trim() : ""].filter(Boolean).join("\n\n");
  }

  function fuenteLegible(o) {
    // nombre LEGIBLE de la resolución (no el slug interno); fallback al formato viejo
    return o.resolution || (o.source_reference + " (resolución " + o.judgment_id + ")");
  }
  function factorLine(f) {
    var li = el("li", null);
    li.appendChild(el("span", "f-txt", f.factor));
    var src = " — criterio " + f.criterion_id + " · fuente " + fuenteLegible(f);
    if (f.evidence && f.evidence !== "—") src += " · evidencia: " + f.evidence;
    li.appendChild(el("span", "f-fuente", src));
    return li;
  }
  function listSection(title, factors, fn) {
    if (!factors || !factors.length) return;
    panel.appendChild(el("h3", null, title));
    var ul = el("ul", "factores");
    factors.forEach(function (f) { ul.appendChild(fn(f)); });
    panel.appendChild(ul);
  }
  function plainList(title, items) {
    if (!items || !items.length) return;
    panel.appendChild(el("h3", null, title));
    var ul = el("ul", "factores");
    items.forEach(function (m) { ul.appendChild(el("li", null, m)); });
    panel.appendChild(ul);
  }

  // Textos del pop-up según el UMBRAL (≥70 / <70). AMBOS apuntan a CONSULTAR con un
  // profesional de ILP (Reglas 11-12, que exigen recordar esto). El score es
  // ALINEACIÓN con el corpus (cobertura), NO mérito ni pronóstico: por eso ningún
  // texto insinúa "buen caso", "encaja", "sigue adelante", "ganar" ni "litigar"
  // (Regla 18; verificado por tests/_mirror/verify_popup_score.py).
  var AVISO_ES = "La alineación mide cuánto cubre el corpus tu caso; no es un pronóstico del resultado ni una recomendación de actuación.";
  var AVISO_EN = "Alignment measures how much the corpus covers your case — not the merits or outcome of any proceeding.";
  // Email-plantilla para el botón de contacto (igual que el CTA principal).
  var MAIL_ES = { s: "Solicitud de servicios — ILP Abogados (marcas y propiedad intelectual)",
    b: "Estimado equipo de ILP Abogados:\n\nLes escribo a través de su Asesor Informativo. Me gustaría contar con sus servicios profesionales en materia de marcas y propiedad intelectual y recibir una valoración de mi caso.\n\nResumen de mi caso:\n\n\nDatos de contacto:\n- Nombre:\n- Teléfono:\n\nQuedo a la espera de su respuesta. Un cordial saludo." };
  var MAIL_EN = { s: "Request for services — ILP Abogados (trademarks and IP)",
    b: "Dear ILP Abogados team,\n\nI am writing through your Informational Advisor. I would like to engage your professional services in trademark and intellectual property matters and receive an assessment of my case.\n\nSummary of my case:\n\n\nContact details:\n- Name:\n- Phone:\n\nI look forward to your reply. Best regards." };
  function mailtoILP(loc) {
    var m = loc === "en" ? MAIL_EN : MAIL_ES;
    return "mailto:atencionalcliente@ilpabogados.com?subject=" + encodeURIComponent(m.s) + "&body=" + encodeURIComponent(m.b);
  }
  function popupTextos(loc, alto, score) {
    if (loc === "en") {
      return alto
        ? {
            titulo: "For your specific case, count on ILP Abogados",
            texto: "This tool only orients on the corpus: it does not assess your case or anticipate any outcome. For your specific situation, ILP Abogados can help — get in touch.",
            aviso: AVISO_EN,
            boton: "Contact ILP Abogados",
          }
        : {
            titulo: "Your case is best assessed by a professional",
            texto: "Your query falls partly outside the analysed criteria, so this tool cannot fully orient you. For your specific situation, seek professional help at ILP Abogados.",
            aviso: AVISO_EN,
            boton: "Contact ILP Abogados",
          };
    }
    return alto
      ? {
          titulo: "Para tu caso concreto, cuenta con ILP Abogados",
          texto: "Esta herramienta solo orienta sobre el corpus: no valora tu caso ni anticipa ningún resultado. Para tu situación concreta, en ILP Abogados podemos orientarte: escríbenos.",
          aviso: AVISO_ES,
          boton: "Contactar con ILP Abogados",
        }
      : {
          titulo: "Tu caso conviene valorarlo con un profesional",
          texto: "Tu consulta queda en parte fuera de los criterios analizados, así que esta herramienta no alcanza a orientarte del todo. Para tu situación concreta, busca ayuda profesional en ILP Abogados.",
          aviso: AVISO_ES,
          boton: "Contactar con ILP Abogados",
        };
  }

  function cerrarPopup() {
    var ov = document.getElementById("popup-score");
    if (ov) ov.classList.add("oculto");
  }
  function mostrarPopupScore(score) {
    var ov = document.getElementById("popup-score");
    if (!ov || score == null) return;
    var T = popupTextos(getLocale(), score >= 70, score);
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set("popup-score-titulo", T.titulo);
    set("popup-score-texto", T.texto);
    set("popup-score-aviso", T.aviso);
    set("popup-score-email", T.boton);
    var em = document.getElementById("popup-score-email");
    if (em) em.setAttribute("href", mailtoILP(getLocale()));
    ov.classList.remove("oculto");
  }
  (function () {
    var ov = document.getElementById("popup-score");
    if (!ov) return;
    var x = document.getElementById("popup-score-cerrar");
    if (x) x.addEventListener("click", cerrarPopup);
    ov.addEventListener("click", function (e) { if (e.target === ov) cerrarPopup(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarPopup(); });
  })();

  function render(sb) {
    panel.textContent = "";
    panel.classList.remove("oculto");
    panel.appendChild(el("h2", null, "Score de alineación con criterios del corpus"));

    if (!sb.computable) {
      panel.appendChild(el("p", "sb-reason", "No se puede generar el score: " + (sb.reason || "datos insuficientes") + "."));
      plainList("Información necesaria", sb.next_information_needed);
      panel.appendChild(el("p", "aviso-item", (sb.limits && sb.limits[0]) || ""));
      panel.appendChild(el("p", "aviso-item", sb.disclaimer || ""));
      return;
    }

    var head = el("div", "sb-head");
    head.appendChild(el("div", "sb-num", sb.case_fit_score + "/100"));
    head.appendChild(el("div", "sb-label",
      "Alineación con criterios del corpus: " + String(sb.score_label).toUpperCase() +
      " · Confianza: " + sb.confidence_level));
    panel.appendChild(head);

    var bar = el("div", "sb-bar");
    var fill = el("div", "sb-fill");
    fill.style.width = sb.case_fit_score + "%";
    bar.appendChild(fill);
    panel.appendChild(bar);

    listSection("Factores favorables (hechos alineados con criterios)", sb.favorable_factors, factorLine);
    listSection("Factores desfavorables (cuestiones que el corpus no resuelve)", sb.unfavorable_factors, factorLine);

    if (sb.uncertain_factors && sb.uncertain_factors.length) {
      panel.appendChild(el("h3", null, "Factores inciertos"));
      var ui = el("ul", "factores");
      sb.uncertain_factors.forEach(function (f) {
        var li = el("li", null);
        li.appendChild(el("span", "f-txt", f.factor));
        li.appendChild(el("span", "f-fuente", " — " + f.why_it_matters + " Falta: " + f.what_is_missing));
        ui.appendChild(li);
      });
      panel.appendChild(ui);
    }

    plainList("Información faltante", sb.missing_facts);

    panel.appendChild(el("h3", null, "Criterios usados y fuentes"));
    var uc = el("ul", "factores");
    sb.criteria_used.forEach(function (c) {
      uc.appendChild(el("li", null, c.criterion_id + " · " + fuenteLegible(c)));
    });
    panel.appendChild(uc);
    if (sb.evidence_used && sb.evidence_used.length) {
      panel.appendChild(el("p", "sb-ev", "Documentos del usuario usados: " + sb.evidence_used.join(", ")));
    }
    plainList("Límites", sb.limits);
    panel.appendChild(el("p", "aviso-item", sb.disclaimer || ""));

    // Pop-up de contacto según el umbral del score de alineación (≥70 / <70).
    mostrarPopupScore(sb.case_fit_score);
  }

  btn.addEventListener("click", function () {
    var q = question();
    panel.classList.remove("oculto");
    panel.textContent = "";
    if (!q) {
      panel.appendChild(el("p", "sb-reason", "Escribe tu consulta (y, si quieres, sube materiales del caso) antes de ver el score."));
      return;
    }
    panel.appendChild(el("p", "sb-reason", "Calculando alineación…"));
    panel.scrollIntoView({ block: "start" });
    fetch("/api/scoreboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, session_id: sessionId(), locale: getLocale(), accepted_version: acceptedVersion() }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.acceptance_required) { panel.textContent = ""; panel.appendChild(el("p", "sb-reason", "Debe aceptar el aviso antes de usar la herramienta.")); return; }
        if (!data || !data.ok) { panel.textContent = ""; panel.appendChild(el("p", "sb-reason", "No se pudo generar el score.")); return; }
        render(data.scoreboard);
      })
      .catch(function () { panel.textContent = ""; panel.appendChild(el("p", "sb-reason", "Error de red.")); });
  });
})();
