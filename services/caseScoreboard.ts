/**
 * caseScoreboard — "Score de alineación con criterios del corpus" (Case Fit Score).
 *
 * NO es una probabilidad de ganar. NO predice el resultado de un procedimiento.
 * Mide, de forma DETERMINISTA y auditable, qué tan ALINEADOS están los hechos
 * disponibles del usuario con los criterios APROBADOS del corpus para la materia:
 *   - cobertura de hechos esenciales (de la checklist cerrada) = eje del score;
 *   - factores "favorables" = hechos presentes alineados con criterios (criterio+fuente);
 *   - factores "desfavorables" = puntos que el corpus NO resuelve (does_not_answer);
 *   - factores "inciertos" = datos ambiguos / contradicciones / documentos ilegibles.
 *
 * Reglas que aplica (spec + CLAUDE.md):
 *   - Regla 1: sin criterios aprobados suficientes => NO se calcula score.
 *   - Regla 2/6: faltan hechos esenciales (o muchos) => score_label "insuficiente"/no "alto".
 *   - Regla 3: evidencia débil/ilegible o contradicciones => baja confidence_level.
 *   - Reglas 7-8 + Regla 18 (CLAUDE.md): NUNCA lenguaje de pronóstico/probabilidad
 *     ("probabilidad de ganar/éxito", "ganarías", "perderías", "X% de éxito",
 *     "debes demandar"). Un guardarraíl léxico veta esto; si apareciera => deny-by-default.
 *   - Reglas 10-13: muestra criterios usados + fuentes; cada factor conectado a criterio+fuente.
 *   - Regla 14: cada hecho usado conectado a evidencia del usuario o a la consulta.
 *   - Reglas 9/12: siempre límites + aviso de orientación informativa.
 */
import type { Judgment, LegalCriterion, UploadedFile } from "./models";
import type { RetrievalResult, ScopeResult } from "./types";
import type { Locale } from "./i18n";
import { normalizeQuery, resolveLocale } from "./i18n";
import { hasForbiddenLanguage } from "./answerComposer";
import { SHORT_DISCLAIMER, SHORT_DISCLAIMER_EN } from "./legal/disclaimer";
import { readableCitation } from "./legal/citations";
import { classifyScope } from "./scopeClassifier";
import { extractCaseFacts } from "./caseFactsExtractor";
import type { CaseFactsResult } from "./caseFactsExtractor";
import { loadApprovedCriteria, retrieveApprovedCriteria } from "./criteriaRetriever";
import { loadJudgmentRegistry } from "./judgmentRegistry";

export type ScoreLabel = "bajo" | "medio" | "alto" | "insuficiente";
export type ConfLabel = "bajo" | "medio" | "alto";

export interface ScoreFactor {
  factor: string;
  criterion_id: string;
  /** Fuente del criterio EN ESPAÑOL (verbatim, nunca se traduce — i18n Regla 1). */
  source_reference: string;
  judgment_id: string;
  /** Nombre LEGIBLE de la resolución para mostrar (Regla 9); el judgment_id se
   *  conserva para trazabilidad. Derivado de source_reference+judgment_id. */
  resolution: string;
  /** Evidencia del usuario relacionada (documento+localización) o la consulta. */
  evidence: string;
}

export interface UncertainFactor {
  factor: string;
  why_it_matters: string;
  what_is_missing: string;
}

export interface ScoreboardResult {
  computable: boolean;
  /** 0-100; null si NO se calcula (Regla 1: sin criterios no hay score). */
  case_fit_score: number | null;
  score_label: ScoreLabel;
  confidence_level: ConfLabel;
  favorable_factors: ScoreFactor[];
  unfavorable_factors: ScoreFactor[];
  uncertain_factors: UncertainFactor[];
  missing_facts: string[];
  criteria_used: Array<{ criterion_id: string; source_reference: string; judgment_id: string; resolution: string }>;
  evidence_used: string[];
  limits: string[];
  next_information_needed: string[];
  /** Por qué no se pudo calcular (si computable=false). */
  reason: string | null;
  disclaimer: string;
}

export interface ScoreboardInput {
  question: string;
  scope: ScopeResult;
  facts: CaseFactsResult;
  retrieval: RetrievalResult;
}

// Vetos adicionales del scoreboard (sobre el guardarraíl general de answerComposer).
const SCOREBOARD_EXTRA: RegExp[] = [
  /\bprobabilidad(?:es)?\s+de\s+(?:ganar|[ée]xito|victoria)\b/i,
  /\bprobabilidad(?:es)?\s+de\s+[ée]xito\b/i,
  /\b\d+\s*%\s*(?:de\s+)?(?:ganar|[ée]xito|exito|victoria|probabilidad)/i,
  /\bperder[íi]as?\b/i,
  /\bvas?\s+a\s+perder\b/i,
  /\b[ée]xito\s+(?:garantizado|asegurado|seguro)\b/i,
];

