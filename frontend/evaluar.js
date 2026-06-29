/*
 * evaluar.js — Evaluador de Caso (Case Fit Grade). Sube los documentos del caso
 * (case_material, con case_id), pide /api/evaluate y muestra la calificación de
 * ALINEACIÓN (A–D), nunca una predicción de victoria. Capa tonta: el backend
 * garantiza las reglas (deny-by-default).
 */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function sessionId() {
    try {
      var s = localStorage.getItem("lla:session_id");
      if (!s) { s = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "sess-" + Math.random().toString(36).slice(2); localStorage.setItem("lla:session_id", s); }
      return s;
    } catch (e) { return "sess-x"; }
  }
  function acceptedVersion() { return typeof window.LLA_acceptedVersion === "function" ? window.LLA_acceptedVersion() : ""; }
  function getLocale() { try { return localStorage.getItem("lla:locale") === "en" ? "en" : "es"; } catch (e) { return "es"; } }
  var CASE_ID = "case-" + ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; }
  var ALLOWED = ["pdf", "docx", "txt", "png", "jpg", "jpeg"];

  function readForUpload(file) {
    return new Promise(function (res) {
      var ext = extOf(file.name), r = new FileReader();
      if (ext === "txt") { r.onload = function () { res({ filename: file.name, file_type: "txt", text: String(r.result || "") }); }; r.readAsText(file); }
      else { r.onload = function () { var s = String(r.result || ""); var c = s.indexOf(","); res({ filename: file.name, file_type: ext, base64: c >= 0 ? s.slice(c + 1) : s }); }; r.readAsDataURL(file); }
    });
  }
  function uploadFiles(list) {
    var lista = $("ev-lista");
    Array.prototype.slice.call(list || []).forEach(function (file) {
      var ext = extOf(file.name);
      if (ALLOWED.indexOf(ext) < 0) { lista.appendChild(el("li", "mal", "✗ " + file.name + " (tipo no admitido)")); return; }
      var item = el("li", "cargando", "⏳ " + file.name); lista.appendChild(item);
      readForUpload(file).then(function (p) {
        p.upload_type = "case_material"; p.case_id = CASE_ID; p.session_id = sessionId();
        p.question = $("ev-desc").value.trim(); p.accepted_version = acceptedVersion(); p.locale = getLocale();
        return fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      }).then(function (r) { return r.json(); }).then(function (d) {
        var okk = d && d.ok; item.className = okk ? "ok" : "mal";
        item.textContent = (okk ? "✓ " : "✗ ") + file.name + (okk ? " (" + d.file.extraction_status + ")" : " (" + ((d && d.error) || "error") + ")");
        if (okk && d.file.extraction_status !== "completed" && d.file.warnings && d.file.warnings.length) {
          lista.appendChild(el("li", "cargando", "   ⚠ " + d.file.warnings[0] + " (pega el texto en la descripción)"));
        }
      }).catch(function () { item.className = "mal"; item.textContent = "✗ " + file.name + " (error de red)"; });
    });
  }

  function factorList(title, arr) {
    if (!arr || !arr.length) return null;
    var box = document.createDocumentFragment();
    box.appendChild(el("h3", null, title));
    var ul = el("ul", "factores");
    arr.forEach(function (f) {
      var li = el("li", null);
      li.appendChild(el("span", "f-txt", f.factor));
      li.appendChild(el("span", "f-fuente", " — " + f.explicacion + " [criterio " + f.criterion_id + " · fuente " + (f.resolution || (f.source_reference + " (resolución " + f.judgment_id + ")")) + (f.evidence && f.evidence !== "—" ? " · evidencia: " + f.evidence : "") + "]"));
      ul.appendChild(li);
    });
    box.appendChild(ul); return box;
  }

  function render(ev) {
    var panel = $("ev-resultado"); panel.textContent = ""; panel.classList.remove("oculto");
    if (ev.case_fit_grade === "insuficiente" || ev.case_fit_score === null) {
      panel.appendChild(el("h2", null, "No se puede calificar todavía"));
      panel.appendChild(el("p", "ev-reason", ev.reason || "Datos insuficientes."));
      if (ev.classified_area) panel.appendChild(el("p", "ev-meta", "Asunto detectado: " + ev.classified_area + (ev.classified_topic ? " / " + ev.classified_topic : "")));
      if (ev.next_information_needed && ev.next_information_needed.length) {
        panel.appendChild(el("h3", null, "Información necesaria para continuar"));
        var u = el("ul", "factores"); ev.next_information_needed.forEach(function (m) { u.appendChild(el("li", null, m)); }); panel.appendChild(u);
      }
      panel.appendChild(el("p", "aviso-item", ev.limits[0] || ""));
      panel.appendChild(el("p", "aviso-item", ev.disclaimer));
      return;
    }
    var head = el("div", "grade-head");
    head.appendChild(el("div", "grade-badge grade-" + ev.case_fit_grade, ev.case_fit_grade));
    var info = el("div", "grade-info");
    info.appendChild(el("div", "grade-label", "Calificación de alineación con criterios del corpus: " + ev.case_fit_grade + " — " + ev.score_label));
    info.appendChild(el("div", "grade-sub", "Score orientativo: " + ev.case_fit_score + "/100 · Confianza: " + ev.confidence_level));
    head.appendChild(info); panel.appendChild(head);

    panel.appendChild(el("h3", null, "Resumen del caso entendido"));
    panel.appendChild(el("p", "ev-summary", ev.case_summary));

    var fav = factorList("Factores favorables (alineados con criterios)", ev.favorable_factors); if (fav) panel.appendChild(fav);
    var unf = factorList("Factores desfavorables (cuestiones que el corpus no resuelve)", ev.unfavorable_factors); if (unf) panel.appendChild(unf);
    if (ev.uncertain_factors && ev.uncertain_factors.length) {
      panel.appendChild(el("h3", null, "Factores inciertos"));
      var ui = el("ul", "factores");
      ev.uncertain_factors.forEach(function (u) { var li = el("li", null); li.appendChild(el("span", "f-txt", u.factor)); li.appendChild(el("span", "f-fuente", " — " + u.why_it_matters + " Falta: " + u.what_is_missing)); ui.appendChild(li); });
      panel.appendChild(ui);
    }
    if (ev.missing_facts && ev.missing_facts.length) {
      panel.appendChild(el("h3", null, "Información faltante"));
      var um = el("ul", "factores"); ev.missing_facts.forEach(function (m) { um.appendChild(el("li", null, m)); }); panel.appendChild(um);
    }
    panel.appendChild(el("h3", null, "Criterios usados y fuentes"));
    var uc = el("ul", "factores"); ev.criteria_used.forEach(function (c) { uc.appendChild(el("li", null, c.criterion_id + " · " + (c.resolution || (c.source_reference + " (resolución " + c.judgment_id + ")")))); }); panel.appendChild(uc);
    if (ev.evidence_used && ev.evidence_used.length) panel.appendChild(el("p", "sb-ev", "Evidencia usada: " + ev.evidence_used.join(", ")));
    panel.appendChild(el("h3", null, "Límites"));
    var ul2 = el("ul", "factores"); ev.limits.forEach(function (l) { ul2.appendChild(el("li", null, l)); }); panel.appendChild(ul2);
    panel.appendChild(el("p", "aviso-item", ev.disclaimer));
  }

  document.addEventListener("DOMContentLoaded", function () {
    var z = $("ev-zona"), inp = $("ev-file");
    ["dragenter", "dragover"].forEach(function (e) { z.addEventListener(e, function (ev) { ev.preventDefault(); z.classList.add("arrastrando"); }); });
    ["dragleave", "dragend"].forEach(function (e) { z.addEventListener(e, function () { z.classList.remove("arrastrando"); }); });
    z.addEventListener("drop", function (ev) { ev.preventDefault(); z.classList.remove("arrastrando"); uploadFiles(ev.dataTransfer.files); });
    $("ev-examinar").addEventListener("click", function () { inp.click(); });
    inp.addEventListener("change", function () { uploadFiles(inp.files); inp.value = ""; });

    $("form-eval").addEventListener("submit", function (e) {
      e.preventDefault();
      var desc = $("ev-desc").value.trim();
      var panel = $("ev-resultado"); panel.classList.remove("oculto"); panel.textContent = "";
      if (!desc) { panel.appendChild(el("p", "ev-reason", "Describe brevemente el caso antes de analizar.")); return; }
      panel.appendChild(el("p", "ev-reason", "Analizando…"));
      fetch("/api/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, case_name: $("ev-nombre").value.trim(), asunto_hint: $("ev-asunto").value, case_id: CASE_ID, session_id: sessionId(), locale: getLocale(), accepted_version: acceptedVersion() }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.acceptance_required) { panel.textContent = ""; panel.appendChild(el("p", "ev-reason", "Debes aceptar el aviso antes de usar la herramienta.")); return; }
        if (!d || !d.ok) { panel.textContent = ""; panel.appendChild(el("p", "ev-reason", "No se pudo evaluar.")); return; }
        render(d.evaluation); panel.scrollIntoView({ block: "start" });
      }).catch(function () { panel.textContent = ""; panel.appendChild(el("p", "ev-reason", "Error de red.")); });
    });
  });
})();
