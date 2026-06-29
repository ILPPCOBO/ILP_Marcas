/**
 * answerComposer — Paso 6 del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Compone la respuesta final en formato FIJO, prudente y trazable, según la
 * decisión del decisionEngine. Produce un AdvisorAnswer (modelo F1) que se
 * VALIDA antes de devolverse: el módulo no emite respuestas no conformes.
 *
 * Reglas de CLAUDE.md que aplica:
 *   - Regla 3 / §6: composición DETERMINISTA por plantillas; sin LLM, sin red.
 *     El texto libre se limita a reformular/enmarcar lo ya dado; el contenido
 *     jurídico es criterion_text verbatim del corpus aprobado.
 *   - Regla 4: las citas (sección 3 y sources_used) se ensamblan SOLO desde los
 *     metadatos de los criterios usados (source_reference, judgment_id). No se
 *     inventan fuentes; no se cita ningún criterio fuera de criteria_used.
 *   - Reglas 9: trazabilidad criterio → resolución en cada respuesta de fondo.
 *   - Reglas 11-12: el aviso informativo está SIEMPRE presente.
 *   - Regla 10 / lenguaje prudente: nunca "debes demandar", "ganarías",
 *     "es ilegal seguro"; siempre "podría ser relevante", "el corpus sugiere",
 *     "según los criterios disponibles". Un guardarraíl léxico veta lenguaje
 *     imperativo/garantista (defensa ante un criterio mal redactado).
 *   - Regla 17: el fondo solo se compone con decision "answer" Y criterios
 *     servibles; cualquier incoherencia => error (lo recoge el pipeline como
 *     rechazo seguro), nunca una respuesta dudosa.
 */
import type { AdvisorAnswer, LegalCriterion, ConfidenceLevel } from "./models";
import type { DecisionResult, ScopeResult } from "./types";
import { isServable, validateAdvisorAnswer } from "./models";
import {
  ENGLISH_SOURCE_NOTICE,
  SHORT_DISCLAIMER,
  SHORT_DISCLAIMER_EN,
  TRANSLATION_DOUBT_NOTICE_EN,
} from "./legal/disclaimer";
import type { Locale } from "./i18n";
import { areaKnown, areaLabel, clarifyingQuestionLabel, topicLabel } from "./i18n";
import { readableCitation } from "./legal/citations";

// ---------------------------------------------------------------------------
// Constantes de texto fijo (revisables; el aviso es verbatim, Reglas 11-12).

/**
 * Aviso informativo, idéntico en todas las respuestas (campo disclaimer).
 * Fuente única: services/legal/disclaimer.ts (versionado).
 */
export const DISCLAIMER = SHORT_DISCLAIMER;

/**
 * Aviso breve para las respuestas que no entran al fondo. Conserva la frase
 * canónica "no constituye asesoramiento jurídico" para que TODO texto visible
 * lleve el aviso completo (Reglas 11-12).
 */
const DISCLAIMER_BREVE =
  "Recuerde: esto es orientación informativa basada en un corpus cerrado y no constituye " +
  "asesoramiento jurídico.";

