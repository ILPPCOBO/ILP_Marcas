# Arquitectura — Locked Legal Advisor (borrador inicial)

> Estado: borrador estructural. La constitución vinculante es `../CLAUDE.md`.

## Visión de capas

```
┌──────────────────────────────────────────────────────────────┐
│ frontend/   UI de consulta (capa tonta, sin lógica jurídica) │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTP
┌──────────────▼───────────────────────────────────────────────┐
│ backend/    server.ts: API HTTP (POST /api/consulta)         │
│             → services/engine.ts (orquestador, sin atajos)   │
└──────────────┬───────────────────────────────────────────────┘
               │ engine.runQuery, orden fijo
┌──────────────▼───────────────────────────────────────────────┐
│ services/   EL CEREBRO CERRADO                               │
│   scopeClassifier → missingFactsDetector → criteriaRetriever │
│   → decisionEngine → answerComposer → safetyGuardrails (veto)│
│   → auditLogger (SIEMPRE, también vetos y errores)           │
└──────────────┬───────────────────────────────────────────────┘
               │ lee SOLO approved_criteria/ (+ source_judgments/ para
               │ verificar IDs de resolución, nunca su texto, Regla 13)
┌──────────────▼───────────────────────────────────────────────┐
│ data/       source_judgments → processed_criteria →          │
│             approved_criteria   |   catalog   |   audit      │
│             (flujo editorial unidireccional, Reglas 13–15)   │
└──────────────────────────────────────────────────────────────┘

admin/  — herramienta humana de revisión/aprobación (única puerta a approved_criteria)
tests/  — suite de seguridad obligatoria
```

## Decisiones ya tomadas (por la constitución)

1. **Deny-by-default en todas las capas** — incluido el código no implementado: los stubs
   actuales rechazan o vetan, nunca simulan.
2. **El LLM nunca decide.** Si interviene, solo redacta sobre material recuperado; citas y
   disclaimers se ensamblan por código determinista.
3. **Separación física de los estados del corpus** en carpetas distintas
   (`processed_criteria` vs `approved_criteria`), para que la puerta de aprobación sea
   estructural y no un simple flag fácil de ignorar.
4. **Sin internet en la lógica de respuesta.**
5. **Modelo de datos en doble espejo** (decidido 2026-06-11, Fase F1): interfaces +
   validadores TS en `services/models/` y JSON Schema 2020-12 en `data/schemas/`,
   sincronizados en cada cambio. Persistencia inicial en JSON validado; diseñado para
   mapear 1:1 a tablas relacionales (ver plan de migración en `services/models/README.md`).
   `review_status` es el estado canónico del criterio; el flag `approved` es redundante
   por diseño con validación de coherencia en ambos espejos.

## Decisiones pendientes (se documentarán aquí como ADRs)

- Stack definitivo de frontend/backend (previsiblemente TypeScript; por confirmar).
- Esquema de las entradas del catálogo (`data/catalog/`) — las 5 entidades núcleo ya
  están definidas (F1); falta el modelo de FAQ validada.
- Módulo de servicio del catálogo (`catalogService`): responsable de servir las entradas
  validadas de `data/catalog/` — `criteriaRetriever` no lo cubre; definir en F1.
- Motor de base de datos definitivo para la migración desde JSON validado.
- Mecanismo de recuperación (índice léxico local u otro — siempre local y determinista).
- Si un LLM participa en la redacción de respuestas y con qué salvaguardas programáticas.