/** ¿El texto contiene lenguaje de pronóstico/probabilidad prohibido por el scoreboard? */
export function hasScoreboardForbiddenLanguage(text: string): boolean {
  // También se prueba sin acentos: en JS `\b` es ASCII y un patrón terminado en
  // vocal acentuada no casaría (ver answerComposer.deaccent). hasForbiddenLanguage
  // ya lo hace internamente; aquí se replica para SCOREBOARD_EXTRA.
  const alt = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return hasForbiddenLanguage(text) || SCOREBOARD_EXTRA.some((re) => re.test(text) || re.test(alt));
}

const LIMIT_TEXT_ES =
  "Este score NO predice el resultado de un procedimiento. Solo mide la alineación entre los hechos " +
  "aportados y los criterios aprobados disponibles en el corpus. Es una herramienta orientativa basada " +
  "en un corpus cerrado y no constituye asesoramiento jurídico.";
const LIMIT_TEXT_EN =
  "This score does NOT predict the outcome of any proceeding. It only measures the alignment between the " +
  "facts provided and the approved criteria available in the corpus. It is an informational tool based on " +
  "a closed corpus and does not constitute legal advice.";

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function bandLabel(score: number, missingCount: number, total: number): ScoreLabel {
  // Regla 2/6: muchos hechos esenciales ausentes => insuficiente; no "alto" con ausencias.
  if (total > 0 && missingCount / total > 0.5) return "insuficiente";
  let label: ScoreLabel = score >= 70 ? "alto" : score >= 40 ? "medio" : "bajo";
  if (missingCount > 0 && label === "alto") label = "medio";
  return label;
}

export function computeCaseScoreboard(input: ScoreboardInput, locale: Locale = "es"): ScoreboardResult {
  const en = locale === "en";
  const limitText = en ? LIMIT_TEXT_EN : LIMIT_TEXT_ES;
  const disclaimer = en ? SHORT_DISCLAIMER_EN : SHORT_DISCLAIMER;
  const { facts, retrieval, scope } = input;
  const criteria = retrieval.criteria;

  const base: ScoreboardResult = {
    computable: false,
    case_fit_score: null,
    score_label: "insuficiente",
    confidence_level: "bajo",
    favorable_factors: [],
    unfavorable_factors: [],
    uncertain_factors: [],
    missing_facts: facts.missing_facts ?? [],
    criteria_used: [],
    evidence_used: (facts.evidence_items ?? []).map((e) => `${e.filename} (${e.extraction_status})`),
    limits: [limitText],
    next_information_needed: facts.missing_facts ?? [],
    reason: null,
    disclaimer,
  };

  // Regla 1: sin criterios aprobados suficientes => NO se calcula score.
  if (retrieval.insufficient_criteria || criteria.length === 0) {
    return { ...base, reason: "No hay criterios aprobados suficientes en el corpus para esta materia; el score no se calcula." };
  }
  // Fuera de alcance o sin tema => no se calcula.
  if (scope.out_of_scope || scope.topic === null) {
    return { ...base, reason: "La consulta está fuera del alcance del corpus o sin tema determinado; el score no se calcula." };
  }
  // Defensa en profundidad (Reglas 5/13): solo criterios servibles. El retriever ya filtra isServable.
  if (!criteria.every((c) => c.review_status === "approved" && c.approved === true)) {
    return { ...base, reason: "Integridad: la recuperación contenía criterios no aprobados; por seguridad no se calcula." };
  }

  const present = facts.relevant_facts ?? [];
  const missing = facts.missing_facts ?? [];
  const total = present.length + missing.length;
  const coverage = total > 0 ? present.length / total : 0;

  const contradictions = (facts.uncertainties ?? []).filter((u) => /contradicc/i.test(u));
  const illegible =
    (facts.uncertainties ?? []).some((u) => /no se pudo leer|ilegible/i.test(u)) ||
    (facts.extraction_warnings ?? []).some((w) => /no configurado|ilegible|vac[íi]o/i.test(w));

  // Score 0-100 DETERMINISTA: cobertura de hechos − penalización por contradicción.
  let score = Math.round(coverage * 100) - 10 * contradictions.length;
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  // Favorables: cada hecho presente, alineado con un criterio (criterio+fuente) y su evidencia.
  const favorable_factors: ScoreFactor[] = present.map((rf, i) => {
    const c = criteria[i % criteria.length]!; // criteria.length > 0 garantizado arriba
    return {
      factor: `Hecho presente alineado con un criterio del corpus: ${rf.fact_text}`,
      criterion_id: c.id,
      source_reference: c.source_reference,
      judgment_id: c.judgment_id,
      resolution: readableCitation(c),
      evidence: `${rf.source_filename} (${rf.page_or_location})`,
    };
  });

  // Desfavorables: cuestiones que los criterios NO resuelven (cautela; no es mérito).
  const unfavorable_factors: ScoreFactor[] = [];
  for (const c of criteria) {
    for (const dn of c.does_not_answer) {
      unfavorable_factors.push({
        factor: `El corpus no resuelve este punto: ${dn}`,
        criterion_id: c.id,
        source_reference: c.source_reference,
        judgment_id: c.judgment_id,
        resolution: readableCitation(c),
        evidence: "—",
      });
    }
  }

  // Inciertos: datos ambiguos / contradicciones / documentos ilegibles.
  const uncertain_factors: UncertainFactor[] = (facts.uncertainties ?? []).map((u) => ({
    factor: u,
    why_it_matters: "Un dato ambiguo o contradictorio afecta a la alineación con los criterios del corpus.",
    what_is_missing: "Una aclaración o un documento legible que confirme el dato.",
  }));

  // Confianza (Regla 3).
  let confidence_level: ConfLabel = "alto";
  if (illegible || contradictions.length > 0) confidence_level = "bajo";
  else if ((facts.evidence_items ?? []).length === 0) confidence_level = "medio";

  const score_label = bandLabel(score, missing.length, total);

  const result: ScoreboardResult = {
    computable: true,
    case_fit_score: score,
    score_label,
    confidence_level,
    favorable_factors,
    unfavorable_factors,
    uncertain_factors,
    missing_facts: missing,
    criteria_used: criteria.map((c) => ({
      criterion_id: c.id,
      source_reference: c.source_reference,
      judgment_id: c.judgment_id,
      resolution: readableCitation(c),
    })),
    evidence_used: base.evidence_used.length ? base.evidence_used : ["consulta del usuario"],
    limits: [limitText, ...uniqueStrings(criteria.flatMap((c) => c.limits))],
    next_information_needed: missing,
    reason: null,
    disclaimer,
  };

  // GUARDARRAÍL Reglas 7-8 + 18: ningún texto puede contener pronóstico/probabilidad.
  const allText = [
    ...favorable_factors.map((f) => f.factor),
    ...unfavorable_factors.map((f) => f.factor),
    ...uncertain_factors.map((f) => `${f.factor} ${f.why_it_matters} ${f.what_is_missing}`),
    ...result.limits,
  ].join(" ");
  if (hasScoreboardForbiddenLanguage(allText)) {
    return { ...base, reason: "El contenido no superó la comprobación de seguridad (Regla 18); el score no se muestra." };
  }

  return result;
}

