/**
 * caseEvaluator — "Calificación de alineación con criterios del corpus" (Case Fit
 * Grade). NO predice el resultado de un litigio. Compara los HECHOS del caso del
 * usuario (caseFactsExtractor) contra los criterios APROBADOS recuperados
 * (criteriaRetriever) y produce una calificación A–D / insuficiente que mide solo
 * ALINEACIÓN, no mérito ni victoria.
 *
 * Reutiliza la lógica determinista ya verificada de caseScoreboard
 * (computeCaseScoreboard) y la mapea a letras + explicaciones. Reglas que aplica:
 *   - Reglas 1-5/13: solo criterios aprobados; nunca pending; nunca sentencias en
 *     bruto; documentos del usuario son SOLO hechos (caseFactsExtractor no escribe corpus).
 *   - Regla 18 + reglas del módulo: jamás "probabilidad de ganar/perder/X%/debes
 *     demandar"; un guardarraíl veta esos textos (deny-by-default).
 *   - Condiciones para NO calificar: fuera de alcance, sin criterios aprobados,
 *     documentos ilegibles, faltan hechos esenciales, solo pending, o el usuario
 *     pide una PREDICCIÓN directa de victoria.
 */
import type { Judgment, LegalCriterion, UploadedFile } from "./models";
import type { Locale } from "./i18n";
import { normalizeQuery, resolveLocale } from "./i18n";
import { classifyScope } from "./scopeClassifier";
import { extractCaseFacts } from "./caseFactsExtractor";
import { loadApprovedCriteria, retrieveApprovedCriteria } from "./criteriaRetriever";
import { loadJudgmentRegistry } from "./judgmentRegistry";
import { computeCaseScoreboard, hasScoreboardForbiddenLanguage } from "./caseScoreboard";
import { SHORT_DISCLAIMER, SHORT_DISCLAIMER_EN } from "./legal/disclaimer";

export type CaseGrade = "A" | "B" | "C" | "D" | "insuficiente";

export interface EvalFactor {
  factor: string;
  explicacion: string;
  criterion_id: string;
  source_reference: string;
  judgment_id: string;
  /** Nombre LEGIBLE de la resolución (Regla 9); hereda del factor del scoreboard. */
  resolution: string;
  evidence: string;
}
export interface EvalUncertain {
  factor: string;
  why_it_matters: string;
  what_is_missing: string;
  documents: string[];
}
export interface CaseEvaluation {
  /** Decisión del motor de evaluación: se calificó ("evaluate_case") o no ("cannot_evaluate_case"). */
  decision: "evaluate_case" | "cannot_evaluate_case";
  case_fit_score: number | null;
  case_fit_grade: CaseGrade;
  score_label: string;
  confidence_level: "baja" | "media" | "alta";
  case_summary: string;
  classified_area: string | null;
  classified_topic: string | null;
  asunto_hint: string;
  favorable_factors: EvalFactor[];
  unfavorable_factors: EvalFactor[];
  uncertain_factors: EvalUncertain[];
  missing_facts: string[];
  criteria_used: Array<{ criterion_id: string; source_reference: string; judgment_id: string; resolution: string }>;
  evidence_used: string[];
  limits: string[];
  next_information_needed: string[];
  /** Si no se calificó: por qué. */
  reason: string | null;
  disclaimer: string;
}

