# answerComposer — ejemplos de salida

Salidas REALES del módulo (generadas con su lógica, no escritas a mano) para cada tipo de
decisión. El ejemplo de `answer` usa el criterio aprobado ficticio `crit-mock-0001` del corpus
de prueba; los demás no usan criterios. Todo el contenido jurídico es FICTICIO.

Cada salida es un `AdvisorAnswer` conforme al modelo F1; aquí se muestra el `answer_text`
(texto visible) más sus campos estructurados de trazabilidad.

## Decisión `answer`

Las 6 secciones obligatorias. Las citas de la sección 3 y `sources_used` proceden solo de los metadatos del criterio (Reglas 4 y 9); el aviso de la sección 6 es verbatim (Reglas 11-12).

`decision`: `answer` · `criteria_used`: ["crit-mock-0001"] · `sources_used`: [{"criterion_id": "crit-mock-0001", "judgment_id": "jdg-mock-0001"}] · `confidence_level`: "high"

```
1. Lo que he entendido
He entendido que su consulta se refiere a marcas, en relación con «riesgo de confusión»; en concreto: similitud de signos. Tomo como base únicamente lo que usted ha descrito, sin añadir hechos que no haya mencionado.

2. Encaje dentro del corpus
La consulta encaja en el área «Marcas», tema «riesgo de confusión».

3. Criterios aplicables
   • [crit-mock-0001] FICTICIO (datos de prueba) — En este corpus de ensayo, la comparación entre dos signos de prueba se realiza atendiendo al 'elemento de ensayo dominante' definido en la resolución MOCK-101/2021, considerando conjuntamente la similitud visual y fonética de prueba.
     Fuente: Fundamento de prueba 2.º (ficticio) (resolución jdg-mock-0001).

4. Orientación informativa
Según los criterios disponibles en el corpus, los siguientes elementos podrían ser relevantes para orientar el análisis, sin que ello anticipe ningún resultado:
   • Según los criterios disponibles, el corpus recoge que FICTICIO (datos de prueba) — En este corpus de ensayo, la comparación entre dos signos de prueba se realiza atendiendo al 'elemento de ensayo dominante' definido en la resolución MOCK-101/2021, considerando conjuntamente la similitud visual y fonética de prueba. Esto podría ser relevante si concurren: FICTICIO — Que ambos signos pertenezcan a la categoría de prueba 'denominativa de ensayo'.; FICTICIO — Que exista identidad o similitud de prueba entre los productos de ensayo comparados..
El corpus no permite afirmar un resultado: estos criterios solo orientan el análisis.

5. Límites de esta respuesta
Esta respuesta no concluye su caso. En particular, los criterios usados no resuelven: FICTICIO — No responde sobre signos de la categoría de prueba 'figurativa de ensayo'.; FICTICIO — No responde sobre la validez registral de los signos de prueba.. Además, presentan estos límites: FICTICIO — Criterio de prueba sin valor jurídico alguno; no aplicable a ningún caso real.. El resultado real dependería de la prueba que se practique y de la normativa vigente, que esta herramienta no verifica.

6. Aviso
Esta respuesta es únicamente orientación informativa basada en un corpus cerrado de criterios jurídicos y no constituye asesoramiento jurídico. Para un caso concreto, consulte a un profesional.
```

## Decisión `clarify`

No entra al fondo: explica que faltan datos, formula las preguntas del detector y cierra con aviso breve.

`decision`: `clarify` · `criteria_used`: [] · `sources_used`: [] · `confidence_level`: null

```
No puedo analizar el fondo todavía: faltan datos esenciales para aplicar los criterios del corpus. Para poder orientarle, necesitaría que precise:
   • ¿Está registrado alguno de los signos (el suyo o el del otro)? ¿O se usan sin registro?
   • ¿A qué productos o servicios se dedica cada parte? ¿Son los mismos o similares?
   • ¿En qué territorio se usa o está registrado cada signo?

Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye asesoramiento jurídico.
```

## Decisión `out_of_scope`

Declara que la materia no está cubierta, no responde jurídicamente y sugiere reformular dentro de las materias del corpus.

`decision`: `out_of_scope` · `criteria_used`: [] · `sources_used`: [] · `confidence_level`: null

```
Esta cuestión no está cubierta por las resoluciones del corpus analizado, por lo que no puedo darle una orientación jurídica sobre ella. El corpus se limita a materias de marcas, propiedad intelectual, patentes y aspectos procesales relacionados. Si su consulta tiene algún componente de esas materias, puede reformularla centrándose en él. Para preguntas frecuentes ya validadas, puede consultar el catálogo de preguntas estándar; para su caso concreto, dirigirse a un profesional.

Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye asesoramiento jurídico.
```

## Decisión `insufficient_criteria`

Dice que no hay criterios aprobados suficientes, no improvisa y remite al catálogo o a un profesional.

`decision`: `insufficient_criteria` · `criteria_used`: [] · `sources_used`: [] · `confidence_level`: null

```
No hay criterios aprobados suficientes en la base de conocimiento para orientar esta consulta, de modo que prefiero no improvisar una respuesta. Puede consultar el catálogo de preguntas estándar validadas o dirigirse a un profesional para su caso concreto.

Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye asesoramiento jurídico.
```
