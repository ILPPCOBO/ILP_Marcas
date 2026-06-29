# data/source_judgments/ — Resoluciones judiciales originales

Aquí se depositarán las **resoluciones judiciales originales** (sentencias, autos) que sirven
de materia prima al proyecto. De momento está vacío a propósito.

## Reglas (CLAUDE.md)

- **El motor de respuesta NUNCA lee esta carpeta** (Regla 13). Las sentencias no se usan
  directamente para responder al usuario: primero deben convertirse en criterios
  estructurados (→ `data/processed_criteria/`) y aprobarse por un humano
  (→ `data/approved_criteria/`).
- Esta carpeta es la **fuente de verdad documental**: sirve para extraer criterios y para
  verificar que cada criterio aprobado procede realmente de una resolución existente.
- Conviene acompañar cada archivo de metadatos verificables (tribunal, número de resolución,
  fecha, ECLI si existe) para la trazabilidad criterio → resolución (Regla 9).

## Qué poner aquí (cuando llegue el momento)

- Un archivo por resolución, con nombre estable e identificable.
- Opcionalmente un `manifest.json` con los metadatos de cada archivo.

Nota: `mock_judgments.json` contiene resoluciones **FICTICIAS** de prueba (2026-06-11);
sus `file_path` apuntan a archivos que no existen. Borrar antes de cargar resoluciones
reales.

**Cómo se registran:** `services/ingestion`/`registerJudgment` cataloga cada resolución como
`<id>.judgment.json` (`{judgments:[…]}`, modelo `Judgment` validado) y anota notas y
procedencia en `ingestion_manifest.json` (las `notes` de administración NO van en el
`Judgment`, que es un modelo cerrado). `safetyGuardrails` lee de aquí **solo los IDs** para
verificar que cada cita apunta a una resolución existente; el texto de la resolución nunca se
sirve (Regla 13).
