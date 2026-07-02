/*
 * app.js — Lógica de la interfaz de prueba (capa tonta).
 *
 * No contiene NINGUNA lógica jurídica ni de decisión: solo envía la consulta al
 * backend y muestra lo que el cerebro decide. Refuerza, además, la regla del
 * locked advisor en el cliente: NUNCA se presentan criterios ni fuentes salvo
 * que la decisión sea "answer".
 */
(function () {
  "use strict";

  var form = document.getElementById("formulario");
  var input = document.getElementById("consulta");
  var boton = document.getElementById("enviar");
  var resultado = document.getElementById("resultado");

  var elDecision = document.getElementById("decision");
  var elArea = document.getElementById("area");
  var elTema = document.getElementById("tema");
  var elCriterios = document.getElementById("criterios");
  var elFuentes = document.getElementById("fuentes");
  var elTitulo = document.getElementById("titulo-respuesta");
  var elTexto = document.getElementById("texto-respuesta");
  var elFlashcards = document.getElementById("flashcards");
  var toggleTexto = document.getElementById("toggle-texto");
  var elAviso = document.getElementById("aviso-respuesta");

  // Caja de respuesta a las preguntas de aclaración (solo visible en "clarify").
  var formAcl = document.getElementById("form-aclaracion");
  var inputAcl = document.getElementById("aclaracion");
  var botonAcl = document.getElementById("enviar-aclaracion");

  // Zona de hechos / reporte del caso (pegar texto o soltar un .txt). Se lee
  // localmente y se trata como hechos descritos por el usuario.
  var hechos = document.getElementById("hechos");
  var zonaHechos = document.getElementById("zona-hechos");
  var btnExaminar = document.getElementById("examinar");
  var fileInput = document.getElementById("archivo-hechos");
  var archivosEl = document.getElementById("archivos-cargados");

  // Guarda la última consulta enviada para poder COMBINARLA con la aclaración.
  var ultimaConsulta = "";
  // Intentos consecutivos sin respuesta de fondo (límite de 3 → derivar a ILP).
  // baseConsulta = consulta original del formulario: una consulta NUEVA reinicia
  // el contador (Regla 7: cada consulta fresca tiene derecho a sus aclaraciones).
  var sinRespuesta = 0;
  var baseConsulta = "";

  // Aviso de respaldo (fuente única: services/legal/disclaimer.ts). El aviso de
  // cada respuesta llega del servidor (answer.disclaimer); esto es solo el
  // fallback si faltara. acceptance.js expone la config en window.LLA_disclaimerConfig.
  function DISCLAIMER_FIJO() {
    var c = window.LLA_disclaimerConfig;
    return (c && c.short_disclaimer) ||
      "Esta respuesta es únicamente orientación informativa basada en un corpus cerrado y no constituye asesoramiento jurídico.";
  }

  // --- Idioma de la interfaz (es | en). El razonamiento sigue en español. ---
  var LOCALE_KEY = "lla:locale";
  function getLocale() {
    try { return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "es"; } catch (e) { return "es"; }
  }
  function setLocale(loc) {
    try { localStorage.setItem(LOCALE_KEY, loc); } catch (e) { /* efímero */ }
    applyLocale(loc);
  }

  // Etiquetas de la interfaz por idioma (capa de presentación).
  var UI = {
    es: {
      subtitulo: "Orientación informativa basada en un corpus cerrado de criterios aprobados de resoluciones reales.",
      idioma: "Idioma:",
      labelConsulta: "Escriba su consulta",
      placeholder: "Ej.: Una empresa usa un logo parecido a mi marca registrada…",
      enviar: "Enviar consulta",
      consultando: "Consultando…",
      labelAclaracion: "Responda a las preguntas anteriores",
      placeholderAclaracion: "Añada aquí los datos que le piden…",
      enviarAclaracion: "Enviar respuesta",
      enviandoAclaracion: "Enviando…",
      labelHechos: "Hechos o reporte del caso (opcional)",
      placeholderHechos: "Pega aquí el reporte del caso o arrastra un archivo .txt…",
      ayudaHechos:
        "Se procesa en tu navegador; el sistema no predice resultados, solo orienta según los criterios aprobados.",
      examinar: "Examinar…",
      cargado: "Cargado: ",
      soloTxt: "Solo se admiten archivos .txt.",
      etiquetas: ["Decisión del sistema", "Área detectada", "Tema detectado", "Criterios usados", "Fuentes usadas"],
      titulos: {
        answer: "Orientación informativa",
        clarify: "Necesito algunas aclaraciones",
        out_of_scope: "Consulta fuera del corpus",
        insufficient_criteria: "Sin criterios aprobados suficientes",
      },
      limite: {
        titulo: "Su caso necesita la valoración de un profesional",
        texto:
          "Hemos hecho varios intentos y esta herramienta no ha logrado darle una orientación completa con el corpus disponible, así que no le hacemos más preguntas. Su caso tiene matices que conviene valorar con un abogado: contacte con ILP Abogados con el botón de abajo y el equipo le orientará.",
      },
      cta: {
        titulo: "¿Su caso tiene más matices?",
        texto:
          "Esta orientación se basa en un corpus cerrado de resoluciones. Para resolver las dudas concretas de su caso, contacte con ILP Abogados.",
        tituloFuerte: "Su caso conviene valorarlo con un profesional",
        textoFuerte:
          "Su caso puede tener matices que el corpus no resuelve o quedar fuera de las resoluciones analizadas. Contacte con ILP Abogados para resolver sus dudas.",
        boton: "Contactar con ILP Abogados",
        emailAsunto: "Solicitud de servicios — ILP Abogados (marcas y propiedad intelectual)",
        emailCuerpo:
          "Estimado equipo de ILP Abogados:\n\n" +
          "Les escribo a través de su Asesor Informativo. Me gustaría contar con sus servicios " +
          "profesionales en materia de marcas y propiedad intelectual y recibir una valoración de mi caso.\n\n" +
          "Resumen de mi caso:\n\n\n" +
          "Datos de contacto:\n- Nombre:\n- Teléfono:\n\n" +
          "Quedo a la espera de su respuesta. Un cordial saludo.",
      },
      verTodo: "Ver todo el texto",
      verTarjetas: "Ver en tarjetas",
      fcA11y: { prev: "Tarjeta anterior", next: "Tarjeta siguiente", goto: "Ir a la tarjeta " },
    },
    en: {
      subtitulo: "Informational guidance based on a closed corpus of approved criteria from real resolutions.",
      idioma: "Language:",
      labelConsulta: "Type your query",
      placeholder: "E.g.: A company uses a logo similar to my registered trademark…",
      enviar: "Send query",
      consultando: "Querying…",
      labelAclaracion: "Answer the questions above",
      placeholderAclaracion: "Add here the details requested…",
      enviarAclaracion: "Send answer",
      enviandoAclaracion: "Sending…",
      labelHechos: "Case facts or report (optional)",
      placeholderHechos: "Paste the case report here or drag a .txt file…",
      ayudaHechos:
        "Processed in your browser; the system does not predict outcomes, it only orients based on approved criteria.",
      examinar: "Browse…",
      cargado: "Loaded: ",
      soloTxt: "Only .txt files are supported.",
      etiquetas: ["System decision", "Detected area", "Detected topic", "Criteria used", "Sources used"],
      titulos: {
        answer: "Informational guidance",
        clarify: "I need some clarifications",
        out_of_scope: "Query outside the corpus",
        insufficient_criteria: "Not enough approved criteria",
      },
      limite: {
        titulo: "Your case needs a professional's assessment",
        texto:
          "After several attempts, this tool has not been able to give you complete guidance with the available corpus, so we will not ask you further questions. Your case has nuances best assessed by a lawyer: contact ILP Abogados with the button below and the team will guide you.",
      },
      cta: {
        titulo: "Does your case have further nuances?",
        texto:
          "This guidance is based on a closed corpus of decisions. To resolve the specific questions in your case, contact ILP Abogados.",
        tituloFuerte: "Your case is best assessed by a professional",
        textoFuerte:
          "Your case may involve nuances the corpus does not resolve, or fall outside the analysed decisions. Contact ILP Abogados to resolve your questions.",
        boton: "Contact ILP Abogados",
        emailAsunto: "Request for services — ILP Abogados (trademarks and IP)",
        emailCuerpo:
          "Dear ILP Abogados team,\n\n" +
          "I am writing through your Informational Advisor. I would like to engage your professional " +
          "services in trademark and intellectual property matters and receive an assessment of my case.\n\n" +
          "Summary of my case:\n\n\n" +
          "Contact details:\n- Name:\n- Phone:\n\n" +
          "I look forward to your reply. Best regards.",
      },
      verTodo: "Show full text",
      verTarjetas: "Show as cards",
      fcA11y: { prev: "Previous card", next: "Next card", goto: "Go to card " },
    },
  };
  var TITULOS = UI[getLocale()].titulos;

  // Construye un mailto a ILP con un email-plantilla (asunto + cuerpo) ya redactado
  // pidiendo sus servicios. Codifica para que las tildes y saltos de línea lleguen bien.
  function mailtoILP(cta) {
    return "mailto:atencionalcliente@ilpabogados.com?subject=" +
      encodeURIComponent(cta.emailAsunto) + "&body=" + encodeURIComponent(cta.emailCuerpo);
  }
  // El enlace del email del PIE también abre la plantilla (siempre en español).
  (function () {
    var pieEmail = document.querySelector('.pie a[href^="mailto:"]');
    if (pieEmail) pieEmail.setAttribute("href", mailtoILP(UI.es.cta));
  })();

  function applyLocale(loc) {
    var t = UI[loc] || UI.es;
    TITULOS = t.titulos;
    var set = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
    set("subtitulo", t.subtitulo);
    set("idioma-label", t.idioma);
    set("label-consulta", t.labelConsulta);
    set("enviar", t.enviar);
    set("label-aclaracion", t.labelAclaracion);
    set("enviar-aclaracion", t.enviarAclaracion);
    set("label-hechos", t.labelHechos);
    set("hechos-ayuda", t.ayudaHechos);
    set("examinar", t.examinar);
    if (input) input.setAttribute("placeholder", t.placeholder);
    if (inputAcl) inputAcl.setAttribute("placeholder", t.placeholderAclaracion);
    if (hechos) hechos.setAttribute("placeholder", t.placeholderHechos);
    document.documentElement.setAttribute("lang", loc);
    var etiquetas = document.querySelectorAll(".panel .etiqueta");
    for (var i = 0; i < etiquetas.length && i < t.etiquetas.length; i++) etiquetas[i].textContent = t.etiquetas[i];
    var be = document.getElementById("lang-es"), ben = document.getElementById("lang-en");
    if (be) be.className = "lang" + (loc === "es" ? " activo" : "");
    if (ben) ben.className = "lang" + (loc === "en" ? " activo" : "");
  }

  function texto(valor) {
    return valor === null || valor === undefined || valor === "" ? "—" : String(valor);
  }

  // Pinta la aclaración guiada (pregunta + opciones). Al pulsar una opción se
  // reenvía la consulta con la frase de la opción → ruteo preciso (DOM seguro).
  function renderClarifyOptions(groups) {
    var cont = document.getElementById("clarify-options");
    if (!cont) return;
    cont.textContent = "";
    if (!groups || !groups.length) {
      cont.classList.add("oculto");
      return;
    }
    var loc = getLocale();
    groups.forEach(function (g) {
      var block = document.createElement("div");
      block.className = "clarify-group";
      var q = document.createElement("p");
      q.className = "clarify-q";
      q.textContent = g.question || (loc === "en" ? "Choose the option that fits your case:" : "Elija la opción que encaje con su caso:");
      block.appendChild(q);
      var row = document.createElement("div");
      row.className = "clarify-opts";
      (g.options || []).forEach(function (o) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "opt-btn";
        btn.textContent = o.label;
        btn.addEventListener("click", function () {
          var combinada = (ultimaConsulta ? ultimaConsulta + "\n" : "") + (o.adds || o.label);
          enviarConsulta(combinada, "aclaracion");
        });
        row.appendChild(btn);
      });
      block.appendChild(row);
      cont.appendChild(block);
    });
    cont.classList.remove("oculto");
  }

  // ---- Flashcards de la respuesta ----------------------------------------
  // La respuesta del cerebro llega como UN texto con secciones numeradas
  // ("1. Lo que he entendido", "2. …"). Aquí SOLO se reorganiza la PRESENTACIÓN
  // (una sección por tarjeta); no se altera ni una palabra del contenido.
  var fcState = { cards: [], idx: 0 };

  function parseCards(text) {
    var t = (text || "").trim();
    if (!t) return [];
    // separa antes de cada cabecera "N. " (1-2 dígitos). Las secciones internas
    // (viñetas "• ") no llevan ese patrón, así que no se parten.
    var parts = t.split(/\n+(?=\d{1,2}\.\s)/);
    return parts.map(function (p) {
      var s = p.replace(/^\n+/, "");
      var nl = s.indexOf("\n");
      var first = nl >= 0 ? s.slice(0, nl).trim() : s.trim();
      var m = first.match(/^(\d{1,2})\.\s*(.*)$/);
      if (m) return { num: m[1], title: m[2], body: nl >= 0 ? s.slice(nl + 1) : "" };
      return { num: "", title: "", body: s };
    });
  }

  function fcGoTo(i, instant) {
    var cards = fcState.cards;
    if (!cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i));
    fcState.idx = i;
    var track = document.getElementById("fc-track");
    if (!track) return;
    if (instant) track.style.transition = "none";
    track.style.transform = "translateX(" + (-i * 100) + "%)";
    if (instant) {
      void track.offsetWidth; // forzar reflow para que el reset no se anime
      track.style.transition = "";
    }
    var active = track.children[i];
    var vp = track.parentElement;
    if (active && vp && active.offsetHeight) vp.style.height = active.offsetHeight + "px";
    var dots = document.getElementById("fc-dots");
    if (dots) for (var k = 0; k < dots.children.length; k++) dots.children[k].classList.toggle("activo", k === i);
    var count = document.getElementById("fc-count");
    if (count) count.textContent = i + 1 + " / " + cards.length;
    var prev = elFlashcards && elFlashcards.querySelector(".fc-prev");
    var next = elFlashcards && elFlashcards.querySelector(".fc-next");
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === cards.length - 1;
  }

  // Presentación LEGIBLE del cuerpo de una tarjeta (solo tipografía; el contenido
  // es VERBATIM, Regla 4). Destaca el TÍTULO del criterio en los ítems
  // "• [crit-id] Título: texto" y atenúa la línea "Fuente:". Si una línea no
  // encaja en ese patrón, se muestra tal cual (sin transformar).
  function fcBody(text) {
    function mk(tag, cls, txt) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    }
    var raw = String(text == null ? "" : text).replace(/\s+$/, "");
    var box = mk("div", "fc-body fc-fmt");
    var lines = raw.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.trim()) continue;
      var m = ln.match(/^\s*•\s*\[([^\]]+)\]\s*([^:]{3,110}):\s*(.*)$/);
      if (m) {
        var item = mk("div", "fc-item");
        var head = mk("p", "fc-item-head");
        head.appendChild(mk("strong", "crit-tit", m[2].trim()));
        head.appendChild(mk("span", "crit-id", " · " + m[1]));
        item.appendChild(head);
        if (m[3]) item.appendChild(mk("p", "fc-item-txt", m[3]));
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*•/.test(lines[i + 1])) {
          i++;
          var cont = lines[i].trim();
          item.appendChild(mk("p", /^(Fuente|Source)/.test(cont) ? "fc-fuente" : "fc-item-txt", cont));
        }
        box.appendChild(item);
      } else {
        var lnT = ln.trim();
        var cls = /^\s*•/.test(ln) ? "fc-bullet" : (/^(Fuente:|Source \(in Spanish\):|Source:)/.test(lnT) ? "fc-fuente" : "fc-par");
        box.appendChild(mk("p", cls, lnT));
      }
    }
    if (!box.childNodes.length) { box.className = "fc-body"; box.textContent = raw; }
    return box;
  }

  function renderFlashcards(text) {
    if (!elFlashcards) return false;
    var cards = parseCards(text);
    fcState.cards = cards;
    fcState.idx = 0;
    elFlashcards.textContent = "";
    if (!cards.length) {
      elFlashcards.classList.add("oculto");
      return false;
    }
    var vp = document.createElement("div");
    vp.className = "fc-viewport";
    var track = document.createElement("div");
    track.className = "fc-track";
    track.id = "fc-track";
    cards.forEach(function (c) {
      var card = document.createElement("article");
      card.className = "fc-card";
      if (c.title) {
        var head = document.createElement("div");
        head.className = "fc-card-head";
        if (c.num) {
          var badge = document.createElement("span");
          badge.className = "fc-num";
          badge.textContent = c.num;
          head.appendChild(badge);
        }
        var h = document.createElement("h3");
        h.className = "fc-title";
        h.textContent = c.title;
        head.appendChild(h);
        card.appendChild(head);
      }
      card.appendChild(fcBody(c.body));
      track.appendChild(card);
    });
    vp.appendChild(track);
    elFlashcards.appendChild(vp);

    if (cards.length > 1) {
      var loc = getLocale();
      var labels = (UI[loc] || UI.es).fcA11y || {};
      var nav = document.createElement("div");
      nav.className = "fc-nav";
      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "fc-btn fc-prev";
      prev.setAttribute("aria-label", labels.prev || "Tarjeta anterior");
      prev.textContent = "‹";
      prev.addEventListener("click", function () { fcGoTo(fcState.idx - 1); });
      var dots = document.createElement("span");
      dots.className = "fc-dots";
      dots.id = "fc-dots";
      cards.forEach(function (_, i) {
        var d = document.createElement("button");
        d.type = "button";
        d.className = "fc-dot";
        d.setAttribute("aria-label", (labels.goto || "Ir a la tarjeta ") + (i + 1));
        d.addEventListener("click", function () { fcGoTo(i); });
        dots.appendChild(d);
      });
      var count = document.createElement("span");
      count.className = "fc-count";
      count.id = "fc-count";
      var next = document.createElement("button");
      next.type = "button";
      next.className = "fc-btn fc-next";
      next.setAttribute("aria-label", labels.next || "Tarjeta siguiente");
      next.textContent = "›";
      next.addEventListener("click", function () { fcGoTo(fcState.idx + 1); });
      nav.appendChild(prev);
      nav.appendChild(dots);
      nav.appendChild(count);
      nav.appendChild(next);
      elFlashcards.appendChild(nav);
    }

    // arrastre táctil (móvil)
    var x0 = null;
    vp.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    vp.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) fcGoTo(fcState.idx + (dx < 0 ? 1 : -1));
      x0 = null;
    }, { passive: true });

    elFlashcards.classList.remove("oculto");
    fcGoTo(0, true); // posición + altura + contador iniciales (contenedor ya visible)
    // Re-medir cuando terminen de cargar las webfonts (el font-swap cambia la altura).
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(function () { fcGoTo(fcState.idx, true); });
    return true;
  }
  // Re-medir la tarjeta activa al redimensionar (la altura fija recortaría el texto).
  window.addEventListener("resize", function () { fcGoTo(fcState.idx, true); });

  // teclado: ←/→ cambian de tarjeta (si no se está escribiendo en un campo)
  document.addEventListener("keydown", function (e) {
    if (!elFlashcards || elFlashcards.classList.contains("oculto")) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === "ArrowRight") { fcGoTo(fcState.idx + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { fcGoTo(fcState.idx - 1); e.preventDefault(); }
  });

  // alterna entre tarjetas y texto completo
  if (toggleTexto) {
    toggleTexto.addEventListener("click", function () {
      var loc = getLocale();
      var verFull = elTexto.classList.contains("oculto"); // ahora oculto → mostrarlo
      if (verFull) {
        elTexto.classList.remove("oculto");
        if (elFlashcards) elFlashcards.classList.add("oculto");
        toggleTexto.textContent = (UI[loc] || UI.es).verTarjetas;
      } else {
        elTexto.classList.add("oculto");
        if (elFlashcards) elFlashcards.classList.remove("oculto");
        toggleTexto.textContent = (UI[loc] || UI.es).verTodo;
        fcGoTo(fcState.idx);
      }
    });
  }

  function pintar(data) {
    var decision = data && data.decision ? String(data.decision) : "insufficient_criteria";
    var esRespuestaDeFondo = decision === "answer";
    // Límite de interacciones (petición del despacho): tras 3 intentos seguidos sin
    // respuesta de fondo, la herramienta deja de repreguntar y deriva a ILP Abogados.
    // Política de PRESENTACIÓN (deny-by-default hacia el profesional, Regla 17);
    // el motor, su decisión y la trazabilidad no cambian. Los resultados sintéticos
    // (_tecnico: error de red, falta de aceptación) no cuentan ni activan el límite.
    var tecnico = !!(data && data._tecnico);
    if (esRespuestaDeFondo) { sinRespuesta = 0; } else if (!tecnico) { sinRespuesta += 1; }
    var limite = !esRespuestaDeFondo && !tecnico && sinRespuesta >= 3;
    var LIM = (UI[getLocale()] || UI.es).limite;

    elDecision.textContent = decision;
    elDecision.className = "valor badge " + decision;
    elArea.textContent = texto(data.area);
    elTema.textContent = texto(data.topic);

    // REGLA DEL LOCKED ADVISOR (defensa en cliente): criterios y fuentes solo se
    // muestran si la decisión es "answer". En cualquier otro caso, "—".
    if (esRespuestaDeFondo && Array.isArray(data.criteria_used) && data.criteria_used.length) {
      elCriterios.textContent = data.criteria_used.join(", ");
    } else {
      elCriterios.textContent = "—";
    }

    if (esRespuestaDeFondo && Array.isArray(data.sources_used) && data.sources_used.length) {
      // Nombre LEGIBLE de cada resolución (no el slug interno). Se deduplican las
      // resoluciones citadas; la traza criterio→resolución va en el texto.
      var nombres = [], vistos = {};
      data.sources_used.forEach(function (s) {
        var n = s.resolution || (s.criterion_id + " → " + s.judgment_id);
        if (!vistos[n]) { vistos[n] = 1; nombres.push(n); }
      });
      elFuentes.textContent = nombres.join("; ");
    } else {
      elFuentes.textContent = "—";
    }

    elTitulo.textContent = limite ? LIM.titulo : (TITULOS[decision] || "Respuesta del sistema");
    // El texto ya viene gobernado por la decisión (el backend nunca envía fondo
    // salvo "answer"); se muestra tal cual. El <pre> queda como texto completo
    // alternativo (oculto por defecto: la presentación principal son flashcards).
    // Con el límite alcanzado se muestra la derivación a ILP en lugar de repreguntar.
    elTexto.textContent = limite ? LIM.texto : texto(data.answer_text);
    elTexto.classList.add("oculto");
    elAviso.textContent = data.disclaimer || DISCLAIMER_FIJO();

    // Aclaración GUIADA con opciones (multiple choice) cuando el cerebro repregunta.
    // Con el límite alcanzado deja de repreguntar (se deriva a ILP).
    renderClarifyOptions(!limite && decision === "clarify" ? data.clarify_options : null);

    // La caja de aclaración (texto libre) acompaña a las opciones como alternativa.
    if (formAcl) {
      if (!limite && decision === "clarify") {
        if (inputAcl) inputAcl.value = "";
        formAcl.classList.remove("oculto");
      } else {
        formAcl.classList.add("oculto");
      }
    }

    // Honestidad: ante falta de cobertura o materia no cubierta, se reconoce y se
    // redirige (catálogo / profesional) en vez de improvisar para complacer.
    var sug = document.getElementById("sugerencia");
    if (sug) {
      // Con el límite alcanzado no se sugiere "seguir probando": solo la derivación.
      if (!limite && (decision === "out_of_scope" || decision === "insufficient_criteria")) {
        sug.classList.remove("oculto");
      } else {
        sug.classList.add("oculto");
      }
    }

    // CTA de ILP Abogados al final de CADA consulta (promoción informativa, no
    // asesoramiento). Mensaje reforzado si el caso tiene matices o queda fuera del
    // corpus (out_of_scope / insufficient / clarify): "contáctate con ILP Abogados".
    var cta = document.getElementById("cta-ilp");
    if (cta) {
      var ctaT = (UI[getLocale()] || UI.es).cta;
      var fuerte = limite || decision === "out_of_scope" || decision === "insufficient_criteria" || decision === "clarify";
      var setTxt = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
      setTxt("cta-ilp-titulo", fuerte ? ctaT.tituloFuerte : ctaT.titulo);
      setTxt("cta-ilp-texto", fuerte ? ctaT.textoFuerte : ctaT.texto);
      setTxt("cta-ilp-email", ctaT.boton);
      var ctaEmail = document.getElementById("cta-ilp-email");
      if (ctaEmail) ctaEmail.setAttribute("href", mailtoILP(ctaT));
      if (fuerte) { cta.classList.add("fuerte"); } else { cta.classList.remove("fuerte"); }
      cta.classList.remove("oculto");
    }

    resultado.classList.remove("oculto");

    // Flashcards: se construyen con #resultado YA visible (para medir alturas) y
    // sustituyen al bloque de texto. El botón alterna a "ver todo el texto".
    // Con el límite alcanzado se muestra solo la derivación (sin tarjetas).
    var loc = getLocale();
    var hayCards = !limite && renderFlashcards(texto(data.answer_text));
    if (limite && elFlashcards) { elFlashcards.textContent = ""; elFlashcards.classList.add("oculto"); }
    if (toggleTexto) {
      if (hayCards) {
        elTexto.classList.add("oculto");
        toggleTexto.textContent = (UI[loc] || UI.es).verTodo;
        toggleTexto.classList.remove("oculto");
      } else {
        elTexto.classList.remove("oculto");
        toggleTexto.classList.add("oculto");
      }
    }

    // La vista aterriza al INICIO de la respuesta, no en el CTA del final.
    // (Instantáneo tras asentarse el layout: el suave lo cancelan los ajustes
    // de altura de las tarjetas.)
    requestAnimationFrame(function () { resultado.scrollIntoView({ block: "start" }); });
  }

  function falloSeguro() {
    pintar({
      // _tecnico: los fallos técnicos NO cuentan para el límite de 3 intentos
      // (el mensaje de derivación no debe enmascarar una avería).
      _tecnico: true,
      decision: "insufficient_criteria",
      area: null,
      topic: null,
      answer_text:
        "No se ha podido contactar con el sistema. Por seguridad, no se muestra ninguna " +
        "orientación de fondo.",
      criteria_used: [],
      sources_used: [],
      disclaimer: DISCLAIMER_FIJO(),
    });
  }

  // Envío compartido por la caja principal y la de aclaración. `origen` solo
  // decide qué botón se deshabilita; en ambos casos es UNA consulta completa,
  // nueva e independiente al cerebro (sin estado en servidor).
  function enviarConsulta(texto, origen) {
    var loc = getLocale();
    var esAcl = origen === "aclaracion";
    var btn = esAcl ? botonAcl : boton;
    if (btn) {
      btn.disabled = true;
      btn.textContent = esAcl ? UI[loc].enviandoAclaracion : UI[loc].consultando;
    }

    ultimaConsulta = texto;
    var acceptedVersion = typeof window.LLA_acceptedVersion === "function" ? window.LLA_acceptedVersion() : "";

    fetch("/api/consulta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: texto, accepted_version: acceptedVersion, locale: loc }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.acceptance_required) {
          pintar({
            _tecnico: true, // no cuenta para el límite: solo falta aceptar el aviso
            decision: "insufficient_criteria", area: null, topic: null,
            answer_text: data.message || "Debe aceptar el aviso informativo antes de usar la herramienta.",
            criteria_used: [], sources_used: [], disclaimer: DISCLAIMER_FIJO(),
          });
          return;
        }
        pintar(data);
      })
      .catch(falloSeguro)
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = esAcl ? UI[getLocale()].enviarAclaracion : UI[getLocale()].enviar;
        }
      });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    // La consulta corta y el reporte del caso se COMBINAN en un solo texto de
    // hechos que se envía al cerebro (orienta; nunca pronostica resultado).
    var partes = [input.value.trim(), hechos ? hechos.value.trim() : ""].filter(Boolean);
    var texto = partes.join("\n\n");
    if (!texto) return;
    // Consulta NUEVA → contador de intentos a cero (Regla 7).
    if (texto !== baseConsulta) { baseConsulta = texto; sinRespuesta = 0; }
    enviarConsulta(texto, "principal");
  });

  // --- Hechos / reporte del caso: pegar texto o soltar un .txt (lectura local) ---
  function cargarArchivos(lista) {
    var loc = getLocale();
    var txt = Array.prototype.filter.call(lista || [], function (f) {
      return f && (f.type === "text/plain" || /\.txt$/i.test(f.name));
    });
    if (!txt.length) {
      if (archivosEl) archivosEl.textContent = UI[loc].soloTxt;
      return;
    }
    var nombres = [];
    txt.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        if (hechos) hechos.value = (hechos.value ? hechos.value + "\n\n" : "") + String(reader.result || "");
      };
      reader.readAsText(f);
      nombres.push(f.name);
    });
    if (archivosEl) archivosEl.textContent = UI[loc].cargado + nombres.join(", ");
  }

  if (zonaHechos) {
    ["dragenter", "dragover"].forEach(function (ev) {
      zonaHechos.addEventListener(ev, function (e) {
        e.preventDefault();
        zonaHechos.classList.add("arrastrando");
      });
    });
    ["dragleave", "dragend"].forEach(function (ev) {
      zonaHechos.addEventListener(ev, function () {
        zonaHechos.classList.remove("arrastrando");
      });
    });
    zonaHechos.addEventListener("drop", function (e) {
      e.preventDefault();
      zonaHechos.classList.remove("arrastrando");
      cargarArchivos(e.dataTransfer && e.dataTransfer.files);
    });
  }
  if (btnExaminar && fileInput) {
    btnExaminar.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      cargarArchivos(fileInput.files);
      fileInput.value = "";
    });
  }

  // Responder a las preguntas de aclaración: se COMBINA la consulta previa con
  // lo añadido y se reenvía como una sola consulta nueva (el motor reclasifica
  // con los datos que faltaban). Sucesivas aclaraciones se van acumulando.
  if (formAcl) {
    formAcl.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var respuesta = inputAcl.value.trim();
      if (!respuesta) return;
      var combinada = (ultimaConsulta ? ultimaConsulta + "\n" : "") + respuesta;
      enviarConsulta(combinada, "aclaracion");
    });
  }

  // Selector de idioma. Al cambiar, recarga para que el gate y la config se
  // muestren en el idioma elegido (acceptance.js lee lla:locale).
  var btnEs = document.getElementById("lang-es");
  var btnEn = document.getElementById("lang-en");
  function switchTo(loc) {
    if (getLocale() === loc) return;
    setLocale(loc);
    window.location.reload();
  }
  if (btnEs) btnEs.addEventListener("click", function () { switchTo("es"); });
  if (btnEn) btnEn.addEventListener("click", function () { switchTo("en"); });

  applyLocale(getLocale());
})();
