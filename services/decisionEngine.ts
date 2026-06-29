/**
 * decisionEngine — Paso 5 del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Decide, con lógica determinista y auditable, la única salida del sistema:
 * responder | repreguntar | rechazar (en sus dos formas constitucionales).
 * Aquí se materializa "El LLM nunca decide" (CLAUDE.md §6): es una cascada de
 * prioridades fija, sin modelo y sin red.
 *
 * CASCADA (el primer caso que aplica gana; el orden ES la política):
 *   Caso 1 — out_of_scope === true            => "out_of_scope"      (Regla 8)
 *   Caso 2 — needs_clarification === true     => "clarify"           (Regla 7)
 *   Caso 2b — clasificación ambigua (confidence "low" del clasificador)
 *             => "clarify" con plantilla fija (Reglas 7 y 17: la duda nunca
 *             resuelve hacia responder)
 *   Caso 3 — sin criterios aprobados suficientes => "insufficient_criteria"
 *             (Reglas 5 y 6). Incluye dos salvaguardas deny-by-default:
 *             lista vacía aunque el flag diga lo contrario, y presencia de
 *             cualquier criterio NO servible (violación de integridad aguas
 *             arriba => no se responde, Regla 17).
 *   Caso 4 — en alcance + sin datos faltantes + criterios aprobados => "answer"
 *
 * Reglas obligatorias del módulo:
 *   - El fondo NUNCA se responde si decision !== "answer" (el answerComposer
 *     solo se invoca con "answer"; safetyGuardrails lo veta además, I4).
 *   - "clarify" devuelve SOLO preguntas de aclaración (de plantillas fijas).
 *   - "out_of_scope" e "insufficient_criteria" llevan explicación honesta.
 *   - Toda decisión incluye reason (auditable, va al AuditLog, Regla 16).
 */
import type {
  DecisionResult,
  MissingFactsResult,
  RetrievalResult,
  ScopeResult,
} from "./types";
import { isServable } from "./models";

/** Plantilla fija para el caso de clasificación ambigua (Caso 2b). */
const AMBIGUITY_QUESTION =
  "Su consulta podría encajar en más de una materia del corpus. ¿Podría reformularla concretando el aspecto que más le interesa?";

export function decide(
  scope: ScopeResult,
  missingFacts: MissingFactsResult,
  retrieval: RetrievalResult,
): DecisionResult {
  // Caso 1 — fuera de alcance (Regla 8): se declara, nunca se rellena.
  if (scope.out_of_scope === true) {
    return {
      decision: "out_of_scope",
      reason: `El corpus de criterios aprobados no cubre la materia de esta consulta. ${scope.reason}`.trim(),
      clarifying_questions: [],
    };
  }

  // Caso 2 — faltan datos esenciales (Regla 7): repreguntar antes de responder.
  if (missingFacts.needs_clarification === true) {
    return {
      decision: "clarify",
      reason: "Faltan datos esenciales para aplicar los criterios del corpus.",
      clarifying_questions: [...missingFacts.clarifying_questions],
    };
  }

  // Caso 2b — clasificación ambigua: el clasificador marcó confidence "low"
  // (área casi empatada o señal mínima). La duda nunca resuelve hacia
  // responder (Regla 17): se repregunta con plantilla fija.
  if (scope.confidence === "low") {
    return {
      decision: "clarify",
      reason:
        "La clasificación de la consulta es ambigua entre materias del corpus; conviene concretarla antes de aplicar criterios.",
      clarifying_questions: [AMBIGUITY_QUESTION],
    };
  }

  // Caso 3 — sin criterios aprobados suficientes (Reglas 5 y 6).
  if (retrieval.insufficient_criteria === true || retrieval.criteria.length === 0) {
    return {
      decision: "insufficient_criteria",
      reason:
        "No hay criterios aprobados suficientes en la base de conocimiento para responder el fondo de esta consulta.",
      clarifying_questions: [],
    };
  }

  // Caso 3b — violación de integridad: si la recuperación contiene CUALQUIER
  // criterio no servible, algo falló aguas arriba; por seguridad no se
  // responde (Reglas 5 y 17 — deny-by-default ante estados imposibles).
  if (!retrieval.criteria.every((c) => isServable(c))) {
    return {
      decision: "insufficient_criteria",
      reason:
        "Integridad comprometida: la recuperación contiene criterios no servibles; por seguridad no se responde el fondo (Reglas 5 y 17).",
      clarifying_questions: [],
    };
  }

  // Caso 4 — todas las puertas superadas: se puede responder el fondo.
  return {
    decision: "answer",
    reason: `Consulta en alcance, sin datos esenciales pendientes y con ${retrieval.criteria.length} criterio(s) aprobado(s) aplicable(s).`,
    clarifying_questions: [],
  };
}

/**
 * Decisión del flujo de EVALUACIÓN DE CASO (Evaluador / Case Fit Grade). Es la
 * misma política deny-by-default que `decide`, pero su salida son las dos
 * decisiones propias de ese flujo:
 *   - "evaluate_case"        => hay alcance, hechos suficientes y criterios
 *                               aprobados: se puede CALIFICAR la alineación.
 *   - "cannot_evaluate_case" => fuera de alcance / faltan hechos esenciales /
 *                               sin criterios aprobados / integridad comprometida:
 *                               NO se califica (se explica por qué).
 *
 * NO predice resultado (Regla 18): "evaluate_case" habilita una CALIFICACIÓN DE
 * ALINEACIÓN con el corpus, jamás un pronóstico de victoria.
 */
export type CaseEvaluationDecision = "evaluate_case" | "cannot_evaluate_case";

export interface CaseEvaluationDecisionResult {
  decision: CaseEvaluationDecision;
  reason: string;
  clarifying_questions: string[];
}

export function decideCaseEvaluation(
  scope: ScopeResult,
  missingFacts: MissingFactsResult,
  retrieval: RetrievalResult,
): CaseEvaluationDecisionResult {
  // Reutiliza la cascada del Q&A; cualquier salida distinta de "answer" significa
  // que NO se puede calificar (deny-by-default), conservando su razón auditable.
  const base = decide(scope, missingFacts, retrieval);
  if (base.decision === "answer") {
    return {
      decision: "evaluate_case",
      reason: `Caso en alcance, con hechos suficientes y ${retrieval.criteria.length} criterio(s) aprobado(s): se puede calificar la alineación con el corpus (no es un pronóstico).`,
      clarifying_questions: [],
    };
  }
  return {
    decision: "cannot_evaluate_case",
    reason: base.reason,
    clarifying_questions: base.clarifying_questions,
  };
}