/**
 * Lenguaje vetado (Regla 10). Si aparece en el texto compuesto, hay un fallo de
 * contenido (p. ej. un criterio mal redactado): se aborta y el pipeline degrada
 * a rechazo seguro, en vez de mostrar una afirmación imprudente.
 *
 * Cubre el registro IMPERATIVO ("debe(ría) usted demandar/reclamar/denunciar") y
 * el GARANTISTA de resultado ("ganará(s)/ía(s)…", "va(s) a ganar", "seguro que
 * gana", "tiene el caso ganado"), con y sin tilde y admitiendo "usted/vd"
 * intercalado. NO se veta "es ilegal" a secas: un criterio aprobado puede
 * discutir legítimamente la (i)licitud, y su texto es de confianza (revisión
 * humana); vetarlo daría falsos positivos sobre material aprobado.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // Imperativo "debe/tiene que/recomiendo/obligado a (usted) demandar/reclamar/denunciar/querellarse".
  /\b(?:debes?|debe|deben|deber[íi]a(?:s|n)?|deber[íi]ais|tiene[s]?|tienen)\s+(?:usted\s+|vd\.?\s+)?que\s+(?:demandar|reclamar|denunciar|querellar|interponer)/i,
  /\b(?:debes?|debe|deben|deber[íi]a(?:s|n)?|deber[íi]ais)\s+(?:usted\s+|vd\.?\s+)?(?:demandar|reclamar|denunciar|querellar(?:se)?|interponer)/i,
  /\b(?:le\s+)?recomiendo\s+(?:que\s+)?(?:demand|reclam|denunci|querell|interpon)/i,
  /\b(?:est[áa]\s+)?obligad[oa]s?\s+a\s+(?:demandar|reclamar|denunciar|querellar|interponer)/i,
  // Garantía de resultado.
  /\bganar(?:as|ás|a|á|ias|ías|ia|ía|emos|eis|éis|an|amos|ais|lo|la|los|las)\b/i,
  /\bva(?:s|n)?\s+(?:usted\s+|vd\.?\s+)?a\s+ganar(?:lo|la|los|las)?\b/i,
  // Pronóstico de resultado nombrado expresamente por la Regla 18 ("probabilidad
  // de ganar"). Se acota al registro de pronóstico (probabilidad/posibilidad/…
  // de ganar) para NO vetar el infinitivo "ganar" suelto de un criterio legítimo.
  /\b(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?)\s+(?:\w+\s+)?de\s+ganar\b/i,
  /\btriunfar[áa](?:s|n)?\b/i,
  /\b(?:su\s+)?(?:demanda|pretensi[óo]n|recurso|acci[óo]n|reclamaci[óo]n)\s+(?:prosperar[áa](?:n)?|triunfar[áa])/i,
  /\bobtendr[áa](?:s|n)?\s+(?:una\s+)?sentencia\s+(?:favorable|a\s+su\s+favor)/i,
  /\b(?:el\s+)?(?:resultado|fallo)\s+(?:le\s+)?ser[áa]\s+favorable/i,
  /\btiene[s]?\s+(?:el\s+[ée]xito|el\s+caso|la\s+victoria)\s+(?:garantizad[oa]|asegurad[oa]|ganad[oa])\b/i,
  /\bes\s+ilegal\s+seguro\b/i,
  /\bseguro\s+que\s+gana/i,
  /\btiene[s]?\s+(?:el\s+caso\s+)?ganado\b/i,
  // — Huecos de pronóstico/recomendación detectados en la auditoría (Regla 18) —
  // Otras construcciones de "resultado favorable" y recomendación, robustas al
  // orden de palabras y a verbos de logro/conveniencia que el denylist anterior
  // no cubría (la flexibilidad del español hace insuficiente un denylist estrecho).
  /\btendr[áa]n?\s+(?:un\s+|buen\s+|pleno\s+)?[ée]xito\b/i,
  /\b(?:le\s+)?(?:ser[áa]|resultar[áa])\s+favorable\b/i,
  /\bser[áa]\s+de\s+su\s+favor\b/i,
  /\b(?:la\s+)?(?:sentencia|resoluci[óo]n|demanda|pretensi[óo]n)\s+(?:le\s+)?(?:ser[áa]|resultar[áa])\s+(?:favorable|positiv[oa]|a\s+su\s+favor)/i,
  /\b(?:le\s+)?conviene\s+(?:que\s+)?(?:demand|reclam|denunci|querell|interpon|recurr)/i,
  /\b(?:vale\s+la\s+pena|es\s+prudente|es\s+recomendable|es\s+aconsejable)\s+(?:demand|reclam|denunci|querell|interpon|recurr)/i,
  /\bobligad[oa]s?\s+(?:a\s+)?(?:demandar|reclamar|denunciar|querellar|interponer)/i,
  /\b(?:lograr[áa]|conseguir[áa]|obtendr[áa])(?:s|n)?\s+(?:el\s+|la\s+|un[ao]?\s+|su\s+)?(?:[ée]xito|victoria|resoluci[óo]n\s+(?:favorable|positiva)|sentencia\s+(?:favorable|positiva|a\s+su\s+favor))/i,
  /\b(?:tu|su)\s+(?:victoria|[ée]xito)\s+(?:es|est[áa])\s+(?:asegurad[oa]|segur[oa]|garantizad[oa])/i,
  /\bvictoria\s+(?:asegurad[oa]|segur[oa]|garantizad[oa])\b/i,
  /\bperspectivas\s+(?:son\s+|muy\s+|le\s+son\s+)?favorables\b/i,
  /\b\d+\s+por\s+ciento\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|probabilidad)/i,
  /\b[ée]xito\s+(?:garantizad[oa]|asegurad[oa]|seguro)\b/i,
  // — Segunda tanda de huecos (auditoría): pronóstico "blando", subjuntivo,
  //   pasiva y condicional. La aprobación humana sigue siendo la garantía real;
  //   esto es defensa en profundidad para que ningún criterio mal redactado emita
  //   pronóstico (Regla 18). Se evita el infinitivo "ganar" suelto.
  /\bgan(?:e|es|emos|en|ar[áa]n)\s+(?:usted\s+)?(?:el\s+|mi\s+|la\s+|este\s+|ese\s+|su\s+)?(?:juicio|caso|pleito|litigio|demanda|recurso|asunto)\b/i,
  /\b(?:buenas?|altas?|muchas?|excelentes|grandes)\s+(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|prosperar|triunfar)/i,
  /\b(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+(?:\w+\s+){0,2}de\s+(?:[ée]xito|victoria|prosperar|triunfar)\b/i,
  /\bhay\s+(?:una\s+)?(?:posibilidad|probabilidad|opci[óo]n|oportunidad)\s+de\s+(?:[ée]xito|ganar|victoria)/i,
  /\bpodr[íi]a?s?\s+(?:usted\s+)?(?:ganar|vencer|prosperar|triunfar|tener\s+[ée]xito|obtener\s+(?:una\s+)?(?:sentencia|resoluci[óo]n)\s+(?:favorable|a\s+su\s+favor))/i,
  /\bes\s+probable\s+que\s+(?:\w+\s+){0,2}(?:gan(?:e|es|en|emos)|venza|prosper(?:e|en)|triunf(?:e|en)|tenga\s+[ée]xito)/i,
  /\b(?:ser[áa]|ser[íi]a)\s+ganad[oa]\b/i,
  /\bganad[oa]\s+por\s+(?:usted|vd\.?|ti|el\s+demandante|la\s+demandante)/i,
  /\b(?:su\s+)?(?:caso|demanda|pretensi[óo]n|pleito)\s+(?:ser[íi]a|ser[áa])\s+(?:decidid[oa]|resuelt[oa]|fallad[oa])\s+(?:a\s+su\s+favor|favorablemente)/i,
  /\bperspectivas\s+(?:de\s+|muy\s+buenas?\s+de\s+|buenas?\s+de\s+)?(?:[ée]xito|ganar|victoria|triunfo)\b/i,
  /\b(?:buenas?|excelentes|magn[íi]ficas|inmejorables|muy\s+buenas?)\s+perspectivas\b/i,
  /\b(?:habr[íi]a?s?|hubiera[ns]?|hubiese[ns]?|hay[ae]n?)\s+ganad[oa]\b/i,
  /\b(?:tu|su)\s+[ée]xito\s+es\s+probable\b/i,
  // — Tercera tanda (verificación adversarial): cobertura COMPLETA de conjugación
  //   de los verbos-resultado, incl. futuro 1ª persona (-é) y condicional (-ía),
  //   que el denylist anterior omitía. Se prueba sobre el texto des-acentuado, así
  //   que las terminaciones sin tilde bastan; se incluyen ambas por robustez.
  /\b(?:gana|perde|vence|prospera|triunfa)r(?:[ée]|es|emos|[ée]is|[áa]n|[áa]s|[áa]|[íi]a|[íi]as|[íi]amos|[íi]ais|[íi]an)\b/i,
  /\b(?:tendr|obtendr)(?:[ée]|[áa]s?|[áa]|emos|[ée]is|[áa]n|[íi]as?|[íi]amos|[íi]ais|[íi]an)\s+(?:un\s+|buen\s+|pleno\s+|el\s+)?(?:[ée]xito|(?:una?\s+)?(?:sentencia|resoluci[óo]n)\s+(?:favorable|positiva|a\s+su\s+favor))/i,
  /\b(?:ser|resultar)(?:[ée]|[áa]s?|[áa]|emos|[ée]is|[áa]n|[íi]as?|[íi]amos|[íi]ais|[íi]an)\s+(?:le\s+|los\s+|las\s+)?(?:favorable|de\s+su\s+favor|a\s+su\s+favor|positiv[oa]|ganador(?:es|a|as)?|vencedor(?:es|a|as)?)/i,
  // Subjuntivo "desnudo" con sujeto procesal ("venza/gane/prospere el demandante").
  /\b(?:gan(?:e|en|emos)|venz(?:a|an)|prosper(?:e|en)|triunf(?:e|en))\s+(?:el|la|los|las|su|mi|este|ese|un[oa]?)\s+(?:demandante|demandada|demanda|pretensi[óo]n|acci[óo]n|reclamaci[óo]n|caso|pleito|juicio|litigio|recurso|asunto)\b/i,
];

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

export interface ComposeInput {
  /** Pregunta original del usuario (no se reinterpreta; se enmarca). */
  question: string;
  /** Clasificación de scopeClassifier. */
  scope: ScopeResult;
  /** Decisión del decisionEngine (gobierna el formato). */
  decision: DecisionResult;
  /** Criterios aprobados recuperados (solo se usan si decision === "answer"). */
  criteria: LegalCriterion[];
  /** Idioma de PRESENTACIÓN (por defecto "es"). El razonamiento es español. */
  locale?: Locale;
  /** true si la traducción de la consulta fue dudosa (añade aviso, Regla 6). */
  translation_uncertain?: boolean;
}

