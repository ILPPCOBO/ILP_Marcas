# services/legal/ — Aviso y aceptación previa

Acceso a la herramienta tras un **consentimiento informado**: el usuario ve una pantalla de
bienvenida con el aviso y debe aceptarlo expresamente antes de usar el chat o el catálogo.

## Archivos

- `disclaimer.ts` — **fuente única** de los textos y la versión:
  - `DISCLAIMER_VERSION` — al subirla, quien aceptó una versión anterior vuelve a ver el
    aviso (requisito 5).
  - `ACCEPTANCE_TEXT` — aviso de aceptación expresa (verbatim).
  - `SHORT_DISCLAIMER` — aviso breve del pie de cada respuesta (Reglas 11-12); lo reutilizan
    `answerComposer` y el catálogo (sin duplicar texto).
  - `DISCLAIMER_LANGUAGE` — idioma del aviso.
- `acceptance.ts` — `recordAcceptance` / `readAcceptances`: registro mínimo del
  consentimiento.

## Registro de aceptación (requisito 3)

Campos: `id`, `session_id` (aleatorio, sin PII) o `user_id` (null hasta que haya login),
`accepted_at`, `disclaimer_version`, `language`. **Minimización de datos**: NO se guarda IP,
user-agent ni identidad. Append-only en `data/acceptance_log.jsonl` (gitignored). La versión
la sella el servidor (no se confía en el cliente).

## Flujo

1. Cliente (`frontend/acceptance.js`, incluido en chat y catálogo) pide `GET /api/disclaimer`.
2. Si no hay aceptación local de la versión vigente, muestra un overlay que **bloquea** la
   herramienta (requisito 2): texto + casilla de aceptación + botón (deshabilitado hasta
   marcar, requisito 1).
3. Al aceptar: `POST /api/acceptance {session_id, language}` → el servidor registra y devuelve
   el registro; el cliente guarda la aceptación localmente y revela la herramienta.
4. El chat añade `accepted_version` a cada consulta; el servidor rechaza la consulta si no
   coincide con la versión vigente (defensa en profundidad).

## Sin login (por ahora), estructura lista para login real

Hoy se usa `session_id` local. Cuando haya autenticación, basta con rellenar `user_id` en el
registro y, opcionalmente, imponer la aceptación server-side por usuario. No se ha añadido
auth avanzada para no complicar el proyecto.
