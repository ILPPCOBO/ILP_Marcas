# data/audit/ — Registros de trazabilidad

Aquí se guardarán los registros de **trazabilidad por respuesta** que exige la Regla 16:
pregunta original, criterios usados, fuentes, decisión del motor (responder / repreguntar /
rechazar) y límites declarados. También las interacciones rechazadas y las repreguntas se
registran. De momento está vacío.

## Reglas

- Registro **append-only** (previsto: JSONL), escrito por `services/auditLogger`.
- **Minimización de datos**: sin IP, user-agent ni identidad del usuario; solo lo que la
  Regla 16 exige. Definir política de retención y borrado antes de cualquier uso real.
- Los archivos de registro **no se versionan en git** (contienen preguntas de usuarios);
  ver `.gitignore` raíz.
- Acceso de solo lectura para administración/revisión; nunca alimenta al motor de respuesta.

Nota: esta carpeta no estaba en la lista inicial de `/data`, pero la Regla 16 exige un lugar
para la trazabilidad; se documenta aquí para que el espacio quede reservado desde el inicio.
