/*
 * acceptance.js — Gate de ACCESO y ACEPTACIÓN PREVIA (compartido).
 *
 * Se incluye en index.html (chat) y catalog.html (catálogo). Bloquea el uso de
 * la herramienta hasta que el usuario acepta EXPRESAMENTE el aviso vigente.
 *
 * Sin login (por ahora): usa una sesión local aleatoria (session_id) guardada en
 * localStorage; la estructura queda lista para sustituir por un user_id real.
 * Deny-by-default: si no puede leer la configuración del aviso, NO da acceso.
 */
(function () {
  "use strict";

  var SESSION_KEY = "lla:session_id";
  var ACCEPT_KEY = "lla:acceptance"; // { version, session_id, accepted_at }

  function sessionId() {
    var s = null;
    try { s = localStorage.getItem(SESSION_KEY); } catch (e) { s = null; }
    if (!s) {
      s = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(SESSION_KEY, s); } catch (e) { /* sesión efímera */ }
    }
    return s;
  }

  function storedAcceptance() {
    try { return JSON.parse(localStorage.getItem(ACCEPT_KEY) || "null"); } catch (e) { return null; }
  }

  /** Expuesto para que app.js/catalog.js envíen la versión aceptada al backend. */
  window.LLA_acceptedVersion = function () {
    var a = storedAcceptance();
    return a && a.version ? a.version : "";
  };

  // Textos del marco del gate por idioma (el texto de aceptación viene de la config).
  var CHROME = {
    es: {
      title: "Antes de empezar",
      check: " He leído y acepto este aviso.",
      btn: "Acceder a la herramienta",
      registering: "Registrando aceptación…",
      fail: "No se pudo registrar la aceptación. Inténtelo de nuevo.",
      version: "Versión del aviso: ",
      blocked: "No se puede cargar el aviso informativo. Acceso bloqueado por seguridad.",
    },
    en: {
      title: "Before you start",
      check: " I have read and accept this notice.",
      btn: "Enter the tool",
      registering: "Recording acceptance…",
      fail: "Acceptance could not be recorded. Please try again.",
      version: "Notice version: ",
      blocked: "The informational notice could not be loaded. Access blocked for safety.",
    },
  };
  function chrome() { return CHROME[currentLocale()] || CHROME.es; }

  function buildOverlay(config) {
    var c = chrome();
    var overlay = document.createElement("div");
    overlay.className = "lla-gate";

    var card = document.createElement("div");
    card.className = "lla-gate-card";

    var h = document.createElement("h2");
    h.textContent = c.title;
    card.appendChild(h);

    var p = document.createElement("p");
    p.className = "lla-gate-texto";
    p.textContent = config.acceptance_text;
    card.appendChild(p);

    var label = document.createElement("label");
    label.className = "lla-gate-check";
    var check = document.createElement("input");
    check.type = "checkbox";
    label.appendChild(check);
    label.appendChild(document.createTextNode(c.check));
    card.appendChild(label);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.btn;
    btn.disabled = true;
    card.appendChild(btn);

    var msg = document.createElement("p");
    msg.className = "lla-gate-msg";
    card.appendChild(msg);

    var ver = document.createElement("p");
    ver.className = "lla-gate-version";
    ver.textContent = c.version + config.version;
    card.appendChild(ver);

    check.addEventListener("change", function () { btn.disabled = !check.checked; });

    btn.addEventListener("click", function () {
      if (!check.checked) return;
      btn.disabled = true;
      msg.textContent = c.registering;
      fetch("/api/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId(), language: config.language }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok) throw new Error("no ok");
          try {
            localStorage.setItem(ACCEPT_KEY, JSON.stringify({
              version: config.version,
              session_id: sessionId(),
              accepted_at: (data.record && data.record.accepted_at) || new Date().toISOString(),
            }));
          } catch (e) { /* sin persistencia: la aceptación valdrá solo esta carga */ }
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        })
        .catch(function () {
          btn.disabled = false;
          msg.textContent = c.fail;
        });
    });

    overlay.appendChild(card);
    return overlay;
  }

  function blockWithError(text) {
    var overlay = document.createElement("div");
    overlay.className = "lla-gate";
    var card = document.createElement("div");
    card.className = "lla-gate-card";
    var p = document.createElement("p");
    p.className = "lla-gate-msg";
    p.textContent = text;
    card.appendChild(p);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  /** Reconciliación: rellena los banners de la página desde la fuente única. */
  function applyConfig(config) {
    window.LLA_disclaimerConfig = config;
    if (config && config.banner) {
      var banners = document.querySelectorAll("[data-disclaimer-banner]");
      for (var i = 0; i < banners.length; i++) banners[i].textContent = config.banner;
    }
  }

  function currentLocale() {
    try { return localStorage.getItem("lla:locale") === "en" ? "en" : "es"; } catch (e) { return "es"; }
  }

  function start() {
    fetch("/api/disclaimer?locale=" + currentLocale())
      .then(function (r) { return r.json(); })
      .then(function (config) {
        if (!config || !config.version) throw new Error("sin configuración");
        applyConfig(config);
        var a = storedAcceptance();
        // Ya aceptó la versión vigente => no se muestra el gate.
        if (a && a.version === config.version) return;
        document.body.appendChild(buildOverlay(config));
      })
      .catch(function () {
        // Deny-by-default: sin aviso no hay acceso.
        blockWithError(chrome().blocked);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
