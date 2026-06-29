# admin/ — Herramienta de revisión humana (Fase F5)

Aquí vivirá la herramienta con la que un **revisor humano** (jurista) examina los criterios de
`data/processed_criteria/` y decide aprobarlos o rechazarlos. De momento está vacía.

## Por qué existe

La constitución exige que **solo una revisión humana pueda aprobar criterios** (Regla 15) y
que lo extraído automáticamente quede siempre en `pending_review` (Regla 14). Esta carpeta es
la materialización de ese cuello de botella deliberado: la única puerta entre
`processed_criteria/` y `approved_criteria/`.

## Panel web: `panel-server.ts` + `panel/`

Panel interno de revisión (`npm run panel` → `http://localhost:8788`). Sirve `panel/`
(HTML+CSS+JS, español) y una API que delega en `services/ingestion`. **Interno**: corre en
un puerto distinto del servidor público de consultas (8787) y no debe exponerse a usuarios
finales. Permite, para cada criterio `pending_review`: ver su resolución fuente y su extracto;
editar `area/topic/subtopic/criterion_text/conditions_for_application/does_not_answer/limits/
source_reference`; **Guardar cambios** (sigue pendiente), **Aprobar** (solo si no faltan
`judgment_id/criterion_text/source_reference/limits` ni la resolución registrada — el botón se
deshabilita y el servidor re-valida) y **Rechazar** (pide motivo). El revisor escribe su
nombre, que se registra como `approved_by` (Regla 3). El motivo de rechazo se guarda en
`data/review_log.jsonl`.

## Herramienta CLI: `review-cli.ts`

Misma funcionalidad por terminal (útil para scripting). `npm run review -- <comando>`
(requiere Node ≥ 22; usa `tsx`):

```
npm run review -- list [--status pending_review|rejected]
npm run review -- show <criterion_id>
npm run review -- approve <criterion_id> --by "Nombre Revisor"
npm run review -- reject  <criterion_id> --by "Nombre Revisor" --reason "..."
npm run review -- edit    <criterion_id> --by "Nombre Revisor" --criterion_text "..."
npm run review -- log
```

- `list` muestra cada pendiente con su **resolución de origen y extracto** al lado, para
  verificar que el criterio dice lo que la resolución dice.
- `approve` mueve a `data/approved_criteria/` con `approved:true` + `approved_by`/`approved_at`
  y registra el evento; **rechaza la aprobación** si falta usuario o si la fuente no es
  verificable (Reglas 3 y 5). `reject` registra el motivo; `edit` corrige y deja el criterio
  en `pending_review` (editar nunca aprueba).

## Reglas

- Ninguna función de esta herramienta puede aprobar en masa sin revisión individual.
- La aprobación queda siempre registrada (quién, cuándo) en el criterio y en
  `data/review_log.jsonl`.
- Esta herramienta es interna; jamás se expone al usuario final.

## Pendiente

- Consultar los registros de `data/audit/` (solo lectura).
- Retirar de `approved_criteria/` un criterio superado o erróneo (hoy se hace borrando su
  archivo; conviene un comando dedicado con registro).
