# services/i18n/ — Capa de idioma (es | en)

Soporte de **inglés** como capa de INTERFAZ y TRADUCCIÓN. **El razonamiento jurídico interno
siempre ocurre en español** sobre los criterios aprobados (CLAUDE.md); el inglés no cambia el
núcleo. No se admite chino (decisión del propietario).

## Flujo (consulta en inglés)

```
usuario escribe en inglés
 → detectLocale / selector fija el idioma
 → normalizeQuery(EN→ES): añade los términos ESPAÑOLES del corpus (glosario cerrado)
 → classifyScope / detectMissingFacts / retrieve / decide  ← TODO en español
 → composeAnswer(locale="en"): marco en inglés, criterion_text y fuentes en español
 → respuesta en inglés con las identificaciones de resolución/fuente en español
```

## Reglas i18n cumplidas

| # | Regla | Cómo |
|---|---|---|
| 1 | No traducir `source_reference` | el render inglés lo emite verbatim ("Source (in Spanish): …") |
| 2 | No modificar órganos/números/fechas | proceden de metadatos del corpus; nunca pasan por traducción |
| 3 | Aviso verbatim | `ENGLISH_SOURCE_NOTICE` en `legal/disclaimer.ts`, añadido a cada respuesta inglesa |
| 4 | No crear criterios en inglés | i18n NO escribe en el corpus; solo presenta; el `criterion_text` se mantiene en español |
| 5 | No razonar desde derecho anglosajón/EEUU | el glosario solo mapea a conceptos del corpus ESPAÑOL; el razonamiento es el mismo pipeline español |
| 6 | Avisar si hay duda de traducción | si la consulta inglesa no mapea términos del corpus, `uncertain=true` → `TRANSLATION_DOUBT_NOTICE_EN` |

## Traducción DETERMINISTA (no LLM)

No hay traducción por modelo (violaría "no inventar" y no hay LLM disponible). Todo es por
**glosario cerrado**: EN→ES para normalizar la consulta, y ES→EN para las etiquetas de
área/tema (vocabulario finito). El contenido sustantivo de los criterios no se traduce a
máquina; el aviso de la Regla 3 lo explica al usuario.

## Archivos

- `locale.ts` — `Locale`, `detectLocale`, `resolveLocale`.
- `glossary.ts` — `normalizeQuery` (EN→ES, con flag de duda), `areaLabel`/`topicLabel` (ES→EN).
- Textos en inglés (aviso, disclaimers) en `services/legal/disclaimer.ts` (versionados).
- Render inglés en `services/answerComposer.ts` (el español queda intacto).
- Selector ES/English en `frontend/` (chat).
