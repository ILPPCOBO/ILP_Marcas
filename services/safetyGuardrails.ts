/**
 * safetyGuardrails — Invariantes transversales (IMPLEMENTADO, F2).
 *
 * Última línea de defensa, INDEPENDIENTE de los demás módulos: revalida la
 * salida antes de servir y veta cualquier respuesta no conforme. Aunque cada
 * módulo ya aplique sus reglas, este guardarraíl vuelve a comprobarlas de forma
 * programática (no "porque el módulo lo dice").
 *
 * Invariantes verificados (CLAUDE.md):
 *   - I1. Todo criterio usado pasa isServable() (Regla 5).
 *   - I2. Toda cita corresponde 1:1 a un criterio usado y su resolución EXISTE
 *         en el corpus — citas imposibles de inventar (Reglas 4 y 9).
 *   - I3. El disclaimer informativo está presente (Reglas 11-12).
 *   - I4. La decisión es una de las CUATRO permitidas, coincide con la del motor
 *         y, si no es "answer", no hay criterios/fuentes (Regla 17).
 *   - I6. (lo garantiza el engine: toda interacción, también el rechazo seguro
 *         producido por un veto, se audita — Regla 16.)
 *
 * Si algún invariante falla => allowed:false con las violaciones; el engine
 * convierte la salida en un rechazo seguro AUDITADO. Nunca se sirve "porque casi
 * cumple".
 */
import type { AdvisorAnswer, Judgment, LegalCriterion } from "./models";
import type { DecisionResult } from "./types";
import { validateAdvisorAnswer, validateAnswerAgainstCriteria } from "./models";

export interface GuardrailContext {
  /** Criterios recuperados, por id (para I1/I2). */
  criteriaById: ReadonlyMap<string, LegalCriterion>;
  /** Registro de resoluciones del corpus, por id (para I2: existencia). */
  judgmentsById: ReadonlyMap<string, Judgment>;
}

export interface GuardrailVerdict {
  allowed: boolean;
  violations: string[];
}

export function checkGuardrails(
  decision: DecisionResult,
  answer: AdvisorAnswer,
  ctx: GuardrailContext,
): GuardrailVerdict {
  const violations: string[] = [];

  // I4 — coherencia decisión del motor ↔ decisión de la respuesta.
  if (answer.decision !== decision.decision) {
    violations.push(
      `I4: la respuesta dice "${answer.decision}" pero el motor decidió "${decision.decision}".`,
    );
  }

  // I3 + I4 (estructura) — el modelo F1 ya codifica: disclaimer no vacío,
  // decisión ∈ {4}, y vacíos de criterios/fuentes/confianza salvo "answer".
  for (const e of validateAdvisorAnswer(answer).errors) violations.push(`estructura: ${e}`);

  // I1 + I2 — solo aplica al fondo: criterios servibles, citas 1:1 y resolución
  // existente en el corpus.
  if (answer.decision === "answer") {
    const ctxErrors = validateAnswerAgainstCriteria(
      answer,
      ctx.criteriaById,
      ctx.judgmentsById,
    ).errors;
    for (const e of ctxErrors) violations.push(`corpus: ${e}`);
  }

  return { allowed: violations.length === 0, violations };
}
