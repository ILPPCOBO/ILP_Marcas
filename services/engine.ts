/**
 * engine — Orquestador del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Encadena los módulos del cerebro en el ÚNICO orden permitido (CLAUDE.md §4),
 * aplica el veto final de safetyGuardrails y produce, para CADA consulta, una
 * AdvisorAnswer trazable más su AuditLog.
 *
 *   classifyScope → detectMissingFacts → retrieveApprovedCriteria
 *     → decide → composeAnswer → checkGuardrails → buildAuditRecord (+log)
 *
 * Invariantes:
 *   - No existe ninguna rama que sirva fondo sin pasar por decide() Y por el veto
 *     de safetyGuardrails.
 *   - TODA interacción se audita (Regla 16), también el rechazo seguro producido
 *     por un veto o por una excepción: el registro nunca se omite.
 *   - Ids/timestamps se INYECTAN (RunContext); el motor no los inventa.
 *   - Deny-by-default (Regla 17): cualquier fallo o veto => rechazo seguro
 *     auditado (insufficient_criteria), nunca una respuesta de fondo dudosa.
 */
import type { AdvisorAnswer, AuditLog, Judgment, LegalCriterion } from "./models";
import type {
  DecisionResult,
  MissingFactsResult,
  RetrievalResult,
  ScopeResult,
} from "./types";
import { classifyScope } from "./scopeClassifier";
import { detectMissingFacts } from "./missingFactsDetector";
import { retrieveApprovedCriteria } from "./criteriaRetriever";
import { decide } from "./decisionEngine";
import { composeAnswer } from "./answerComposer";
import { checkGuardrails } from "./safetyGuardrails";
import { AuditLogger, buildAuditRecord } from "./auditLogger";
import { loadJudgmentRegistry } from "./judgmentRegistry";
import type { Locale } from "./i18n";
import { normalizeQuery, resolveLocale } from "./i18n";

export interface RunContext {
  query_id: string;
  answer_id: string;
  audit_id: string;
  created_at: string; // ISO 8601
}

export interface RunOptions {
  /** Corpus de criterios inyectable (tests); por defecto data/approved_criteria/. */
  corpus?: LegalCriterion[];
  /** Registro de resoluciones inyectable (tests); por defecto data/source_judgments/. */
  judgmentsById?: ReadonlyMap<string, Judgment>;
  /** Sumidero de auditoría; si se da, se registra la interacción. */
  logger?: AuditLogger;
  /** Idioma de PRESENTACIÓN (por defecto "es"). El razonamiento es español. */
  locale?: Locale;
}

export interface RunResult {
  scope: ScopeResult;
  missingFacts: MissingFactsResult;
  retrieval: RetrievalResult;
  decision: DecisionResult;
  answer: AdvisorAnswer;
  audit: AuditLog;
}

/** Scope mínimo para construir un rechazo seguro cuando algo falla muy pronto. */
const FALLBACK_SCOPE: ScopeResult = {
  area: "Fuera de alcance",
  topic: null,
  subtopics: [],
  out_of_scope: false,
  confidence: "low",
  reason: "rechazo seguro por fallo técnico",
};

const REASON_SAFE =
  "Rechazo seguro: la respuesta no superó las comprobaciones de seguridad o se produjo un " +
  "fallo técnico; por diseño no se ofrece orientación de fondo (Reglas 16 y 17).";

/** AdvisorAnswer mínima codificada a mano (no usa composeAnswer; no puede lanzar). */
function hardcodedRefusalAnswer(ctx: RunContext): AdvisorAnswer {
  return {
    id: ctx.answer_id,
    query_id: ctx.query_id,
    decision: "insufficient_criteria",
    answer_text:
      "No es posible ofrecer orientación de fondo por un problema técnico; por seguridad se " +
      "rechaza la consulta. Esto es solo orientación informativa basada en un corpus cerrado y " +
      "no constituye asesoramiento jurídico.",
    criteria_used: [],
    sources_used: [],
    limits: "No se ha analizado el fondo por un fallo técnico.",
    confidence_level: null,
    disclaimer:
      "Esta respuesta es únicamente orientación informativa basada en un corpus cerrado y no " +
      "constituye asesoramiento jurídico. Para un caso concreto, consulte a un profesional.",
    created_at: ctx.created_at,
  };
}

/** AuditLog mínimo codificado a mano (no usa buildAuditRecord; no puede lanzar). */
function hardcodedAudit(ctx: RunContext, safety_flags: string[]): AuditLog {
  const flags = [...new Set(safety_flags.length ? safety_flags : ["internal_error"])];
  return {
    id: ctx.audit_id,
    query_id: ctx.query_id,
    answer_id: ctx.answer_id,
    retrieved_criteria_ids: [],
    rejected_criteria_ids: [],
    decision_reason: REASON_SAFE,
    safety_flags: flags,
    created_at: ctx.created_at,
  };
}

