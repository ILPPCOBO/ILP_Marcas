/**
 * services/ingestion — Flujo interno de ingesta y revisión (F4/F5).
 *
 * Pipeline editorial cerrado (CLAUDE.md Reglas 13-15):
 *   registerJudgment        → cataloga la resolución original (no servible)
 *   extractPendingCriteria  → extrae candidatos SELLADOS a pending_review
 *   listForReview           → muestra pendientes (con su resolución) al humano
 *   approveCriterion        → ÚNICA puerta a approved_criteria (humano + fuente)
 *   rejectCriterion / editCriterion
 *
 * Garantías: la extracción nunca escribe en approved; la aprobación exige
 * usuario + fuente verificable y queda registrada; el vínculo criterio →
 * resolución se conserva siempre.
 */
export * from "./types";
export * from "./judgmentLoader";
export * from "./extractor";
export * from "./review";
export { readReviewLog } from "./store";
