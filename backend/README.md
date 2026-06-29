# backend/ — Capa de orquestación y API

API HTTP mínima que expone el flujo cerrado al frontend. **No contiene lógica jurídica
propia**: su único trabajo es orquestar el cerebro (`services/engine.ts`) y devolver el
resultado (respuesta, repregunta o rechazo).

## Reglas para esta capa

- Toda petición pasa por `engine.runQuery`, que encadena el pipeline completo de `services/`
  con el veto final de `safetyGuardrails` y la auditoría — no hay atajos (`CLAUDE.md` §6).
- Sin dependencias de red en la lógica de respuesta (Regla 2).
- Los errores técnicos producen un **rechazo seguro y honesto**, nunca una respuesta
  improvisada (Regla 17). El servidor genera aquí los ids/timestamps reales (el motor no los
  inventa) y traduce cualquier excepción en un rechazo seguro.

## Contenido actual

- `server.ts` — servidor HTTP sin dependencias (node:http). Sirve el frontend estático y
  expone `POST /api/consulta` → `engine.runQuery`. Ejecutar: `npm install && npm run serve`
  (requiere Node ≥ 22; usa `tsx`). Abre `http://localhost:8787`.

## Nota de entorno

Esta máquina **no tiene Node.js**: el servidor no se ha ejecutado aquí. Su lógica y la del
cerebro están verificadas con espejos en Python (incluido el flujo de extremo a extremo y la
suite de seguridad). Con Node disponible, `npm run serve` levanta la interfaz.
