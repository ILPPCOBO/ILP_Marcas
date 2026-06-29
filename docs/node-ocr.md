# Node + motor OCR — instalado 2026-06-16

Se implementó lo pedido ("implementa node y motor OCR"). La máquina no tenía Node ni
OCR; `sudo` pide contraseña (Homebrew/tesseract bloqueados), pero hay red y están las
Command Line Tools de Xcode. Solución sin sudo y mejor para español:

## Node
- **Node 24.16.0 LTS (arm64)** descargado del tarball oficial a `~/.local/node`, añadido
  al PATH en `~/.zshrc` y `~/.zprofile`. `npm`/`npx`/`tsx` funcionan.
- Por primera vez se ejecuta el TS real: `npm run typecheck` (tsc) **limpio**,
  `npm test` (vitest) **210/210 ✅**, `npm run serve` (backend) arranca y sirve.

## Motor OCR — nativo de macOS (Vision + PDFKit)
- `tools/ocr/lla_ocr.swift` → binario en `~/.local/bin/lla_ocr` (compilar:
  `tools/ocr/build.sh`, solo necesita `swiftc` de las CLT). **Sin Homebrew, sin sudo,
  100% LOCAL y offline (Regla 2).**
- Qué hace: por cada página de un PDF usa primero la **capa de texto nativa** (PDFKit,
  rápida y fiel); si la página está escaneada, hace **OCR con Vision** (es-ES+en-US).
  También OCR de imágenes (png/jpg). Emite `extraction_method` (native_text / ocr /
  native_plus_ocr / manual_description_needed), `page_texts`, `confidence` y la
  confianza real de Vision. **Solo emite lo reconocido; nunca inventa (Regla 4).**
- Verificado en tu PDF escaneado real (`Scanned Document.anon.pdf`): 95.9 % de
  confianza, texto legal en español extraído correctamente.

## Cableado (tres superficies)
- **demo/serve_demo.py** (lo que abre el lanzador): `_vision_extract()` se usa antes que
  el fallback tesseract; un PDF escaneado se lee solo. Detecta el binario por PATH o por
  ruta absoluta `~/.local/bin/lla_ocr`.
- **backend TS** (`services/extraction/visionOcr.ts` + `pdf.ts`/`image.ts`): llaman a
  `lla_ocr` por `execFileSync` (síncrono, encaja en la interfaz). Si el binario no está,
  degradan al stub honesto. Probado end-to-end: subir el PDF escaneado a `/api/upload`
  del backend real → `extraction_status: completed`, clasificado Marcas/riesgo de confusión.
- **HTML offline** (standalone): el navegador no puede invocar el motor nativo, así que el
  HTML conserva el camino de pegar texto. Para OCR usa el lanzador (servidor Python).

## Hallazgo crítico revelado al ejecutar el TS real (antes imposible sin Node)
**En JavaScript `\b` es ASCII.** Un patrón del denylist de Regla 18 que termina en vocal
acentuada ("ganará", "ganaré", "tendrá") **no casaba** con el `\b` final → frases de
pronóstico se colaban en el motor real (TS) y en el HTML. En Python `\b` es Unicode, por
eso los espejos Python pasaban y lo ocultaban. **Arreglado** probando también el texto
des-acentuado (`deaccent`, NFD) en `hasForbiddenLanguage`, `hasScoreboardForbiddenLanguage`,
`asksForPrediction` (TS) y en el standalone. Verificado en JavaScriptCore (motor real de
Safari) y por los tests de seguridad de Vitest.

LECCIÓN: los espejos Python no son sustituto del motor real; ahora que hay Node, `npm
test`/`tsc` son la verificación primaria. Un denylist con `\b` y acentos debe des-acentuar.

## Verificación adversarial (workflow) — 7 huecos más, cerrados
Una segunda pasada adversarial (que ejecuta el TS real con tsx) encontró que el
des-acentuado no bastaba: faltaban TERMINACIONES en los patrones. Se añadió cobertura
COMPLETA de conjugación de los verbos-resultado (ganar/perder/vencer/prosperar/triunfar +
tener/obtener/ser): futuro **1ª persona** (`ganaré`, `tendré`, `seré`), **condicional**
(`tendría`, `serían`), subjuntivo con sujeto procesal (`venza el demandante`), `deberían
demandar`, `van a prosperar`. Aplicado en answerComposer.ts, serve_demo.py (que también
des-acentúa ahora) y el standalone. **Verificado: 11/11 fórmulas vetadas, 0 falsos
positivos en los 14 criterios aprobados** (comprobado por tsx + Vitest 211/211 + espejos).
El motor OCR y la integración no tuvieron defectos (sin red, sin invención).
