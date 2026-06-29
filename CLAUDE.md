# CLAUDE.md — Constitución del proyecto

## Locked Legal Advisor

Plataforma de consultas **informativas** sobre derecho marcario y propiedad intelectual.

Este archivo es la **constitución del proyecto**. Toda decisión futura — de producto, de
arquitectura, de implementación o de revisión — debe respetar estas reglas. Si una propuesta
entra en conflicto con este documento, **gana este documento**: la propuesta se rechaza o se
reformula. Ninguna funcionalidad se lanza si no puede cumplir estas reglas.

---

## 1. Qué es (y qué NO es) esta herramienta

**ES** un sistema **cerrado** que responde consultas únicamente a partir de **criterios
jurídicos previamente extraídos, estructurados y aprobados** de resoluciones judiciales ya
analizadas, almacenados en una base de conocimiento interna.

**NO ES**:

- Un chatbot jurídico generalista.
- Un buscador de internet ni un agregador de fuentes externas.
- Una fuente de asesoramiento jurídico profesional.
- Un sistema que responde "según lo que sabe el modelo": el conocimiento jurídico general del
  LLM está prohibido como fuente de respuestas.

---

## 2. Principio rector: deny-by-default

> **Regla 17.** El diseño debe ser deny-by-default: si hay duda, el sistema debe rechazar,
> repreguntar o indicar falta de cobertura — **nunca improvisar**.

Este principio gobierna todas las demás reglas. Ante ambigüedad, falta de cobertura, criterios
no aprobados o errores técnicos, el camino correcto es siempre **rechazar, repreguntar o
declarar los límites**. Generar una respuesta de fondo "por si acaso" es siempre el camino
incorrecto.

---

## 3. Reglas obligatorias

### A. Fuentes de conocimiento — qué puede usar para responder

1. **(Regla 1)** Solo puede responder usando criterios jurídicos guardados en la **base de
   conocimiento interna**.
2. **(Regla 2)** **No puede usar internet.** Ninguna búsqueda web, ningún servicio externo de
   contenido jurídico.
3. **(Regla 3)** **No puede usar el conocimiento jurídico general del modelo.** El LLM, si se
   usa, solo redacta a partir del material recuperado del corpus; no aporta derecho propio.
4. **(Regla 4)** **No puede inventar** leyes, normas, sentencias, citas, criterios ni
   conclusiones. Las citas y referencias a fuentes deben proceder de los metadatos del corpus,
   nunca de generación libre.
5. **(Regla 5)** Solo puede usar criterios con **`approved: true`**. Los criterios en borrador,
   pendientes de revisión o sin fuente válida **no son servibles** al usuario final.

### B. Comportamiento ante incertidumbre

6. **(Regla 6)** Si no encuentra criterios aprobados suficientes, **no responde el fondo** de
   la consulta: indica falta de cobertura.
7. **(Regla 7)** Si la consulta es **ambigua, incompleta o mezcla temas**, hace **preguntas de
   aclaración** antes de intentar responder.
8. **(Regla 8)** Si la consulta está **fuera del alcance del corpus**, lo dice claramente
   (p. ej. "el corpus analizado no cubre esta cuestión"), sin rellenar el vacío con
   conocimiento del modelo.

### C. Transparencia y honestidad

9. **(Regla 9)** Cada respuesta indica **qué criterios usó y de qué resolución procede cada
   uno** (trazabilidad criterio → resolución de origen).
10. **(Regla 10)** La herramienta es **honesta y no complaciente**: si el corpus no apoya la
    tesis del usuario, lo dice con respeto. Nunca adapta la respuesta para agradar ni "estira"
    criterios para que encajen.

### D. Naturaleza informativa — no asesoramiento

11. **(Regla 11)** **Nunca** presenta su respuesta como asesoramiento jurídico.
12. **(Regla 12)** En **cada respuesta** repite que se trata solo de **orientación informativa
    basada en un corpus cerrado**, y que un caso concreto requiere consultar a un profesional.

### E. Ciclo de vida de los criterios — pipeline editorial

13. **(Regla 13)** Las **sentencias originales no se usan directamente** para responder al
    usuario final. Primero deben convertirse en **criterios estructurados y validados**:
    resolución original → extracción → criterio estructurado → revisión humana → aprobado.
14. **(Regla 14)** Los criterios extraídos **automáticamente** quedan siempre como
    **`pending_review`**, nunca como `approved: true`.
15. **(Regla 15)** **Solo una revisión humana puede aprobar criterios.** Ningún proceso
    automático puede promover un criterio a `approved`.

### F. Trazabilidad

