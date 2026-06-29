/*
 * catalog.js — Navegación del catálogo (capa de presentación).
 *
 * Solo muestra lo que el backend devuelve (preguntas ya servibles: aprobadas,
 * con respaldo y fuentes). Construye el DOM con textContent (nunca innerHTML con
 * datos: el contenido podría incluir caracteres HTML).
 */
(function () {
  "use strict";

  var nav = document.getElementById("navegacion");
  var lista = document.getElementById("lista-preguntas");
  var detalle = document.getElementById("detalle-pregunta");
  var state = { area: null, topic: null };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function getJSON(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  // --- navegación ---
  function renderNav(tree) {
    nav.textContent = "";
    (tree.areas || []).forEach(function (a) {
      var area = el("div", "area");
      area.appendChild(el("div", "titulo", a.area));
      var ul = el("ul", "temas");
      a.topics.forEach(function (t) {
        var li = el("li", t.approved_count > 0 ? "" : "sin-preguntas");
        li.appendChild(el("span", null, t.topic));
        li.appendChild(el("span", "conteo", String(t.approved_count)));
        if (t.approved_count > 0) {
          li.addEventListener("click", function () {
            selectTopic(a.area, t.topic, li);
          });
        }
        ul.appendChild(li);
      });
      area.appendChild(ul);
      nav.appendChild(area);
    });
  }

  function clearActive() {
    var nodes = nav.querySelectorAll("li.activo");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("activo");
  }

  function selectTopic(area, topic, li) {
    state.area = area;
    state.topic = topic;
    clearActive();
    if (li) li.classList.add("activo");
    detalle.classList.add("oculto");
    lista.classList.remove("oculto");
    getJSON("/api/catalog/questions?area=" + encodeURIComponent(area) + "&topic=" + encodeURIComponent(topic))
      .then(function (data) { renderList(data.items || []); });
  }

  // --- lista de preguntas del tema ---
  function renderList(items) {
    lista.textContent = "";
    if (!items.length) {
      lista.appendChild(el("p", "placeholder", "No hay preguntas aprobadas en este tema todavía."));
      return;
    }
    var ul = el("ul");
    items.forEach(function (q) {
      var li = el("li");
      li.appendChild(el("div", "preg", q.question));
      li.appendChild(el("div", "corta", q.short_answer));
      // Aviso por ítem (Regla 12): el recordatorio acompaña a cada respuesta.
      if (q.disclaimer) li.appendChild(el("div", "aviso-item", q.disclaimer));
      li.addEventListener("click", function () { openQuestion(q.id); });
      ul.appendChild(li);
    });
    lista.appendChild(ul);
  }

  // --- detalle de una pregunta ---
  function listBlock(parent, titulo, arr) {
    if (!arr || !arr.length) return;
    parent.appendChild(el("h3", null, titulo));
    var ul = el("ul");
    arr.forEach(function (x) { ul.appendChild(el("li", null, x)); });
    parent.appendChild(ul);
  }

  function openQuestion(id) {
    getJSON("/api/catalog/question?id=" + encodeURIComponent(id)).then(function (data) {
      var q = data.question;
      detalle.textContent = "";
      if (!q) {
        detalle.classList.remove("oculto");
        lista.classList.add("oculto");
        detalle.appendChild(el("p", "placeholder", "Esta pregunta no está disponible."));
        return;
      }
      var volver = el("span", "volver", "← Volver a las preguntas");
      volver.addEventListener("click", function () {
        detalle.classList.add("oculto");
        lista.classList.remove("oculto");
      });
      detalle.appendChild(volver);
      detalle.appendChild(el("h2", null, q.question));

      detalle.appendChild(el("h3", null, "Respuesta breve"));
      detalle.appendChild(el("p", null, q.short_answer));
      detalle.appendChild(el("h3", null, "Respuesta completa"));
      detalle.appendChild(el("p", null, q.full_answer));

      listBlock(detalle, "Fuentes", q.source_references);
      listBlock(detalle, "Criterios relacionados", q.related_criteria_ids);
      listBlock(detalle, "Límites de esta respuesta", q.limits);

      detalle.appendChild(el("p", "disclaimer", q.disclaimer));

      detalle.classList.remove("oculto");
      lista.classList.add("oculto");
    });
  }

  // arranque
  getJSON("/api/catalog/tree").then(function (data) { renderNav(data.tree || { areas: [] }); });
})();
