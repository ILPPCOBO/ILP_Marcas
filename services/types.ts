/**
 * types.ts — Contratos del pipeline (tipos intermedios entre módulos).
 *
 * Los MODELOS DE DATOS canónicos (Judgment, LegalCriterion, UserQuery,
 * AdvisorAnswer, AuditLog) viven en ./models y se re-exportan desde aquí.
 * Este archivo solo añade los tipos de resultado intermedios que los módulos
 * del cerebro se pasan entre sí y que no se persisten como entidades.
 *
 * Invariantes constitucionales (CLAUDE.md):
 *   - Un criterio sin aprobar no es servible (Regla 5): la puerta es
 *     isServable() en ./models/legalCriterion.ts.
 *   - La decisión solo puede ser una de las cuatro de AnswerDecision —
 *     answer | clarify | out_of_scope | insufficient_criteria — donde las dos
 *     últimas son las formas del "rechazar" constitucional (Reglas 6, 8 y 17).
 *   - Toda respuesta lleva fuentes, límites y disclaimer (Reglas 9, 11, 12).
 */
export * from "./models";

import type { AnswerDecision, ConfidenceLevel, LegalCriterion } from "./models";

/** Áreas que el clasificador puede asignar (visibles, en castellano). */
export type ScopeArea =
  | "Marcas"
  | "Propiedad intelectual"
  | "Patentes"
  | "Procesal"
  | "Fuera de alcance";

/**
 * Resultado de la clasificación de alcance (pasos 1–2 del flujo).
 * El clasificador SOLO clasifica: nunca responde al usuario.
 */
export interface ScopeResult {
  area: ScopeArea;
  /** Tema dentro del área; null si no se reconoce tema (o fuera de alcance). */
  topic: string | null;
  /** Subtemas detectados dentro del tema; [] si ninguno. */
  subtopics: string[];
  out_of_scope: boolean;
  /** Certeza de la clasificación (no es un permiso: la puerta es el motor). */
  confidence: ConfidenceLevel;
  /** Justificación auditable basada en las coincidencias del léxico cerrado (Regla 16). */
  reason: string;
}

/** Resultado del detector de información faltante (paso 3). */
export interface MissingFactsResult {
  needs_clarification: boolean;
  /** Hechos esenciales NO mencionados por el usuario (lista cerrada por tema). */
  missing_facts: string[];
  /**
   * Preguntas de aclaración a formular al usuario (Regla 7). Salen de
   * plantillas fijas revisadas, nunca de generación libre; una por hecho
   * faltante, en el mismo orden que missing_facts.
   */
  clarifying_questions: string[];
}

/**
 * Consulta de recuperación (paso 4). Subconjunto estructural de ScopeResult:
 * un ScopeResult puede pasarse tal cual.
 */
export interface RetrievalQuery {
  area: ScopeArea;
  topic: string | null;
  subtopics: string[];
}

/** Resultado de la recuperación (paso 4). Solo criterios servibles (Regla 5). */
export interface RetrievalResult {
  /** Criterios completos (incluyen judgment_id/source_excerpt para las citas, Regla 9). */
  criteria: LegalCriterion[];
  /** true si no hay criterios aprobados suficientes (Regla 6). */
  insufficient_criteria: boolean;
}

/** Decisión del motor (paso 5), previa a componer la AdvisorAnswer. */
export interface DecisionResult {
  decision: AnswerDecision;
  /** Justificación honesta y auditable (va al AuditLog.decision_reason, Regla 16). */
  reason: string;
  /** Preguntas de aclaración: solo con decision "clarify"; [] en el resto. */
  clarifying_questions: string[];
}
