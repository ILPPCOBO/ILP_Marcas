# data/approved_criteria/ — Criterios aprobados (la única fuente del motor)

Aquí vivirán los criterios jurídicos con **`approved: true`**: los únicos que el sistema puede
usar para responder al usuario final (Regla 5). De momento está vacío — y mientras lo esté, el
sistema **no puede responder el fondo de ninguna consulta** (Regla 6); eso es lo correcto.

## Reglas (CLAUDE.md)

- Un criterio solo entra aquí mediante un **acto humano explícito de aprobación** realizado
  por un revisor cualificado (Regla 15). Ningún script, modelo ni proceso automático puede
  escribir en esta carpeta.
- Todo criterio aprobado conserva su trazabilidad completa: resolución de origen, tribunal,
  fecha, extracto textual (Regla 9). Sin fuente verificable, no hay aprobación.
- La aprobación debe quedar registrada: quién aprobó, cuándo y qué versión del criterio.
- Si un criterio aprobado resulta erróneo o queda superado, se **retira de aquí** (vuelta a
  revisión o rechazo); no se edita "en caliente" sin nueva revisión.

`criteriaRetriever` (en `services/`) lee **exclusivamente** esta carpeta y aplica defensa
en profundidad: cada criterio se valida contra el modelo y pasa la puerta `isServable()` —
un `pending_review`, `rejected` o estado incoherente que se colara aquí NO se serviría.

## ⚠️ Excepción temporal: datos de prueba

`mock_criteria.json` contiene criterios **FICTICIOS** creados el 2026-06-11 por
autorización expresa del propietario, únicamente para probar la lógica del motor antes de
cargar el corpus real. Su `approved: true` **no** procede de una revisión jurídica (lo
declara su propio `approved_by`), todo su contenido está marcado `FICTICIO`, y el archivo
debe **borrarse antes de cualquier uso real** (`delete_before_production: true`). No es
precedente para que ningún proceso automático escriba aquí.
