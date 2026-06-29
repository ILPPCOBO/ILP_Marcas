/*
 * app.js — Panel interno de revisión (capa de presentación).
 *
 * No contiene lógica de aprobación: envía las acciones al backend, que delega en
 * services/ingestion y RE-VALIDA todo. El panel solo facilita la revisión.
 */
(function () {
  "use strict";

  var state = { items: [], selectedId: null };

  var $ = function (id) { return document.getElementById(id); };
  var EDIT_TEXT = ["topic", "subtopic", "criterion_text", "source_reference"];
  var EDIT_LIST = ["conditions_for_application", "does_not_answer", "limits"];

  function linesToArray(text) {
    var out = [];
    text.split("\n").forEach(function (l) {
      var t = l.trim();
      // El modelo exige listas SIN duplicados: se descartan líneas repetidas
      // para que un duplicado accidental no bloquee la aprobación.
      if (t.length > 0 && out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }
  function arrayToLines(arr) { return Array.isArray(arr) ? arr.join("\n") : ""; }

  function setMessage(text, kind) {
    var m = $("mensaje");
    m.textContent = text || "";
    m.className = "mensaje" + (kind ? " " + kind : "");
  }

  // Crea un <div class="clase"> con texto seguro (textContent, nunca innerHTML:
  // los datos provienen de criterios/resoluciones introducidos por humanos y
  // podrían contener HTML).
  function div(cls, text) {
    var d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    return d;
  }

  function renderList() {
    var ul = $("pendientes");
    ul.textContent = "";
    $("vacio").classList.toggle("oculto", state.items.length > 0);
    state.items.forEach(function (item) {
      var c = item.criterion;
      var li = document.createElement("li");
      li.className = c.id === state.selectedId ? "activo" : "";
      li.appendChild(div("cid", c.id));
      li.appendChild(div("meta", c.area + " / " + c.topic));
      if (item.missing_for_approval.length) {
        li.appendChild(div("bloqueo", "faltan: " + item.missing_for_approval.join(", ")));
      }
      li.addEventListener("click", function () { select(c.id); });
      ul.appendChild(li);
    });
  }

  function select(id) {
    state.selectedId = id;
    var item = state.items.find(function (i) { return i.criterion.id === id; });
    if (!item) return;
    var c = item.criterion;
    $("placeholder").classList.add("oculto");
    $("detalle").classList.remove("oculto");

    // Resolución fuente (solo lectura). textContent: nunca innerHTML con datos
    // de la resolución (title/court… los introduce un humano).
    var j = item.judgment;
    var fm = $("fuente-meta");
    fm.textContent = "";
    if (j) {
      var t = document.createElement("strong");
      t.textContent = j.title || "";
      fm.appendChild(t);
      fm.appendChild(document.createElement("br"));
      fm.appendChild(document.createTextNode(j.court + " · " + j.date + " · " + j.resolution_number));
    } else {
      var w = div("", "⚠️ Resolución no registrada");
      w.style.color = "var(--warn)";
      fm.appendChild(w);
    }
    $("source_excerpt").value = c.source_excerpt || "";
    $("judgment_id_ro").textContent = c.judgment_id || "(vacío)";

    // Campos editables
    $("area").value = c.area;
    EDIT_TEXT.forEach(function (f) { $(f).value = c[f] == null ? "" : c[f]; });
    EDIT_LIST.forEach(function (f) { $(f).value = arrayToLines(c[f]); });

    // Estado de aprobación
    var missing = item.missing_for_approval;
    var box = $("estado-aprobacion");
    if (missing.length) {
      box.className = "estado-aprobacion bloqueado";
      box.textContent = "No se puede aprobar: faltan " + missing.join(", ") + ".";
    } else {
      box.className = "estado-aprobacion ok";
      box.textContent = "Listo para aprobar (cumple los campos obligatorios).";
    }
    $("aprobar").disabled = missing.length > 0;
    setMessage("");
    renderList();
  }

  function buildEdits() {
    var edits = {};
    edits.area = $("area").value;
    edits.topic = $("topic").value;
    var sub = $("subtopic").value.trim();
    edits.subtopic = sub.length ? sub : null;
    edits.criterion_text = $("criterion_text").value;
    edits.source_reference = $("source_reference").value;
    EDIT_LIST.forEach(function (f) { edits[f] = linesToArray($(f).value); });
    return edits;
  }

  function reviewerOrWarn() {
    var by = $("revisor").value.trim();
    if (!by) { setMessage("Escriba su nombre de revisor antes de aprobar/rechazar/guardar.", "error"); return null; }
    return by;
  }

  function post(path, payload) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); });
  }

  function load() {
    return fetch("/api/pending").then(function (r) { return r.json(); }).then(function (data) {
      state.items = (data && data.items) || [];
      if (!state.items.some(function (i) { return i.criterion.id === state.selectedId; })) {
        state.selectedId = null;
        $("detalle").classList.add("oculto");
        $("placeholder").classList.remove("oculto");
      }
      renderList();
      if (state.selectedId) select(state.selectedId);
    });
  }

  // --- acciones ---
  $("guardar").addEventListener("click", function () {
    var by = reviewerOrWarn(); if (!by) return;
    post("/api/save", { id: state.selectedId, by: by, edits: buildEdits() }).then(function (r) {
      if (r.ok) { setMessage("Cambios guardados (sigue en pending_review).", "exito"); load(); }
      else setMessage("No guardado: " + (r.errors || []).join("; "), "error");
    });
  });

  $("aprobar").addEventListener("click", function () {
    var by = reviewerOrWarn(); if (!by) return;
    post("/api/approve", { id: state.selectedId, by: by, edits: buildEdits() }).then(function (r) {
      if (r.ok) { setMessage("Criterio aprobado y movido a approved_criteria.", "exito"); load(); }
      else setMessage("No aprobado: " + (r.errors || []).join("; "), "error");
    });
  });

  $("rechazar").addEventListener("click", function () {
    var by = reviewerOrWarn(); if (!by) return;
    var reason = window.prompt("Motivo del rechazo (rejected_reason):", "");
    if (reason === null || !reason.trim()) { setMessage("Rechazo cancelado: falta el motivo.", "error"); return; }
    post("/api/reject", { id: state.selectedId, by: by, reason: reason }).then(function (r) {
      if (r.ok) { setMessage("Criterio rechazado.", "exito"); load(); }
      else setMessage("No rechazado: " + (r.errors || []).join("; "), "error");
    });
  });

  $("recargar").addEventListener("click", function () { load(); });

  // --- subida de resolución (corpus document) ---
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function readFileForUpload(file) {
    return new Promise(function (resolve) {
      var ext = extOf(file.name);
      var reader = new FileReader();
      if (ext === "txt") {
        reader.onload = function () { resolve({ filename: file.name, file_type: "txt", text: String(reader.result || "") }); };
        reader.readAsText(file);
      } else {
        reader.onload = function () {
          var s = String(reader.result || ""); var comma = s.indexOf(",");
          resolve({ filename: file.name, file_type: ext, base64: comma >= 0 ? s.slice(comma + 1) : s });
        };
        reader.readAsDataURL(file);
      }
    });
  }
  function upMessage(text, kind) {
    var m = $("up-mensaje"); m.textContent = text || ""; m.className = "mensaje" + (kind ? " " + kind : "");
  }
  function topicsFromInput() {
    return $("up-topics").value.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t.length; });
  }

  $("up-subir").addEventListener("click", function () {
    var by = reviewerOrWarn(); if (!by) return;
    var input = $("up-archivo");
    var file = input.files && input.files[0];
    if (!file) { upMessage("Seleccione un archivo de resolución.", "error"); return; }
    upMessage("Subiendo y extrayendo…");
    readFileForUpload(file).then(function (payload) {
      payload.by = by;
      payload.judgment = {
        id: $("up-id").value.trim() || undefined,
        title: $("up-title").value.trim(),
        court: $("up-court").value.trim(),
        date: $("up-date").value.trim(),
        resolution_number: $("up-resnum").value.trim(),
        legal_area: $("up-area").value,
        jurisdiction: $("up-jur").value.trim(),
        topics: topicsFromInput(),
      };
      return post("/api/upload", payload);
    }).then(function (r) {
      if (!r.ok) { upMessage("No se pudo registrar: " + (r.errors || []).join("; "), "error"); return; }
      var nCrit = (r.extracted && r.extracted.written ? r.extracted.written.length : 0);
      var msg = "Resolución registrada (" + r.judgment.id + "). Texto: " + r.uploaded.extraction_status +
        ". Criterios pending: " + nCrit + ".";
      if (r.extracted && r.extracted.note) msg += " " + r.extracted.note;
      if (r.uploaded.warnings && r.uploaded.warnings.length) msg += " ⚠ " + r.uploaded.warnings.join("; ");
      upMessage(msg, "exito");
      if (r.source_text) {
        $("up-texto").textContent = r.source_text;
        $("up-texto-wrap").classList.remove("oculto");
      }
      load();
    }).catch(function () { upMessage("Error de red al subir.", "error"); });
  });

  load();
})();