/**
 * Construye y registra un rechazo seguro AUDITADO (insufficient_criteria). NUNCA
 * lanza: si componer/auditar fallara, recurre a literales codificados a mano y
 * registra en best-effort, garantizando que toda interacción deja traza
 * (Regla 16) incluso ante un fallo del sumidero de auditoría.
 */
function safeRefusal(
  question: string,
  scope: ScopeResult,
  retrieval: RetrievalResult,
  ctx: RunContext,
  opts: RunOptions,
  safety_flags: string[],
  translationUncertain: boolean,
): RunResult {
  const decision: DecisionResult = {
    decision: "insufficient_criteria",
    reason: REASON_SAFE,
    clarifying_questions: [],
  };

  let answer: AdvisorAnswer;
  let audit: AuditLog;
  try {
    answer = composeAnswer(
      {
        question,
        scope,
        decision,
        criteria: [],
        locale: resolveLocale(opts.locale),
        translation_uncertain: translationUncertain,
      },
      { id: ctx.answer_id, query_id: ctx.query_id, created_at: ctx.created_at },
    );
    audit = buildAuditRecord({
      audit_id: ctx.audit_id,
      query_id: ctx.query_id,
      answer,
      retrieval,
      decision,
      safety_flags,
      created_at: ctx.created_at,
    });
  } catch {
    // Si componer/auditar el rechazo también falla, se usan literales seguros.
    answer = hardcodedRefusalAnswer(ctx);
    audit = hardcodedAudit(ctx, safety_flags);
  }

  // El registro es best-effort: un sumidero que lance (p. ej. JSONL sin disco)
  // no puede tumbar la interacción ni dejarla sin la traza ya construida.
  try {
    opts.logger?.log(audit);
  } catch {
    /* la traza queda en `audit`; el fallo de persistencia no propaga */
  }

  return {
    scope,
    missingFacts: { needs_clarification: false, missing_facts: [], clarifying_questions: [] },
    retrieval,
    decision,
    answer,
    audit,
  };
}

export function runQuery(question: string, ctx: RunContext, opts: RunOptions = {}): RunResult {
  const judgmentsById = opts.judgmentsById ?? loadJudgmentRegistry();
  const locale = resolveLocale(opts.locale);
  // Normalización determinista (segura): se calcula antes del try para que el
  // aviso de duda (Regla 6) se conserve también en el rechazo seguro.
  const norm = normalizeQuery(question, locale);

  let scope: ScopeResult = FALLBACK_SCOPE;
  let retrieval: RetrievalResult = { criteria: [], insufficient_criteria: true };

  try {
    // El razonamiento ocurre SIEMPRE en español: si la consulta es en inglés, se
    // normaliza al español (glosario cerrado) para clasificar y detectar; el
    // texto original no se reinterpreta.
    scope = classifyScope(norm.spanish);
    const missingFacts = detectMissingFacts(norm.spanish, scope);
    // Defensa en profundidad: el retriever también exige que la resolución del
    // criterio exista en el registro (Regla 9), no solo el veto de la rama answer.
    retrieval = retrieveApprovedCriteria(scope, opts.corpus, new Set(judgmentsById.keys()));
    const decision = decide(scope, missingFacts, retrieval);

    const answer = composeAnswer(
      {
        question,
        scope,
        decision,
        criteria: retrieval.criteria,
        locale,
        translation_uncertain: norm.uncertain,
      },
      { id: ctx.answer_id, query_id: ctx.query_id, created_at: ctx.created_at },
    );

    // VETO FINAL (safetyGuardrails): revalida la salida contra el corpus.
    const criteriaById = new Map<string, LegalCriterion>(retrieval.criteria.map((c) => [c.id, c]));
    const verdict = checkGuardrails(decision, answer, { criteriaById, judgmentsById });
    if (!verdict.allowed) {
      return safeRefusal(question, scope, retrieval, ctx, opts, verdict.violations, norm.uncertain);
    }

    // Regla 16: toda interacción se registra (también repreguntas y rechazos).
    const audit = buildAuditRecord({
      audit_id: ctx.audit_id,
      query_id: ctx.query_id,
      answer,
      retrieval,
      decision,
      safety_flags: [],
      created_at: ctx.created_at,
    });
    opts.logger?.log(audit);

    return { scope, missingFacts, retrieval, decision, answer, audit };
  } catch {
    // Cualquier excepción (criterio con texto problemático, etc.) => rechazo
    // seguro AUDITADO. La interacción nunca queda sin traza (Regla 16).
    return safeRefusal(question, scope, retrieval, ctx, opts, ["internal_error"], norm.uncertain);
  }
}