// El usuario PIDE una predicción de resultado (no se califica; condición 6).
// Cubre futuro/condicional/subjuntivo de ganar/perder/vencer (la flexión del
// español hace insuficiente un denylist estrecho — huecos hallados en auditoría).
const PREDICTION_REQUEST: RegExp[] = [
  /\b(?:voy|vas?|vamos|van)\s+a\s+(?:ganar|perder|vencer|prosperar|triunfar)\b/i,
  /\bprobabilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b/i,
  /\bposibilidad(?:es)?\s+de\s+(?:ganar|perder|[ée]xito|vencer|prosperar)\b/i,
  /\b(?:tengo|hay|tienes?|tenemos)\s+(?:buenas?\s+|muchas?\s+|pocas?\s+|algunas?\s+)?(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?|oportunidad(?:es)?)\s+de\s+(?:ganar|[ée]xito|vencer|prosperar)\b/i,
  /\bqu[ée]\s+(?:probabilidad(?:es)?|posibilidad(?:es)?|opciones|chances?)\s+(?:tengo|hay|tienes?)/i,
  // Verbo ganar/perder/vencer en futuro, condicional o subjuntivo + objeto pleito.
  /\b(?:gano|gane|ganes|ganemos|ganen|ganar[ée]|ganar[áa]s?|ganar[áa]n|ganaremos|ganar[íi]a(?:s|mos|n)?|pierdo|pierdes|perder[ée]|perder[áa]s?|perder[íi]a|venzo|venza|vencer[ée]|vencer[áa]s?)\s+(?:el\s+|mi\s+|la\s+|este\s+|ese\s+)?(?:juicio|caso|pleito|litigio|demanda|recurso|asunto)\b/i,
  /\b(?:podr[íi]a?s?|podremos|podr[áa]n?)\s+(?:usted\s+)?(?:ganar|vencer|prosperar|tener\s+[ée]xito)\b/i,
  // Futuro/condicional autónomo de ganar/perder/vencer/prosperar/triunfar (sin objeto):
  // "ganaré", "ganarías", "ganarán", "perderá", "prosperaría" — son pronóstico en sí.
  /\b(?:gana|perde|vence|prospera|triunfa)r(?:[ée]|[áa]s?|[áa]n|emos|[íi]as?|[íi]amos|[íi]an)\b/i,
  /\bes\s+probable\s+que\s+(?:\w+\s+){0,2}(?:gan|venz|prosper|triunf)/i,
  /\b(?:me\s+conviene|debo|deber[íi]a|me\s+recomiendas?)\s+(?:demandar|reclamar|denunciar|querellar|recurrir|interponer)/i,
  /\b(?:cu[áa]les?\s+son\s+)?(?:mis\s+)?(?:perspectivas|expectativas)\s+(?:de\s+)?(?:[ée]xito|ganar|victoria|triunfo|del?\s+caso|del?\s+pleito)/i,
];
export function asksForPrediction(text: string): boolean {
  const t = text || "";
  // En JS `\b` es ASCII: un patrón terminado en vocal acentuada ("ganaré",
  // "ganará") no casaría. Se prueba también sin acentos para que casen.
  const alt = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return PREDICTION_REQUEST.some((re) => re.test(t) || re.test(alt));
}

const LIMIT_ES =
  "Esta calificación no predice el resultado de un procedimiento y no constituye asesoramiento " +
  "jurídico. Solo mide la alineación entre los hechos aportados y los criterios aprobados disponibles " +
  "en el corpus cerrado.";
const LIMIT_EN =
  "This grade does not predict the outcome of any proceeding and is not legal advice. It only measures " +
  "the alignment between the facts provided and the approved criteria available in the closed corpus.";

export interface CaseEvalInput {
  case_name?: string;
  description: string;
  /** Tipo de asunto indicado por el usuario (no anula el clasificador cerrado). */
  asunto_hint?: string;
  files?: UploadedFile[];
}
export interface RunEvalOptions {
  corpus?: LegalCriterion[];
  judgmentsById?: ReadonlyMap<string, Judgment>;
  locale?: Locale;
}

