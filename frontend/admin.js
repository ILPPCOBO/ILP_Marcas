/*
 * admin.js — Panel de ingesta interno (capa tonta): registra resoluciones, da de
 * alta criterios candidatos (pending_review) y los aprueba/rechaza. NO decide:
 * el servidor re-valida y aplica la puerta (fuente + límites + sin lenguaje vetado).
 */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function post(p, body) { return fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  function get(p) { return fetch(p).then(function (r) { return r.json(); }); }
  function lines(id) { return $(id).value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }

  var pendingPdf = null; // {filename, base64}

  function loadSummary() {
    get("/api/admin/corpus").then(function (d) {
      var c = d.corpus, box = $("resumen"); box.textContent = "";
      box.appendChild(el("h2", null, "Estado del corpus"));
      box.appendChild(el("p", null, c.approved + " criterios aprobados · " + c.pending + " pendientes · " + c.judgments + " resoluciones registradas"));
      var ul = el("ul", "resumen-temas");
      Object.keys(c.by_topic).sort().forEach(function (k) { ul.appendChild(el("li", null, k + ": " + c.by_topic[k])); });
      box.appendChild(ul);
      var dl = $("jids"); dl.textContent = "";
      (c.judgment_ids || []).forEach(function (id) { var o = document.createElement("option"); o.value = id; dl.appendChild(o); });
    });
  }

  function loadPending() {
    get("/api/admin/pending").then(function (d) {
      var box = $("pendientes"); box.textContent = "";
      if (!d.items.length) { box.appendChild(el("p", "hint", "No hay criterios pendientes.")); return; }
      d.items.forEach(function (it) {
        var c = it.criterion, card = el("div", "pend-card");
        card.appendChild(el("h3", null, c.id + " — " + c.area + " / " + c.topic + (c.subtopic ? " / " + c.subtopic : "")));
        card.appendChild(el("p", "pend-jid", "Resolución: " + c.judgment_id + " · fuente: " + c.source_reference));
        card.appendChild(el("p", null, c.criterion_text));
        card.appendChild(el("p", "pend-ex", "Extracto: " + c.source_excerpt));
        card.appendChild(el("p", "pend-lim", "Límites: " + (c.limits || []).join(" · ")));
        if (it.missing_for_approval.length) {
          card.appendChild(el("p", "pend-falta", "No se puede aprobar; faltan/invalidos: " + it.missing_for_approval.join(", ")));
        }
        var acts = el("div", "pend-acts");
        var ap = el("button", null, "Aprobar"); ap.disabled = it.missing_for_approval.length > 0;
        ap.addEventListener("click", function () {
          var by = $("rev-by").value.trim(); if (!by) { alert("Escribe tu nombre (revisor)."); return; }
          post("/api/admin/approve", { id: c.id, by: by }).then(function (r) { if (!r.ok) alert(r.errors.join("\n")); loadSummary(); loadPending(); });
        });
        var rj = el("button", "btn-sec", "Rechazar");
        rj.addEventListener("click", function () {
          var by = $("rev-by").value.trim(); var reason = prompt("Motivo de rechazo:"); if (!reason) return;
          post("/api/admin/reject", { id: c.id, by: by, reason: reason }).then(function () { loadSummary(); loadPending(); });
        });
        acts.appendChild(ap); acts.appendChild(rj); card.appendChild(acts);
        box.appendChild(card);
      });
    });
  }

  // ---- registrar resolución ----
  function readPdf(file) {
    return new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ""); var c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); };
      r.readAsDataURL(file);
    });
  }
  function wireDrop() {
    var z = $("j-zona"), inp = $("j-file");
    async function take(file) {
      if (!file) return;
      if (/\.txt$/i.test(file.name)) { $("j-text").value = await file.text(); pendingPdf = null; }
      else { pendingPdf = { filename: file.name, base64: await readPdf(file) }; $("j-msg").textContent = "PDF listo: " + file.name + " (se extraerá al registrar)."; }
    }
    ["dragenter", "dragover"].forEach(function (e) { z.addEventListener(e, function (ev) { ev.preventDefault(); z.classList.add("arrastrando"); }); });
    ["dragleave", "dragend"].forEach(function (e) { z.addEventListener(e, function () { z.classList.remove("arrastrando"); }); });
    z.addEventListener("drop", function (ev) { ev.preventDefault(); z.classList.remove("arrastrando"); take(ev.dataTransfer.files[0]); });
    $("j-examinar").addEventListener("click", function () { inp.click(); });
    inp.addEventListener("change", function () { take(inp.files[0]); inp.value = ""; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadSummary(); loadPending(); wireDrop();

    $("j-registrar").addEventListener("click", function () {
      var body = {
        title: $("j-title").value.trim(), resolution_number: $("j-resnum").value.trim(),
        court: $("j-court").value.trim(), date: $("j-date").value.trim(), jurisdiction: $("j-juris").value.trim(),
        legal_area: $("j-area").value, topics: $("j-topics").value.trim(), by: $("rev-by").value.trim() || "admin",
        text: $("j-text").value.trim(),
      };
      if (pendingPdf) { body.file_type = "pdf"; body.filename = pendingPdf.filename; body.base64 = pendingPdf.base64; }
      post("/api/admin/register-judgment", body).then(function (r) {
        if (!r.ok) { $("j-msg").textContent = "Error al registrar."; return; }
        $("j-msg").textContent = "✓ Registrada como: " + r.judgment_id;
        $("c-jid").value = r.judgment_id;
        (r.warnings || []).forEach(function (w) { $("j-msg").textContent += " ⚠ " + w; });
        var pre = $("j-fuente") || el("pre", "fuente-text"); pre.id = "j-fuente";
        pre.textContent = r.source_text || "(sin texto extraído — pégalo arriba)";
        if (!$("j-fuente")) $("j-registrar").parentNode.insertBefore(pre, $("j-msg"));
        pendingPdf = null; loadSummary();
      });
    });

    $("c-add").addEventListener("click", function () {
      var body = {
        judgment_id: $("c-jid").value.trim(), area: $("c-area").value, topic: $("c-topic").value.trim(),
        subtopic: $("c-subtopic").value.trim(), criterion_text: $("c-text").value.trim(),
        source_excerpt: $("c-excerpt").value.trim(), source_reference: $("c-ref").value.trim(),
        conditions_for_application: lines("c-cond"), does_not_answer: lines("c-dna"), limits: lines("c-limits"),
        confidence_level: $("c-conf").value, by: $("rev-by").value.trim() || "admin",
      };
      post("/api/admin/add-criterion", body).then(function (r) {
        if (!r.ok) { $("c-msg").textContent = "✗ " + r.errors.join(" "); return; }
        $("c-msg").textContent = "✓ Guardado como pending: " + r.id;
        ["c-topic", "c-subtopic", "c-text", "c-excerpt", "c-ref", "c-cond", "c-dna", "c-limits"].forEach(function (id) { $(id).value = ""; });
        loadSummary(); loadPending();
      });
    });

    $("rev-reload").addEventListener("click", function () { loadSummary(); loadPending(); });
  });
})();
