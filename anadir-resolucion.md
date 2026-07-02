# Guía: añadir una resolución al corpus

El Asesor Informativo es un **cerebro cerrado**: responde únicamente con criterios
aprobados, extraídos de resoluciones ya analizadas. La web pública **no permite**
ampliar el corpus (rechaza cualquier subida de tipo `corpus_document`); los
usuarios solo aportan materiales de su caso, que nunca se convierten en fuente
jurídica. Ampliar el corpus es siempre un **acto editorial interno**, en tres pasos.

> Reglas de la constitución que gobiernan este proceso: las sentencias nunca se
> usan directamente (Regla 13); toda extracción queda `pending_review` (Regla 14);
> **solo una revisión humana aprueba** (Regla 15).

---

## Paso 1 — Extracción con Claude (sesión de trabajo)

Abre una sesión de Claude Code en `~/locked-legal-advisor` y entrégale la
resolución (PDF/DOCX). Encargo tipo (copiar y adaptar):

> Añade esta resolución al corpus. Procesa únicamente esta resolución.
> Regístrala y extrae los criterios estructurados siguiendo las reglas de carga:
> (1) distingue hechos / razonamiento / criterio / límites; (2) no conviertas el
> resultado del caso en una regla general; (3) cada criterio lleva su cita textual
> (source_excerpt) y su referencia (source_reference); (4) ante ambigüedad,
> confianza low/medium; (5) todo queda como pending_review — no apruebes nada.

Resultado: los criterios quedan en `data/processed_criteria/` como **pendientes**.
Claude no puede aprobarlos (el sellado lo impide por código).

## Paso 2 — Revisión y aprobación humanas (panel interno)

```bash
cd ~/locked-legal-advisor && npm run panel     # abre http://localhost:8788
```

El panel es **solo local**: no se publica nunca. Para cada criterio pendiente:

1. Lee el criterio junto a su cita textual y la resolución de origen.
2. Corrige lo que haga falta (área, tema, texto, condiciones, límites, fuente).
3. **Aprobar** (con tu nombre) o **Rechazar** (con motivo). Aprobar exige que
   existan fuente, cita y límites — el sistema lo bloquea si falta algo.

Los aprobados pasan a `data/approved_criteria/` y ya son servibles.
Alternativa por terminal: `npm run review`.

## Paso 3 — Regenerar y publicar

```bash
cd ~/locked-legal-advisor
python3 tools/import/build_catalog.py      # regenera el catálogo (autoriza el propietario)
python3 demo/build_standalone.py           # reconstruye la web con el corpus ampliado
python3 demo/serve_demo.py --check         # fidelidad ✅
npm test                                   # 211+ tests ✅
```

Después, publicar el `demo/locked-legal-advisor.html` resultante:

1. Copiarlo como `index.html` al repositorio (`~/Desktop/ILP_Marcas/`), commit y `git push`.
2. Resubir `index.html` a Vercel (o automático si el repo está conectado a Vercel).

---

## Qué NO hacer nunca

- **No** editar a mano archivos de `data/approved_criteria/` (usar el panel).
- **No** aprobar sin leer la cita textual contra la resolución original.
- **No** exponer el panel (`:8788`) fuera del equipo local.
- **No** subir al repositorio datos de casos de usuarios (`data/case_materials/`,
  `data/uploads/`, registros de auditoría) — el `.gitignore` ya los excluye.
- **No** añadir a la web pública ninguna vía de subida al corpus.