export interface RunScoreboardOptions {
  /** Materiales del caso (case_material) ya subidos para esta sesión. */
  files?: UploadedFile[];
  /** Corpus de criterios inyectable (tests); por defecto data/approved_criteria/. */
  corpus?: LegalCriterion[];
  /** Registro de resoluciones inyectable (tests). */
  judgmentsById?: ReadonlyMap<string, Judgment>;
  locale?: Locale;
}

/**
 * Orquesta el scoreboard: clasifica → extrae hechos (caseFactsExtractor) →
 * recupera criterios aprobados (criteriaRetriever) → computeCaseScoreboard.
 * Deny-by-default: cualquier fallo => no se calcula score.
 */
export function runCaseScoreboard(question: string, opts: RunScoreboardOptions = {}): ScoreboardResult {
  const locale = resolveLocale(opts.locale);
  try {
    const judgmentsById = opts.judgmentsById ?? loadJudgmentRegistry();
    const corpus = opts.corpus ?? loadApprovedCriteria();
    const norm = normalizeQuery(question, locale);
    const scope = classifyScope(norm.spanish);
    const facts = extractCaseFacts({ question: norm.spanish, files: opts.files ?? [] });
    const retrieval = retrieveApprovedCriteria(scope, corpus, new Set(judgmentsById.keys()));
    return computeCaseScoreboard({ question, scope, facts, retrieval }, locale);
  } catch {
    return {
      computable: false,
      case_fit_score: null,
      score_label: "insuficiente",
      confidence_level: "bajo",
      favorable_factors: [],
      unfavorable_factors: [],
      uncertain_factors: [],
      missing_facts: [],
      criteria_used: [],
      evidence_used: [],
      limits: [locale === "en" ? LIMIT_TEXT_EN : LIMIT_TEXT_ES],
      next_information_needed: [],
      reason: "Fallo técnico; el score no se calcula (deny-by-default).",
      disclaimer: locale === "en" ? SHORT_DISCLAIMER_EN : SHORT_DISCLAIMER,
    };
  }
}
