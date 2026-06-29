/*
 * uploads.js — Subida de MATERIALES DEL CASO (Case Materials). Capa tonta:
 * lee el archivo localmente (TXT como texto; binarios como base64), lo envía a
 * /api/upload (upload_type fijo a "case_material") y muestra los HECHOS que el
 * backend prepara. NUNCA muestra pronóstico ni recomendación: esto es evidencia
 * del caso para comparar con criterios aprobados, no fuente jurídica.
 */
(function () {
  "use strict";

  var zona = document.getElementById("zona-materiales");
  if (!zona) return;
  var input = document.getElementById("archivo-materiales");
  var btn = document.getElementById("examinar-materiales");
  var lista = document.getElementById("lista-materiales");
  var panel = document.getElementById("hechos-detectados");

  var ALLOWED = ["pdf", "docx", "txt", "png", "jpg", "jpeg"];

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function sessionId() {
    // Misma clave que acceptance.js. Si aún no existe, se genera y persiste.
    try {
      var s = localStorage.getItem("lla:session_id");
      if (!s) {
        s = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : "sess-" + Math.random().toString(36).slice(2);
        localStorage.setItem("lla:session_id", s);
      }
      return s;
    } catch (e) {
      return "sess-efimera";
    }
  }
  function acceptedVersion() {
    return typeof window.LLA_acceptedVersion === "function" ? window.LLA_acceptedVersion() : "";
  }
  function getLocale() {
    try { return localStorage.getItem("lla:locale") === "en" ? "en" : "es"; } catch (e) { return "es"; }
  }
  function question() {
    var c = document.getElementById("consulta");
    return c ? c.value.trim() : "";
  }

  // Lee el archivo en el navegador: TXT -> texto; binario -> base64 (sin cabecera data:).
  function readForUpload(file) {
    return new Promise(function (resolve) {
      var ext = extOf(file.name);
      var reader = new FileReader();
      if (ext === "txt") {
        reader.onload = function () { resolve({ filename: file.name, file_type: "txt", text: String(reader.result || "") }); };
        reader.readAsText(file);
      } else {
        reader.onload = function () {
          var s = String(reader.result || "");
          var comma = s.indexOf(",");
          resolve({ filename: file.name, file_type: ext, base64: comma >= 0 ? s.slice(comma + 1) : s });
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function renderFacts(data, fileObj) {
    panel.textContent = "";
    panel.classList.remove("oculto");
    if (!data || !data.ok) {
      panel.appendChild(el("p", "aviso-item", (data && data.error) || "No se pudo procesar el archivo."));
      return;
    }
    var facts = data.facts || {};
    (data.file && data.file.warnings ? data.file.warnings : []).forEach(function (w) {
      panel.appendChild(el("p", "warning-item", "⚠ " + w));
    });
    if (facts.case_summary) panel.appendChild(el("p", "resumen", facts.case_summary));

    if (facts.relevant_facts && facts.relevant_facts.length) {
      panel.appendChild(el("h3", null, "Hechos detectados (evidencia, trazados al documento)"));
      var ul = el("ul", "hechos-lista");
      facts.relevant_facts.forEach(function (rf) {
        var li = el("li", null);
        li.appendChild(el("span", "hecho-txt", rf.fact_text));
        li.appendChild(el("span", "hecho-fuente", " — " + rf.source_filename + " (" + rf.page_or_location + "), confianza " + rf.confidence));
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }
    if (facts.missing_facts && facts.missing_facts.length) {
      panel.appendChild(el("h3", null, "Datos esenciales que faltan"));
      var um = el("ul", "faltan-lista");
      facts.missing_facts.forEach(function (m) { um.appendChild(el("li", null, m)); });
      panel.appendChild(um);
    }
    (facts.uncertainties || []).forEach(function (u) { panel.appendChild(el("p", "warning-item", "⚠ " + u)); });

    // Si no se pudo extraer el texto (PDF escaneado, imagen, DOCX raro), ofrece
    // leerlo con OCR en el navegador (imágenes/PDF) y/o pegar el texto a mano
    // (el usuario transcribe; no se inventa).
    if (data.file && data.file.extraction_status !== "completed") {
      if (fileObj && ["pdf", "png", "jpg", "jpeg"].indexOf(extOf(fileObj.name)) >= 0) {
        panel.appendChild(ocrBox(fileObj));
      }
      panel.appendChild(pasteFallback());
    }

    panel.appendChild(el("p", "aviso-item",
      "Esto es evidencia del caso, no fuente jurídica, no asesoramiento y no predice el resultado. " +
      "Se compara con los criterios aprobados del corpus."));
  }

  function pasteFallback() {
    var box = el("div", "paste-fallback");
    box.appendChild(el("label", null, "¿No se pudo leer? Pega aquí el texto del documento:"));
    var ta = document.createElement("textarea");
    ta.rows = 4;
    ta.placeholder = "Transcribe o pega el texto del documento (p. ej. del PDF escaneado)…";
    box.appendChild(ta);
    var b = el("button", "enlace", "Procesar texto pegado");
    b.type = "button";
    b.addEventListener("click", function () {
      var t = ta.value.trim();
      if (!t) return;
      b.disabled = true;
      b.textContent = "Procesando…";
      fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload_type: "case_material",
          filename: "texto-pegado.txt",
          file_type: "txt",
          text: t,
          session_id: sessionId(),
          question: question(),
          accepted_version: acceptedVersion(),
          locale: getLocale(),
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { renderFacts(d); })
        .catch(function () { b.disabled = false; b.textContent = "Procesar texto pegado"; });
    });
    box.appendChild(b);
    return box;
  }

  // ---- OCR en el navegador (Tesseract.js + pdf.js, carga PEREZOSA desde CDN) ----
  // El documento NO se sube para reconocerlo: el OCR corre en LOCAL, en tu navegador.
  // El texto reconocido se reenvía a /api/upload como TXT (igual que "pegar texto"),
  // y el backend lo compara con los criterios aprobados del corpus. Esto solo pasa de
  // imagen a texto; el razonamiento jurídico sigue siendo solo del corpus (Regla 2:
  // sin red en la lógica de respuesta — el texto solo viaja a este mismo localhost).
  var _tess = null, _pdfjs = null;
  function loadScript(src) {
    return new Promise(function (ok, err) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { err(new Error("no se pudo cargar el motor (¿sin conexión?)")); };
      document.head.appendChild(s);
    });
  }
  function loadTesseract() {
    if (!_tess) _tess = loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js")
      .then(function () { return window.Tesseract; });
    return _tess;
  }
  function loadPdfjs() {
    if (!_pdfjs) _pdfjs = loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js")
      .then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        return window.pdfjsLib;
      });
    return _pdfjs;
  }
  async function runOCR(fileObj, prog) {
    var T = await loadTesseract();
    var logger = function (m) {
      if (m.status === "recognizing text") prog.textContent = "Reconociendo texto… " + Math.round((m.progress || 0) * 100) + "%";
    };
    if (extOf(fileObj.name) === "pdf") {
      var pdfjs = await loadPdfjs();
      var bytes = new Uint8Array(await fileObj.arrayBuffer());
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
    var ri = await T.recognize(fileObj, "spa", { logger: logger });
    return { text: ri.data.text, truncated: false };
  }
  function ocrBox(fileObj) {
    var box = el("div", "paste-fallback");
    box.appendChild(el("label", null,
      "¿Es un escaneo o una imagen? Léelo aquí mismo con OCR (en tu navegador; el documento NO se sube para reconocerlo):"));
    var b = el("button", "enlace", "Escanear con OCR");
    b.type = "button";
    var prog = el("p", "ocr-prog", "");
    b.addEventListener("click", function () {
      b.disabled = true;
      prog.textContent = "Cargando el motor OCR (la primera vez ~15 MB)…";
      runOCR(fileObj, prog)
        .then(function (res) {
          var text = res && res.text;
          if (!(text && text.replace(/\s+/g, "").length > 10)) {
            prog.textContent = "El OCR no encontró texto legible. Prueba a pegar el texto abajo.";
            b.disabled = false;
            return null;
          }
          prog.textContent = "Texto reconocido; analizando…";
          // Avisos de procedencia que el backend no añade en la rama TXT.
          var ocrWarnings = ["Texto extraído por OCR en el navegador (puede contener errores de reconocimiento)."];
          if (res.truncated) {
            ocrWarnings.push("El documento tiene " + res.total + " páginas; el OCR procesó solo las primeras " + res.processed + ". Para el resto, súbelas aparte o pega el texto.");
          }
          // Reenvía el texto del OCR como TXT (mismo camino que pegar a mano): el
          // backend lo trata como material legible y extrae los hechos del corpus.
          return fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              upload_type: "case_material",
              filename: fileObj.name,
              file_type: "txt",
              text: text.trim(),
              session_id: sessionId(),
              question: question(),
              accepted_version: acceptedVersion(),
              locale: getLocale(),
            }),
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d && d.ok) {
                d.file = d.file || {};
                d.file.warnings = (d.file.warnings || []).concat(ocrWarnings);
              }
              renderFacts(d);
            });
        })
        .catch(function (e) {
          prog.textContent = "✗ " + ((e && e.message) || "no se pudo hacer OCR");
          b.disabled = false;
        });
    });
    box.appendChild(b);
    box.appendChild(prog);
    return box;
  }

  function uploadFiles(files) {
    Array.prototype.slice.call(files || []).forEach(function (file) {
      var ext = extOf(file.name);
      if (ALLOWED.indexOf(ext) < 0) {
        lista.appendChild(el("li", "mal", "✗ " + file.name + " (tipo no admitido)"));
        return;
      }
      var item = el("li", "cargando", "⏳ " + file.name);
      lista.appendChild(item);
      readForUpload(file)
        .then(function (payload) {
          payload.upload_type = "case_material";
          payload.session_id = sessionId();
          payload.question = question();
          payload.accepted_version = acceptedVersion();
          payload.locale = getLocale();
          return fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var okk = data && data.ok;
          item.className = okk ? "ok" : "mal";
          item.textContent = (okk ? "✓ " : "✗ ") + file.name +
            (okk ? " (" + data.file.extraction_status + ")" : " (" + ((data && data.error) || "error") + ")");
          renderFacts(data, file);
        })
        .catch(function () {
          item.className = "mal";
          item.textContent = "✗ " + file.name + " (error de red)";
        });
    });
  }

  ["dragenter", "dragover"].forEach(function (ev) {
    zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("arrastrando"); });
  });
  ["dragleave", "dragend"].forEach(function (ev) {
    zona.addEventListener(ev, function () { zona.classList.remove("arrastrando"); });
  });
  zona.addEventListener("drop", function (e) {
    e.preventDefault();
    zona.classList.remove("arrastrando");
    uploadFiles(e.dataTransfer && e.dataTransfer.files);
  });
  if (btn && input) {
    btn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { uploadFiles(input.files); input.value = ""; });
  }
})();
