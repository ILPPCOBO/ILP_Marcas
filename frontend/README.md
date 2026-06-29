# frontend/ — Interfaz mínima de prueba (F7 mínimo)

Interfaz web de consulta para **probar el cerebro cerrado**. Simple y funcional a propósito:
sin diseño avanzado, sin login, sin idiomas (solo español). Archivos:

- `index.html` — cuadro de consulta, botón de envío, panel de trazabilidad (decisión, área,
  tema, criterios usados, fuentes usadas), área de respuesta y aviso fijo.
- `styles.css` — estilos mínimos.
- `app.js` — envía la consulta a `POST /api/consulta` y pinta la respuesta.

Se sirve desde `backend/server.ts` (`npm run serve`). Sin Node.js en esta máquina no se ha
ejecutado; el contrato del endpoint está verificado con espejos en Python.

## Reglas que cumple (CLAUDE.md)

- El frontend es una **capa tonta**: muestra lo que el backend devuelve (respuesta, repregunta
  o rechazo) y no contiene ninguna lógica jurídica ni de decisión.
- **Defensa en cliente**: `app.js` solo muestra criterios y fuentes si la decisión es
  `answer`; en `clarify`/`out_of_scope`/`insufficient_criteria` esos campos quedan en "—".
- Toda respuesta mostrada incluye: criterios usados, resolución de origen de cada uno,
  límites, y el recordatorio visible de que es **orientación informativa basada en un corpus
  cerrado, no asesoramiento jurídico** (Reglas 9, 11, 12).
- El usuario debe ver con claridad cuándo el sistema rechaza o repregunta, y por qué
  (honestidad, Regla 10).
- Ningún texto de la UI puede presentar la herramienta como asesoría legal (Regla 11).