export function runCaseEvaluation(input: CaseEvalInput, opts: RunEvalOptions = {}): CaseEvaluation {
  const locale = resolveLocale(opts.locale);
  const en = locale === "en";
  const limit = en ? LIMIT_EN : LIMIT_ES;
  const disclaimer = en ? SHORT_DISCLAIMER_EN : SHORT_DISCLAIMER;
  const description = input.description || "";
  const asunto = input.asunto_hint || "No estoy seguro";

  function notGraded(reason: string, facts: ReturnType<typeof extractCaseFacts> | null, scopeArea: string | null, scopeTopic: string | null): CaseEvaluation {
    return {
      decision: "cannot_evaluate_case",
      case_fit_score: null,
      case_fit_grade: "insuficiente",
      score_label: en ? "insufficient information" : "información insuficiente",
      confidence_level: "baja",
      case_summary: facts ? facts.case_summary : "",
      classified_area: scopeArea,
      classified_topic: scopeTopic,
      asunto_hint: asunto,
      favorable_factors: [],
      unfavorable_factors: [],
      uncertain_factors: [],
      missing_facts: facts ? facts.missing_facts : [],
      criteria_used: [],
      evidence_used: facts ? facts.evidence_items.map((e) => `${e.filename} (${e.extraction_status})`) : [],
      limits: [limit],
      next_information_needed: facts ? facts.missing_facts : [],
      reason,
      disclaimer,
    };
  }

  // Condición 6: el usuario pide una PREDICCIÓN directa de victoria → no se califica.
  // asunto_hint es texto LIBRE no confiable: se inspecciona igual que la descripción
  // (un usuario podría colar la predicción ahí para evadir el guardarraíl, Regla 18).
  if (asksForPrediction(description) || asksForPrediction(asunto)) {
    return notGraded(
      "Has pedido una predicción de resultado. Esta herramienta no predice quién gana ni el resultado " +
        "de un litigio; solo mide la alineación de los hechos con los criterios aprobados. Reformula " +
        "describiendo únicamente los hechos del caso.",
      null,
      null,
      null,
    );
  }

  try {
    const judgmentsById = opts.judgmentsById ?? loadJudgmentRegistry();
    const corpus = opts.corpus ?? loadApprovedCriteria();
    const norm = normalizeQuery(description, locale);
    const scope = classifyScope(norm.spanish);
    const facts = extractCaseFacts({ question: norm.spanish, files: input.files ?? [] });
    const retrieval = retrieveApprovedCriteria(scope, corpus, new Set(judgmentsById.keys()));
    const sb = computeCaseScoreboard({ question: description, scope, facts, retrieval }, locale);

    if (!sb.computable) {
      return notGraded(sb.reason ?? "No se puede calificar.", facts, scope.out_of_scope ? null : scope.area, scope.topic);
    }

    const score = sb.case_fit_score as number;
    const missingN = facts.missing_facts.length;
    let grade: CaseGrade;
    let label: string;
    if (score >= 80 && missingN === 0) {
      grade = "A";
      label = en ? "high alignment" : "alta alineación";
    } else if (score >= 60) {
      grade = "B";
      label = en ? "medium alignment" : "alineación media";
    } else if (score >= 40) {
      grade = "C";
      label = en ? "medium alignment" : "alineación media";
    } else {
      grade = "D";
      label = en ? "low alignment" : "baja alineación";
    }

    const confMap: Record<string, "baja" | "media" | "alta"> = { bajo: "baja", medio: "media", alto: "alta" };
    const favorable: EvalFactor[] = sb.favorable_factors.map((f) => ({
      ...f,
      explicacion: "El hecho aportado coincide con una condición que el criterio del corpus considera relevante para el análisis (no implica un resultado).",
    }));
    const unfavorable: EvalFactor[] = sb.unfavorable_factors.map((f) => ({
      ...f,
      explicacion: "Es una cuestión que el corpus aprobado NO resuelve, lo que limita la alineación; no implica un resultado adverso.",
    }));
    const uncertain: EvalUncertain[] = sb.uncertain_factors.map((u) => ({
      ...u,
      documents: facts.evidence_items.map((e) => e.filename),
    }));

    const result: CaseEvaluation = {
      decision: "evaluate_case",
      case_fit_score: score,
      case_fit_grade: grade,
      score_label: label,
      confidence_level: confMap[sb.confidence_level] ?? "baja",
      case_summary: facts.case_summary,
      classified_area: scope.area,
      classified_topic: scope.topic,
      asunto_hint: asunto,
      favorable_factors: favorable,
      unfavorable_factors: unfavorable,
      uncertain_factors: uncertain,
      missing_facts: facts.missing_facts,
      criteria_used: sb.criteria_used,
      evidence_used: sb.evidence_used,
      limits: [limit, ...sb.limits.slice(1)],
      next_information_needed: facts.missing_facts,
      reason: null,
      disclaimer,
    };

    // Defensa Regla 18: ningún texto de la calificación puede ser pronóstico
    // (incluye asunto_hint, que es texto libre del usuario).
    const allText = [...favorable, ...unfavorable]
      .map((f) => `${f.factor} ${f.explicacion}`)
      .concat(result.limits)
      .concat([asunto])
      .join(" ");
    if (hasScoreboardForbiddenLanguage(allText)) {
      return notGraded("El contenido no superó la comprobación de seguridad (Regla 18).", facts, scope.area, scope.topic);
    }
    return result;
  } catch {
    return notGraded("Fallo técnico; no se puede calificar (deny-by-default).", null, null, null);
  }
}