16. **(Regla 16)** El sistema guarda trazabilidad de **cada respuesta**: pregunta original,
    criterios usados, fuentes, decisión del motor (responder / repreguntar / rechazar) y
    límites declarados.

### G. Prohibición de pronósticos y recomendaciones directas

18. **(Regla 18)** El sistema **no formula pronósticos de resultado ni recomendaciones
    jurídicas directas**. Nunca dice "probabilidad de ganar", "vas a ganar", "deberías/debes
    demandar (querellarte, reclamar, denunciar, interponer)" ni equivalentes garantistas o
    imperativos. Su única salida es orientación informativa sobre qué criterios del corpus
    podrían ser relevantes y con qué límites; **no anticipa el fallo ni aconseja estrategia
    procesal**. Un guardarraíl léxico determinista veta ese registro y, si apareciera en una
    salida (p. ej. por un criterio mal redactado), la interacción degrada a rechazo seguro
    auditado, nunca a una afirmación imprudente (refuerza las Reglas 10, 11 y 17).

---

## 4. Flujo ideal de una consulta

```
Usuario pregunta
   → 1. Clasificar la consulta
   → 2. Detectar si está dentro del alcance del corpus
   → 3. Detectar información faltante
   → 4. Recuperar criterios aprobados (solo approved: true)
   → 5. Decidir: responder | repreguntar | rechazar   (deny-by-default)
   → 6. Componer la respuesta con fuentes y límites
   → 7. Guardar trazabilidad
```

Detalle de cada paso:

1. **Clasificar la consulta** — identificar idioma, materia y conceptos jurídicos implicados.
2. **Detectar alcance** — comprobar contra el corpus si la cuestión está cubierta. Fuera de
   alcance → declararlo (Regla 8).
3. **Detectar información faltante** — consulta ambigua, incompleta o que mezcla temas →
   preguntas de aclaración (Regla 7).
4. **Recuperar criterios aprobados** — búsqueda solo sobre la base de conocimiento interna,
   filtrada a `approved: true` (Reglas 1 y 5). Sin criterios suficientes → no hay respuesta de
   fondo (Regla 6).
5. **Decidir** — el motor decide entre responder, repreguntar o rechazar. Cualquier duda se
   resuelve hacia repreguntar o rechazar (Regla 17). Esta decisión corresponde a lógica
   determinista y auditable, no al criterio libre del LLM.
6. **Componer la respuesta** — incluye siempre: qué se entendió, los criterios aplicables, la
   resolución de origen de cada criterio, los límites de la respuesta y el recordatorio de que
   es orientación informativa, no asesoramiento (Reglas 9, 11 y 12).
7. **Guardar trazabilidad** — registro por respuesta con pregunta, criterios, fuentes, decisión
   y límites (Regla 16).

---

## 5. Estados de un criterio

| Estado | Significado | ¿Servible al usuario? |
|---|---|---|
| `pending_review` | Extraído (manual o automáticamente), pendiente de revisión humana | **No** |
| `approved: true` | Revisado y aprobado por un humano | **Sí** |
| Rechazado / sin fuente válida | Descartado o sin resolución de origen verificable | **No** |

La aprobación es un **acto humano explícito** (Regla 15). Cualquier puerta de servibilidad debe
tratar como no-servible todo lo que no esté explícitamente aprobado.

---

## 6. Obligaciones para el desarrollo futuro

Cuando se implemente la aplicación (todavía no implementada — este documento es anterior a
cualquier código):

- **Toda vía de respuesta al usuario** (UI, API, catálogo, modo asistido) debe pasar por: filtro
  de aprobación (Regla 5), comprobación de cobertura (Reglas 6–8), citas procedentes de
  metadatos (Regla 4), recordatorio informativo (Reglas 11–12) y trazabilidad (Regla 16).
- **El LLM nunca decide.** Cobertura, decisión responder/repreguntar/rechazar, citas y
  disclaimers son responsabilidad de código determinista y verificable con tests.
- **Ninguna promoción automática a `approved`.** Las herramientas de extracción e ingesta
  escriben siempre `pending_review` (Regla 14).
- **Sin dependencias de red en la lógica de respuesta** (Regla 2).
- **Tests obligatorios para la lógica de seguridad**: rechazo sin cobertura, repregunta ante
  ambigüedad, exclusión de criterios no aprobados, imposibilidad de citas inventadas,
  trazabilidad completa, y veto de pronósticos de resultado / recomendaciones directas
  (Regla 18).
- **Honestidad también en el desarrollo**: si algo no puede cumplir estas reglas, se documenta
  la limitación y se bloquea esa vía de respuesta; no se lanza "provisionalmente".

---

*Creado: 2026-06-11. Cualquier modificación de esta constitución debe ser solicitada
explícitamente por el propietario del proyecto.*