/** Metadatos de identidad/traza que aporta el pipeline (no se inventan aquí). */
export interface ComposeMeta {
  id: string;
  query_id: string;
  created_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------

/**
 * Quita acentos (NFD + descarta diacríticos). CRÍTICO para el denylist en
 * JavaScript: `\b` aquí es ASCII, así que un patrón que termina en vocal
 * acentuada ("ganará", "tendrá", "será") NO casa con `\b` final (la vocal
 * acentuada no es `\w`). Probando además contra el texto des-acentuado, los
 * patrones (que incluyen la rama sin tilde) sí casan y el límite `\b` funciona.
 * (En Python `\b` es Unicode y no haría falta, pero el motor real es JS/TS.)
 */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * ¿El texto contiene lenguaje vetado (imperativo/garantista, Regla 10)? Denylist
 * de defensa en profundidad — NO un filtro completo: la garantía real es que el
 * contenido (criterion_text del corpus, respuestas del catálogo) lo aprueba un
 * humano que no admitiría asesoramiento directo. Reutilizable por el catálogo.
 */
export function hasForbiddenLanguage(text: string): boolean {
  const alt = deaccent(text);
  return FORBIDDEN_PATTERNS.some((re) => re.test(text) || re.test(alt));
}

function assertNoForbiddenLanguage(text: string): void {
  if (hasForbiddenLanguage(text)) {
    throw new Error(
      "answerComposer: lenguaje vetado detectado en la respuesta compuesta; " +
        "se aborta para no emitir una afirmación imprudente (Regla 10).",
    );
  }
}

/** Confianza global = la MÁS PRUDENTE (más baja) entre los criterios usados. */
function lowestConfidence(criteria: LegalCriterion[]): ConfidenceLevel {
  return criteria.reduce<ConfidenceLevel>(
    (acc, c) => (CONFIDENCE_RANK[c.confidence_level] < CONFIDENCE_RANK[acc] ? c.confidence_level : acc),
    "high",
  );
}

function renderAnswer(input: ComposeInput, criteria: LegalCriterion[]): { text: string; limits: string } {
  const { scope } = input;
  const area = scope.area;
  const topic = scope.topic ?? "(tema no determinado)";
  const subt =
    scope.subtopics.length > 0 ? `; en concreto: ${scope.subtopics.join(", ")}` : "";

  // 1. Lo que he entendido — reformulación sin añadir hechos nuevos.
  const s1 =
    "1. Lo que he entendido\n" +
    `He entendido que su consulta se refiere a ${area.toLowerCase()}, en relación con «${topic}»${subt}. ` +
    "Tomo como base únicamente lo que usted ha descrito, sin añadir hechos que no haya mencionado.";

  // 2. Encaje dentro del corpus.
  const s2 =
    "2. Encaje dentro del corpus\n" +
    `La consulta encaja en el área «${area}», tema «${topic}».`;

  // 3. Criterios aplicables — citas SOLO desde metadatos (Reglas 4 y 9).
  // criterion_text se emite VERBATIM: es texto del corpus aprobado por revisión
  // humana; cualquier norma que contenga procede del corpus, no se "inventa"
  // aquí (Reglas 1 y 3). Las plantillas del módulo no añaden normas.
  const s3lines = criteria.map(
    (c) =>
      `   • [${c.id}] ${c.criterion_text}\n` +
      `     Fuente: ${readableCitation(c)}.`,
  );
  const s3 = "3. Criterios aplicables\n" + s3lines.join("\n");

  // 4. Orientación informativa — prudente, sin conclusión.
  const s4items = criteria.map((c) => {
    const cond =
      c.conditions_for_application.length > 0
        ? ` Esto podría ser relevante si concurren: ${c.conditions_for_application.join("; ")}.`
        : "";
    return `   • Según los criterios disponibles, el corpus recoge que ${c.criterion_text}${cond}`;
  });
  const s4 =
    "4. Orientación informativa\n" +
    "Según los criterios disponibles en el corpus, los siguientes elementos podrían ser " +
    "relevantes para orientar el análisis, sin que ello anticipe ningún resultado:\n" +
    s4items.join("\n") +
    "\nEl corpus no permite afirmar un resultado: estos criterios solo orientan el análisis.";

  // 5. Límites de esta respuesta.
  const noResponde = unique(criteria.flatMap((c) => c.does_not_answer));
  const limitesCrit = unique(criteria.flatMap((c) => c.limits));
  const limitsBody =
    "Esta respuesta no concluye su caso. En particular, los criterios usados no resuelven: " +
    `${noResponde.join("; ")}. Además, presentan estos límites: ${limitesCrit.join("; ")}. ` +
    "El resultado real dependería de la prueba que se practique y de la normativa vigente, " +
    "que esta herramienta no verifica.";
  const s5 = "5. Límites de esta respuesta\n" + limitsBody;

  // 6. Aviso.
  const s6 = "6. Aviso\n" + DISCLAIMER;

  return { text: [s1, s2, s3, s4, s5, s6].join("\n\n"), limits: limitsBody };
}

function renderClarify(decision: DecisionResult): { text: string; limits: string } {
  const qs = decision.clarifying_questions;
  const body =
    "No puedo analizar el fondo todavía: faltan datos esenciales para aplicar los criterios " +
    "del corpus. Para poder orientarle, necesitaría que precise:\n" +
    qs.map((q) => `   • ${q}`).join("\n") +
    `\n\n${DISCLAIMER_BREVE}`;
  return { text: body, limits: "No se ha analizado el fondo: faltan datos esenciales." };
}

function renderOutOfScope(scope: ScopeResult): { text: string; limits: string } {
  const body =
    "Esta cuestión no está cubierta por las resoluciones del corpus analizado, por lo que no " +
    "puedo darle una orientación jurídica sobre ella. El corpus se limita a materias de marcas, " +
    "propiedad intelectual, patentes y aspectos procesales relacionados. Si su consulta tiene " +
    "algún componente de esas materias, puede reformularla centrándose en él. Para preguntas " +
    "frecuentes ya validadas, puede consultar el catálogo de preguntas estándar; para su caso " +
    "concreto, dirigirse a un profesional.\n\n" +
    DISCLAIMER_BREVE;
  void scope;
  return { text: body, limits: "La materia queda fuera del corpus analizado." };
}

function renderInsufficient(): { text: string; limits: string } {
  const body =
    "No hay criterios aprobados suficientes en la base de conocimiento para orientar esta " +
    "consulta, de modo que prefiero no improvisar una respuesta. Puede consultar el catálogo de " +
    "preguntas estándar validadas o dirigirse a un profesional para su caso concreto.\n\n" +
    DISCLAIMER_BREVE;
  return {
    text: body,
    limits: "El corpus no contiene criterios aprobados aplicables a esta consulta.",
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Renderizado en INGLÉS (capa de presentación). El MARCO va en inglés; el
// contenido sustantivo de los criterios (criterion_text), las fuentes
// (source_reference), los órganos, números de resolución y fechas se mantienen
// EN ESPAÑOL, verbatim (Reglas 1 y 2 de i18n). Se añade el aviso de traducción
// (Regla 3) y, si procede, el de duda (Regla 6).

function englishNotices(translationUncertain: boolean): string {
  let n = ENGLISH_SOURCE_NOTICE;
  if (translationUncertain) n += "\n" + TRANSLATION_DOUBT_NOTICE_EN;
  return n;
}

function renderAnswerEn(
  input: ComposeInput,
  criteria: LegalCriterion[],
): { text: string; limits: string } {
  const { scope } = input;
  const area = areaLabel(scope.area, "en");
  const t = topicLabel(scope.topic, "en");
  const topic = t.label ?? "(topic not determined)";
  const subt = scope.subtopics.length > 0 ? ` (specifically: ${scope.subtopics.join(", ")})` : "";
  // Regla 6 también en el eje ES→EN de etiquetas: si el área o el tema no tienen
  // traducción inglesa conocida, se emite el español verbatim => hay duda.
  const labelUncertain = !t.known || !areaKnown(scope.area);
  const uncertain = input.translation_uncertain === true || labelUncertain;

  const s1 =
    "1. What I understood\n" +
    `I understand that your query concerns ${area.toLowerCase()}, regarding «${topic}»${subt}. ` +
    "I rely only on what you have described, without adding facts you did not mention.";

  const s2 = "2. Fit within the corpus\n" + `The query fits the area «${area}», topic «${topic}».`;

  // 3. Aplicables — el texto del criterio y la fuente quedan EN ESPAÑOL (verbatim).
  const s3lines = criteria.map(
    (c) =>
      `   • [${c.id}] ${c.criterion_text}\n` +
      `     Source (in Spanish): ${readableCitation(c)}.`,
  );
  const s3 = "3. Applicable criteria\n" + s3lines.join("\n");

  const s4items = criteria.map((c) => {
    const cond =
      c.conditions_for_application.length > 0
        ? ` This may be relevant if the following concur: ${c.conditions_for_application.join("; ")}.`
        : "";
    return `   • According to the available criteria, the corpus records that: ${c.criterion_text}${cond}`;
  });
  const s4 =
    "4. Informational guidance\n" +
    "Based on the available criteria in the corpus, the following points may be relevant to " +
    "guide the analysis, without anticipating any outcome:\n" +
    s4items.join("\n") +
    "\nThe corpus does not allow asserting an outcome: these criteria only guide the analysis.";

  const noResponde = unique(criteria.flatMap((c) => c.does_not_answer));
  const limitesCrit = unique(criteria.flatMap((c) => c.limits));
  const limitsBody =
    "This response does not resolve your case. In particular, the criteria used do not " +
    `address: ${noResponde.join("; ")}. They also carry these limits: ${limitesCrit.join("; ")}. ` +
    "The actual outcome would depend on the evidence produced and on the applicable law in " +
    "force, which this tool does not verify.";
  const s5 = "5. Limits of this response\n" + limitsBody;

  const s6 = "6. Notice\n" + SHORT_DISCLAIMER_EN + "\n" + englishNotices(uncertain);

  return { text: [s1, s2, s3, s4, s5, s6].join("\n\n"), limits: limitsBody };
}

function renderClarifyEn(input: ComposeInput): { text: string; limits: string } {
  // Las preguntas del corpus se traducen por glosario cerrado (no inventa — Regla 4).
  const qs = input.decision.clarifying_questions.map((q) => clarifyingQuestionLabel(q, "en"));
  const body =
    "I cannot analyse the merits yet: essential information is missing to apply the corpus " +
    "criteria. To guide you, I would need you to clarify:\n" +
    qs.map((q) => `   • ${q}`).join("\n") +
    `\n\n${SHORT_DISCLAIMER_EN}\n${englishNotices(input.translation_uncertain === true)}`;
  return { text: body, limits: "The merits were not analysed: essential information is missing." };
}

function renderOutOfScopeEn(input: ComposeInput): { text: string; limits: string } {
  const body =
    "This question is not covered by the decisions in the analysed corpus, so I cannot give " +
    "you legal guidance on it. The corpus is limited to trademarks, intellectual property, " +
    "patents and related procedural matters. If your query has any component within those " +
    "areas, you can rephrase it focusing on that. For common, already-validated questions you " +
    "may consult the catalogue of standard questions; for your specific case, turn to a professional.\n\n" +
    SHORT_DISCLAIMER_EN +
    "\n" +
    englishNotices(input.translation_uncertain === true);
  return { text: body, limits: "The matter falls outside the analysed corpus." };
}

function renderInsufficientEn(input: ComposeInput): { text: string; limits: string } {
  const body =
    "There are not enough approved criteria in the knowledge base to guide this query, so I " +
    "prefer not to improvise an answer. You may consult the catalogue of validated standard " +
    "questions or turn to a professional for your specific case.\n\n" +
    SHORT_DISCLAIMER_EN +
    "\n" +
    englishNotices(input.translation_uncertain === true);
  return { text: body, limits: "The corpus contains no approved criteria applicable to this query." };
}

/**
 * Compone el AdvisorAnswer final. Valida la salida antes de devolverla: si la
 * composición resultara no conforme (p. ej. answer sin criterios, lenguaje
 * vetado), lanza — el pipeline lo recoge como rechazo seguro (deny-by-default).
 */
export function composeAnswer(input: ComposeInput, meta: ComposeMeta): AdvisorAnswer {
  const { decision } = input;
  const en = input.locale === "en";

  let answer_text: string;
  let limits: string;
  let criteria_used: string[] = [];
  let sources_used: { criterion_id: string; judgment_id: string }[] = [];
  let confidence_level: ConfidenceLevel | null = null;

  if (decision.decision === "answer") {
    // Defensa en profundidad: solo se compone el fondo con criterios servibles
    // y tema determinado (Reglas 5 y 17).
    const servable = input.criteria.filter((c) => isServable(c));
    const seen = new Set<string>();
    const criteria = servable.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    if (criteria.length === 0 || input.scope.topic === null) {
      throw new Error(
        "answerComposer: se pidió componer 'answer' sin criterios servibles o sin tema; " +
          "incoherencia con el decisionEngine (Reglas 5 y 17).",
      );
    }
    const rendered = en ? renderAnswerEn(input, criteria) : renderAnswer(input, criteria);
    answer_text = rendered.text;
    limits = rendered.limits;
    criteria_used = criteria.map((c) => c.id);
    sources_used = criteria.map((c) => ({ criterion_id: c.id, judgment_id: c.judgment_id }));
    confidence_level = lowestConfidence(criteria);
  } else if (decision.decision === "clarify") {
    const r = en ? renderClarifyEn(input) : renderClarify(decision);
    answer_text = r.text;
    limits = r.limits;
  } else if (decision.decision === "out_of_scope") {
    const r = en ? renderOutOfScopeEn(input) : renderOutOfScope(input.scope);
    answer_text = r.text;
    limits = r.limits;
  } else {
    const r = en ? renderInsufficientEn(input) : renderInsufficient();
    answer_text = r.text;
    limits = r.limits;
  }

  // Guardarraíl de lenguaje prudente sobre TODO el texto emitido (Regla 10).
  // Se aplica también en inglés: el criterion_text incrustado sigue en español.
  assertNoForbiddenLanguage(answer_text);

  const answer: AdvisorAnswer = {
    id: meta.id,
    query_id: meta.query_id,
    decision: decision.decision,
    answer_text,
    criteria_used,
    sources_used,
    limits,
    confidence_level,
    disclaimer: en ? SHORT_DISCLAIMER_EN : DISCLAIMER,
    created_at: meta.created_at,
  };

  // El módulo NUNCA emite un AdvisorAnswer no conforme (citas 1:1, disclaimer,
  // vacíos por decisión, etc. — validados por el modelo F1).
  const verdict = validateAdvisorAnswer(answer);
  if (!verdict.valid) {
    throw new Error(
      `answerComposer: respuesta compuesta no conforme al modelo: ${verdict.errors.join("; ")}`,
    );
  }
  return answer;
}
