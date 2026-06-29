# Guía de uso — ILP · Asesor Informativo

> **Inteligencia que entiende tu negocio.**
>
> Asistente informativo de **corpus cerrado** para derecho de **marcas** y **propiedad
> intelectual** (marcas, propiedad intelectual, patentes y materia procesal).
> Motor: *Locked Legal Advisor*. Identidad: **ILP Abogados**.

---

## Qué es y qué no es

**ILP · Asesor Informativo** es una herramienta interna que responde consultas de marcas y
propiedad intelectual **únicamente a partir de criterios jurídicos aprobados por una persona**,
extraídos de resoluciones reales ya analizadas. Cita siempre la resolución de origen de cada
criterio, muestra en cada respuesta un aviso de que se trata de orientación informativa y, ante
cualquier duda o falta de cobertura, **prefiere repreguntar o declarar sus límites antes que
improvisar**. **No** es un chatbot generalista, **no** busca en internet, **no** es
asesoramiento jurídico profesional y **nunca** predice quién ganará un caso ni calcula una
"probabilidad de ganar".

---

## Índice

1. [A quién está dirigida esta guía](#1-a-quién-está-dirigida-esta-guía)
2. [Principios que rigen la herramienta](#2-principios-que-rigen-la-herramienta)
3. [Cómo piensa: el pipeline del motor](#3-cómo-piensa-el-pipeline-del-motor)
4. [Cómo abrir la herramienta](#4-cómo-abrir-la-herramienta)
5. [Modos de uso](#5-modos-de-uso)
   - [5.1 Consulta específica asistida](#51-consulta-específica-asistida)
   - [5.2 Materiales del caso](#52-materiales-del-caso)
   - [5.3 Score de alineación con el corpus](#53-score-de-alineación-con-el-corpus)
   - [5.4 Evaluador de caso (Case Fit Grade)](#54-evaluador-de-caso-case-fit-grade)
   - [5.5 Catálogo de preguntas estándar](#55-catálogo-de-preguntas-estándar)
   - [5.6 Panel de ingesta (editor/admin)](#56-panel-de-ingesta-editoradmin)
6. [Guardrails: lo que la herramienta NO hará](#6-guardrails-lo-que-la-herramienta-no-hará)
7. [Cómo leer una respuesta](#7-cómo-leer-una-respuesta)
8. [Ejemplos realistas](#8-ejemplos-realistas)
9. [Preguntas frecuentes (FAQ)](#9-preguntas-frecuentes-faq)
10. [Glosario rápido](#10-glosario-rápido)

---

## 1. A quién está dirigida esta guía

Esta guía está pensada para dos perfiles dentro del despacho:

- **Abogados y usuarios finales** — quienes hacen consultas, suben materiales de un caso y leen
  las respuestas para orientarse. Les interesan sobre todo las secciones 4, 5.1 a 5.5, 7 y 8.
- **Editor / administrador del corpus** — la persona responsable de hacer crecer la base de
  conocimiento: registrar resoluciones, redactar criterios y aprobarlos. Le interesa
  especialmente la sección 5.6 (Panel de ingesta), además del resto como contexto.

No hace falta tener conocimientos técnicos para usar la herramienta. Sí conviene entender **qué
puede y qué no puede** hacer, porque su valor está precisamente en sus límites.

---

## 2. Principios que rigen la herramienta

La herramienta se rige por una **constitución de 18 reglas** (el archivo `CLAUDE.md` del
proyecto). No es necesario memorizarlas, pero sí conviene conocer los principios que verás
reflejados en cada respuesta:

1. **Solo criterios aprobados por humanos.** Responde únicamente con criterios jurídicos
   previamente extraídos, estructurados y **aprobados por una persona**. Los criterios en
   borrador o pendientes de revisión **no se usan**.
2. **Cita siempre la fuente.** Cada criterio que utiliza indica de qué **resolución de origen**
   procede. La trazabilidad criterio → resolución es obligatoria.
3. **Deny-by-default (rechazo por defecto).** Ante ambigüedad, falta de cobertura o duda, el
   camino correcto es **repreguntar, declarar falta de cobertura o decir "fuera de alcance"**,
   nunca improvisar una respuesta de fondo.
4. **Aviso informativo en cada respuesta.** Toda salida recuerda que es **orientación
   informativa basada en un corpus cerrado**, no asesoramiento jurídico, y que un caso concreto
   requiere un profesional.
5. **Nunca inventa.** No fabrica leyes, normas, sentencias, citas ni criterios. Las referencias
   provienen de los metadatos del corpus, jamás de generación libre.
6. **No usa internet ni el "conocimiento general" del modelo.** El corpus interno es la **única**
   fuente. Si algo no está en el corpus, la herramienta lo dice.
7. **Nunca pronostica resultados.** No dice si vas a ganar o perder, no calcula probabilidades
   de victoria y no recomienda demandar. Si se lo pides directamente, lo rechaza y lo explica.
8. **Honesta, no complaciente.** Si el corpus no apoya tu tesis, te lo dirá con respeto. No
   "estira" criterios para que encajen ni adapta la respuesta para agradar.

---

## 3. Cómo piensa: el pipeline del motor

Antes de responder, el motor sigue siempre la misma secuencia determinista. Entender este
recorrido ayuda a interpretar por qué a veces **repregunta** o dice **"fuera de alcance"** en
lugar de contestar:

1. **Clasifica la consulta** — identifica idioma, materia (marcas, PI, patentes, procesal) y los
   conceptos jurídicos implicados.
2. **Comprueba si está dentro del corpus** — verifica si la cuestión está cubierta por criterios
   aprobados. Si no lo está, lo declara como **fuera de alcance**.
3. **Detecta datos faltantes** — si la consulta es ambigua, incompleta o mezcla temas, prepara
   **preguntas de aclaración**.
4. **Recupera SOLO criterios aprobados** — busca únicamente en la base de conocimiento interna,
   filtrando a los criterios con estado `approved`. Si no hay criterios suficientes, **no
   responde el fondo**: indica falta de cobertura.
5. **Decide** entre cuatro caminos posibles:
   - **Responder** — hay cobertura suficiente y datos suficientes.
   - **Repreguntar** — faltan datos esenciales para una respuesta fiable.
   - **Fuera de alcance** — el corpus no cubre la materia.
   - **Sin cobertura suficiente** — la materia encaja, pero no hay criterios aprobados bastantes.
6. **Compone la respuesta** — reúne los criterios aplicables + sus fuentes + los límites de la
   respuesta + el aviso informativo.
7. **Guarda traza de auditoría** — registra la pregunta original, los criterios usados, las
   fuentes, la decisión del motor y los límites declarados.

> **Punto clave:** la decisión de responder / repreguntar / rechazar la toma **lógica
> determinista y auditable**, no la libre voluntad del modelo de lenguaje. El modelo, cuando se
> usa, solo **redacta** a partir del material que ya se recuperó del corpus.

---

## 4. Cómo abrir la herramienta

Hay dos formas de abrir ILP · Asesor Informativo. La diferencia importante entre ellas es el
**OCR** (la lectura automática de PDFs escaneados e imágenes).

### Opción A — El lanzador (recomendada, con OCR)

1. Ve al **Escritorio**.
2. Haz **doble clic** en el archivo:

   ```
   ~/Desktop/Abrir Locked Advisor.command
   ```

3. Esto arranca el **servidor local** (incluye el motor de OCR) y abre la herramienta en tu
   navegador automáticamente.

Con esta opción dispones de **todas** las funciones, incluida la lectura por OCR de PDFs
escaneados e imágenes.

### Opción B — El HTML offline (sin servidor, SIN OCR)

1. Ve al **Escritorio**.
2. Abre el archivo:

   ```
   ~/Desktop/Locked Legal Advisor.html
   ```

Esta versión funciona **sin servidor**, pero **no realiza OCR**. Si subes un PDF escaneado o una
imagen, te pedirá que **pegues tú el texto** manualmente.

> **Regla práctica:** si vas a trabajar con documentos escaneados o fotos, usa **siempre el
> lanzador (Opción A)**. El OCR de PDFs escaneados solo está disponible con el servidor.

---

## 5. Modos de uso

La herramienta ofrece seis modos. Los cinco primeros son para todos los usuarios; el sexto es el
panel interno del editor/admin.

---

### 5.1 Consulta específica asistida

Es el modo principal: una consulta en lenguaje natural sobre marcas o propiedad intelectual, con
la posibilidad de aportar los hechos del caso.

**Pasos:**

1. **Escribe tu consulta** en el cuadro de texto.
2. *(Opcional)* **Pega o arrastra los hechos del caso** en formato `.txt`. Cuantos más hechos
   relevantes aportes, mejor podrá el motor comprobar la cobertura.
3. Envía la consulta.
4. **Si faltan datos**, el sistema **repregunta**: aparecerá un **segundo recuadro** para que
   respondas a las preguntas de aclaración.
5. Al enviar esa segunda respuesta, el motor **combina todo** (consulta original + hechos +
   aclaraciones) y **reevalúa**.

**Qué obtienes (salida):**

- La **decisión** del motor (responder / repreguntar / fuera de alcance / sin cobertura).
- El **área y tema** detectados.
- Los **criterios usados**.
- Las **fuentes** (la resolución de origen de cada criterio).
- El **texto** de la respuesta.
- El **aviso** de orientación informativa.

**Ejemplo realista (riesgo de confusión):**

> *Consulta:* "¿Cómo se valora el riesgo de confusión entre dos signos denominativos similares
> que distinguen productos de la misma clase?"
>
> *Posible repregunta del sistema:* "Para acotar la respuesta, ¿los signos coinciden en el
> elemento dominante? ¿Los productos son idénticos o solo afines?"
>
> *Tras tu aclaración,* el motor responde con los criterios aprobados sobre comparación de
> signos y de productos/servicios, citando la resolución de origen de cada uno, y cerrando con
> los límites y el aviso informativo.

---

### 5.2 Materiales del caso

Sirve para aportar **documentos del propio caso** (escritos, resoluciones notificadas, pruebas)
para que el sistema los compare con los criterios aprobados.

**Formatos admitidos:** `PDF`, `DOCX`, `TXT`, `PNG`, `JPG`, `JPEG`.

**Cómo extrae el texto (todo en local):**

1. **PDF con capa de texto** → se lee de forma **directa**.
2. **PDF escaneado o imagen** → se lee mediante **OCR**, con el motor nativo de **macOS Vision**.
3. **Si no hay texto legible** → el sistema te pide que **pegues el texto** manualmente.

**Qué tener muy claro sobre este modo:**

- Los documentos que subes son **solo hechos y evidencia del caso**, **NUNCA** una fuente
  jurídica. Es decir: nunca se convierten en criterio ni en cita. Solo se **comparan** con los
  criterios ya aprobados del corpus.
- La lectura es **local, sin red** (cumple la Regla 2: no se usa internet). Tus documentos no
  salen a ningún servicio externo.
- El sistema **nunca inventa contenido** (Regla 4): si no puede leer un documento, lo dice y te
  pide el texto; no rellena huecos.
- **No predice el resultado** a partir de tus documentos.

**Ejemplo realista:**

> Subes el escrito de oposición y la resolución notificada en formato PDF escaneado. El motor
> aplica OCR (vía el lanzador), extrae los hechos relevantes y los confronta con los criterios
> aprobados sobre, por ejemplo, **mala fe en el registro**. Te muestra qué hechos del caso
> encajan con esos criterios y cuáles no están cubiertos — sin afirmar quién ganará.

---

### 5.3 Score de alineación con el corpus

Es una **métrica de cobertura**, no una predicción.

> **Importante:** el score **NO** es una "probabilidad de ganar". Es una **métrica
> determinista** que mide cuántos **hechos esenciales** del caso encuentran apoyo en los
> **criterios aprobados** del corpus.

**Cómo se usa:**

1. Aporta la consulta y/o los hechos del caso (ver 5.1 y 5.2).
2. Pulsa el botón **"Ver score de alineación"**.

**Qué muestra:**

- **Factores favorables** — hechos del caso que coinciden con criterios aprobados.
- **Factores desfavorables** — hechos que apuntan en contra según los criterios.
- **Factores inciertos** — hechos que no se pueden alinear con claridad.

Cada factor está **atado a un criterio concreto y a su fuente** (la resolución de origen). Así
puedes rastrear de dónde sale cada punto del score.

**Ejemplo realista:**

> En un caso de **riesgo de confusión**, un factor favorable podría ser "identidad de la clase
> de productos" (atado a un criterio aprobado con su resolución), mientras que "coexistencia
> previa pacífica entre las marcas" podría aparecer como factor incierto si el corpus no tiene
> criterios aprobados que lo cubran con claridad.

---

### 5.4 Evaluador de caso (Case Fit Grade)

Califica con una **letra** la **alineación del caso con el corpus**. No dice quién gana.

> **Importante:** el grado mide **alineación con criterios aprobados**, **no** la probabilidad de
> victoria.

**Escala:**

| Grado | Significado |
|---|---|
| **A** | Alta alineación con el corpus y **sin datos esenciales faltantes**. |
| **B** | Alineación media. |
| **C** | Alineación media (menor que B). |
| **D** | Baja alineación con el corpus. |
| **Insuficiente** | No se puede calificar. |

**Cuándo NO califica (y devuelve "insuficiente" o un rechazo):**

- La consulta está **fuera del alcance** del corpus.
- **No hay criterios aprobados** aplicables.
- **Faltan hechos esenciales** del caso.
- Los **documentos son ilegibles** (y no se pudo pegar el texto).
- El usuario **pide una predicción de victoria** → en ese caso se **rechaza** y se **explica** por
  qué (la herramienta no pronostica resultados).

**Campos del formulario:**

1. **Descripción del caso.**
2. **Tipo de asunto** (como *pista* para clasificar: marcas, PI, patentes, procesal).
3. **Documentos** del caso (opcional, mismos formatos que en 5.2).

**Salida:** el grado (A/B/C/D/insuficiente) **siempre** acompañado de su **disclaimer** y de los
**límites** de la evaluación.

**Ejemplo realista:**

> Describes un caso de **cosa juzgada en lo procesal**, indicas el tipo de asunto "procesal" y
> adjuntas la resolución previa. Si el corpus tiene criterios aprobados sobre identidad de
> partes, objeto y causa, y tú aportaste esos hechos, podrías obtener un grado **A** o **B**.
> Si pides "dime si voy a ganar la excepción", la herramienta **rechaza** la calificación y te
> explica que no formula pronósticos.

---

### 5.5 Catálogo de preguntas estándar

Es un repositorio de **respuestas preaprobadas**, organizadas por **área y tema**.

**Características:**

- **No hay generación**: las respuestas están escritas y aprobadas de antemano.
- Cada entrada incluye sus **criterios** y sus **fuentes** (resolución de origen).
- Útil para consultas frecuentes y bien delimitadas, donde no hace falta el análisis caso a caso.

**Cómo se usa:**

1. Navega por **área** (marcas, PI, patentes, procesal) y luego por **tema**.
2. Abre la pregunta que te interese.
3. Lee la respuesta junto con sus criterios y fuentes.

**Ejemplo realista:**

> En el área de **marcas**, tema "riesgo de confusión", encuentras una pregunta estándar sobre
> los **factores de comparación entre signos** con su respuesta aprobada y las resoluciones de
> origen citadas.

---

### 5.6 Panel de ingesta (editor/admin)

Modo **interno**, reservado al **editor/administrador**. Sirve para **hacer crecer el corpus**.
Aquí es donde nacen los criterios que luego usan todos los demás modos.

> **Regla de oro:** ningún criterio se aprueba automáticamente. La aprobación es **siempre** un
> **acto humano explícito**.

**Flujo de trabajo (tres fases):**

**a) Registrar una resolución**

1. Sube el archivo de la resolución (`PDF` o `TXT`).
2. Completa sus **metadatos** (identificador de la resolución, datos de la fuente, etc.).

**b) Extraer texto y redactar criterios**

1. El sistema **extrae el texto** de la resolución.
2. El **editor redacta los criterios estructurados**. Cada criterio incluye:
   - **Texto del criterio.**
   - **Condiciones** de aplicación.
   - **Lo que NO resuelve** (los límites de su alcance).
   - **Límites** de la respuesta.
   - **Extracto verbatim** + **referencia de la fuente**.
3. Todos los criterios quedan en estado **`pending_review`**. **Nunca** se aprueban de forma
   automática.

**c) Revisar y aprobar**

1. Una **persona revisa** el criterio.
2. Solo entonces lo marca como **`approved`**.
3. A partir de ese momento, el criterio es **"servible"** a los usuarios.

**Requisitos obligatorios para aprobar un criterio.** La aprobación exige que estén presentes:

- `judgment_id` (identificador de la resolución),
- `criterion_text` (texto del criterio),
- `source_reference` (referencia de la fuente),
- `source_excerpt` (extracto verbatim de la fuente),
- `limits` (límites),

y que el criterio **NO contenga lenguaje de pronóstico** (nada de "probabilidad de ganar",
"seguramente prosperará", etc.).

**Ciclo de vida del criterio:**

```
Extraído (pending_review)  →  Revisado por un humano  →  approved (servible)
```

Mientras un criterio no esté en estado `approved`, **no se sirve** a ningún usuario en ningún
modo.

---

## 6. Guardrails: lo que la herramienta NO hará

Esta sección es deliberadamente explícita. El valor de ILP · Asesor Informativo está tanto en lo
que hace como en lo que se niega a hacer:

- **No predice resultados.** Nunca dice quién ganará ni calcula una probabilidad de victoria.
- **No recomienda demandar** ni da instrucciones de estrategia procesal como si fueran consejo.
- **Rechaza o repregunta cuando no hay cobertura.** Si no encuentra criterios aprobados
  suficientes, no inventa una respuesta de fondo.
- **No usa internet** ni el conocimiento general del modelo de lenguaje. Solo el corpus interno.
- **No inventa fuentes** (leyes, sentencias, citas ni criterios). Toda referencia procede de los
  metadatos del corpus.
- **Siempre muestra el aviso** de orientación informativa, en cada respuesta.
- **Los documentos del usuario nunca se convierten en fuente jurídica.** Son solo hechos del
  caso; no entran al corpus ni se citan como criterio.

Si alguna petición choca con estos límites (por ejemplo, "dime si gano"), la herramienta **lo
explica** en lugar de complacer.

---

## 7. Cómo leer una respuesta

Una respuesta típica del modo asistido se compone de bloques fijos. Conviene leerlos en orden:

1. **Qué se entendió / área y tema** — cómo clasificó tu consulta el motor. Si no coincide con
   tu intención, reformula o aporta más hechos.
2. **Decisión** — responder, repreguntar, fuera de alcance o sin cobertura suficiente.
3. **Criterios usados** — los criterios aprobados que sostienen la respuesta.
4. **Fuentes** — la resolución de origen de cada criterio. Aquí está la trazabilidad.
5. **Texto de la respuesta** — la redacción a partir de esos criterios.
6. **Límites** — qué **no** cubre la respuesta.
7. **Aviso informativo** — recordatorio de que es orientación informativa, no asesoramiento.

> Si ves "fuera de alcance" o "sin cobertura suficiente", **no es un error**: es la herramienta
> aplicando el principio deny-by-default. Significa que el corpus aprobado no cubre tu pregunta
> todavía, no que la pregunta esté mal planteada.

---

## 8. Ejemplos realistas

### Ejemplo 1 — Riesgo de confusión entre signos (marcas)

> **Consulta:** "Dos marcas denominativas comparten la raíz pero difieren en la terminación y
> distinguen productos de la misma clase. ¿Cómo se aprecia el riesgo de confusión?"
>
> **Comportamiento esperado:** el motor clasifica la consulta en **marcas / riesgo de
> confusión**, comprueba cobertura, y si faltan datos (por ejemplo, si hay coincidencia en el
> elemento dominante) **repregunta**. Tras la aclaración, responde con los criterios aprobados
> sobre comparación de signos y de productos, **citando** la resolución de origen de cada
> criterio, y cierra con límites + aviso informativo. **No** dice si la oposición prosperará.

### Ejemplo 2 — Mala fe en el registro (marcas)

> **Consulta:** "El solicitante registró un signo idéntico al de un competidor conociendo su uso
> previo. ¿Qué criterios se aplican a la mala fe en el registro?"
>
> **Comportamiento esperado:** si el corpus tiene criterios aprobados sobre mala fe, los aplica
> indicando condiciones y límites, con sus fuentes. Si aportas el expediente como **material del
> caso**, lo compara con esos criterios (sin convertirlo en fuente) y, si lo pides, te muestra el
> **score de alineación** con factores favorables/desfavorables/inciertos.

### Ejemplo 3 — Cosa juzgada (procesal)

> **Consulta:** "¿Cuándo opera la cosa juzgada respecto de una resolución anterior firme en
> materia de propiedad industrial?"
>
> **Comportamiento esperado:** el motor recupera los criterios aprobados sobre identidad de
> partes, objeto y causa. Si la pregunta mezcla cosa juzgada con prescripción, **repregunta**
> para separar los temas. Si pides "dime si me van a estimar la excepción", **rechaza** la
> predicción y lo explica.

---

## 9. Preguntas frecuentes (FAQ)

**1. ¿La herramienta predice si voy a ganar el caso?**
No. Nunca pronostica resultados ni calcula "probabilidad de ganar". El score y el Case Fit Grade
miden **alineación con el corpus**, no la victoria. Si pides una predicción, se rechaza y se
explica.

**2. ¿Usa internet?**
No. Trabaja solo con el **corpus interno** de criterios aprobados. No hace búsquedas web ni
consulta servicios externos, y no usa el conocimiento general del modelo de lenguaje.

**3. ¿Puedo subir un PDF escaneado?**
Sí. Se lee por **OCR** con el motor nativo de macOS Vision, **siempre que uses el lanzador**
(`Abrir Locked Advisor.command`). En la versión HTML offline no hay OCR: tendrás que pegar el
texto.

**4. ¿Por qué me repregunta en vez de responder?**
Porque detectó que faltan **datos esenciales** o que la consulta mezcla temas. Es el principio
deny-by-default: prefiere aclarar antes que improvisar. Responde el segundo recuadro y el motor
reevalúa con todo.

**5. ¿Por qué dice "fuera de alcance"?**
Porque la materia de tu consulta **no está cubierta** por criterios aprobados en el corpus. No es
un fallo: es honestidad. El corpus crece a medida que el editor aprueba nuevos criterios.

**6. ¿Quién aprueba los criterios?**
Una **persona** (el editor/admin), de forma explícita, desde el Panel de ingesta. Ningún proceso
automático puede aprobar criterios: la extracción siempre deja el criterio en `pending_review`.

**7. ¿Mis documentos del caso entran al corpus?**
No. Los materiales que subes son **solo hechos del caso**. Nunca se convierten en fuente
jurídica, no se citan como criterio y no pasan a formar parte del corpus.

**8. ¿Esto es asesoramiento jurídico?**
No. Es **orientación informativa** basada en un corpus cerrado. Cada respuesta lo recuerda. Un
caso concreto requiere la valoración de un profesional.

---

## 10. Glosario rápido

- **Corpus cerrado** — la base de conocimiento interna; el único origen de las respuestas.
- **Criterio aprobado** — regla jurídica extraída de una resolución, estructurada y validada por
  una persona (`approved`). Es lo único "servible" al usuario.
- **`pending_review`** — estado de un criterio recién extraído, aún **no** aprobado y por tanto
  no servible.
- **Deny-by-default** — principio rector: ante la duda, repreguntar, declarar fuera de alcance o
  falta de cobertura; nunca improvisar.
- **Fuente / resolución de origen** — la resolución real de la que procede un criterio; se cita
  siempre.
- **OCR** — lectura automática de texto en PDFs escaneados e imágenes (vía macOS Vision; solo con
  el lanzador).
- **Score de alineación** — métrica determinista de cobertura de hechos frente a criterios
  aprobados. No es probabilidad de ganar.
- **Case Fit Grade** — calificación por letras (A/B/C/D/insuficiente) de la alineación del caso
  con el corpus. No predice quién gana.
- **Traza de auditoría** — registro por respuesta (pregunta, criterios, fuentes, decisión,
  límites) para trazabilidad.

---

*ILP · Asesor Informativo — motor Locked Legal Advisor. Documento de uso interno del despacho
ILP Abogados. La herramienta ofrece orientación informativa basada en un corpus cerrado de
criterios aprobados; no constituye asesoramiento jurídico.*
