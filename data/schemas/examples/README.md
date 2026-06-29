# data/schemas/examples/ — Ejemplos mínimos (FICTICIOS)

Un ejemplo válido por entidad, formando una interacción coherente:

```
jdg-ejemplo-ficticio-0001 (Judgment ficticia)
   └─ crit-ejemplo-ficticio-0001 (LegalCriterion, pending_review — recién extraído)
qry-ejemplo-0001 (UserQuery en alcance)
   └─ ans-ejemplo-0001 (AdvisorAnswer: insufficient_criteria — corpus aprobado vacío)
        └─ aud-ejemplo-0001 (AuditLog con el porqué)
```

## Avisos importantes

- **TODO el contenido jurídico es FICTICIO** y está etiquetado como tal. No existe la
  resolución "EJEMPLO-123/2020" ni el "Tribunal Ficticio de Ejemplo". Estos archivos
  existen solo para documentar y validar los esquemas (la Regla 4 prohíbe que material
  inventado parezca real).
- **Nada de esta carpeta es servible**: no es `approved_criteria/` ni `catalog/`; el
  motor de respuesta jamás lee `data/schemas/`.
- El ejemplo de criterio está en `pending_review` a propósito: es el estado en que nace
  toda extracción (Regla 14). No hay ejemplo con `approved: true` porque la aprobación
  es un acto humano real (Regla 15) — no se simula ni en la documentación.
- El ejemplo de respuesta es un rechazo `insufficient_criteria` a propósito: es la única
  respuesta honesta con el corpus aprobado vacío (Reglas 6 y 17), y evita inventar
  contenido jurídico de fondo.
