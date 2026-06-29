# Demo (sin Node) — `serve_demo.py`

Esta máquina **no tiene Node.js**, así que la app real (`npm run serve`, que ejecuta
`backend/server.ts` con `tsx`) no puede arrancar aquí. Esta carpeta contiene una **demo
en Python puro** (solo biblioteca estándar) para poder **probar el sistema ya mismo**.

## Cómo arrancarla

```bash
python3 demo/serve_demo.py
# luego abre:
#   http://127.0.0.1:8787            → modo asistido (chat)
#   http://127.0.0.1:8787/catalog.html → catálogo de preguntas estándar
```

Otras opciones:

```bash
python3 demo/serve_demo.py --check   # solo verifica fidelidad y sale (no levanta servidor)
PORT=9000 python3 demo/serve_demo.py # otro puerto
```

Al arrancar verás la **autocomprobación de fidelidad**: la demo recompone las 4 salidas del
`answerComposer` y las compara, carácter a carácter, con `docs/answerComposer-examples.md`
(salidas reales generadas por el motor TypeScript). Si algo divergiera, lo avisa.

## Qué es exactamente

- **Sirve el frontend REAL** (`../frontend`) sin tocarlo: la pantalla de aceptación, el chat,
  el selector ES/EN y el catálogo son los que has construido.
- **Reimplementa el backend** (`backend/server.ts`) con un **espejo fiel del cerebro cerrado**
  escrito en Python. El espejo NO inventa lógica: lee el **léxico**, las **checklists** y el
  **glosario** directamente del código TypeScript (entre sus marcadores `…-JSON-BEGIN/END`) y
  los **criterios / resoluciones / catálogo** de `data/`. Una sola fuente de verdad.
- Respeta las mismas puertas: solo criterios `approved`, cobertura, citas derivadas de
  metadatos, aviso siempre presente, aislamiento de las sentencias originales, y rechazo seguro
  ante cualquier duda o fallo (deny-by-default).

## Importante (honestidad)

El **motor real es el de TypeScript** (`services/engine.ts`). Este espejo existe solo para
poder probar el comportamiento sin Node. **Cuando instales Node ≥ 22**, usa el producto real:

```bash
npm install
npm run serve      # interfaz de prueba (chat + catálogo)  → http://localhost:8787
npm run panel      # panel interno de revisión de criterios → http://localhost:8788
npm run review     # CLI de revisión/aprobación
npm test           # suite de seguridad (Vitest)
```
