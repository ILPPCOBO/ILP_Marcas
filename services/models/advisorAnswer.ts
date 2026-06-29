/**
 * AdvisorAnswer — Respuesta producida por el sistema para una UserQuery.
 *
 * "Respuesta" incluye TODAS las salidas posibles del motor: respuesta de fondo,
 * repregunta y los dos tipos de rechazo. Son las únicas cuatro decisiones
 * representables (deny-by-default: no existe "respuesta parcial improvisada").
 *
 *   - "answer"                respuesta de fondo con criterios aprobados
 *   - "clarify"               repregunta (Regla 7)
 *   - "out_of_scope"          rechazo por estar fuera del corpus (Regla 8)
 *   - "insufficient_criteria" rechazo por falta de criterios aprobados (Regla 6)
 *
 * (out_of_scope e insufficient_criteria son las dos formas del "rechazar"
 * constitucional, CLAUDE.md §4 paso 5.)
 *
 * Reglas de CLAUDE.md que afectan a esta entidad:
 *   - Reglas 4 y 9: sources_used se ensambla desde metadatos de los criterios
 *     usados — cada fuente referencia el par criterio → resolución, y la
 *     resolución debe EXISTIR en el corpus (validateAnswerAgainstCriteria).
 *   - Reglas 11–12: disclaimer SIEMPRE presente, en todas las decisiones.
 *     (Campo añadido sobre la lista sugerida: la constitución lo exige.)
 *   - Regla 16: query_id enlaza la respuesta con su pregunta y su AuditLog
 *     (coherencia entre entidades: ver ./interaction.ts).
 *
 * Espejo JSON Schema: data/schemas/advisor_answer.schema.json
 */
import {
  CONFIDENCE_LEVELS,
  ConfidenceLevel,
  LegalCriterion,
  isServable,
} from "./legalCriterion";
import { Judgment } from "./judgment";
import {
  ValidationResult,
  fail,
  hasUniqueStrings,
  isArrayOfNonEmptyStrings,
  isIsoDateTime,
  isNonEmptyString,
  ok,
  unknownKeys,
} from "./validation";

export type AnswerDecision = "answer" | "clarify" | "out_of_scope" | "insufficient_criteria";

export const ANSWER_DECISIONS: readonly AnswerDecision[] = [
  "answer",
  "clarify",
  "out_of_scope",
  "insufficient_criteria",
] as const;

/** Cita trazable: par criterio → resolución de origen (Regla 9). */
export interface SourceUsed {
  criterion_id: string;
  judgment_id: string;
}

export interface AdvisorAnswer {
  id: string;
  /** UserQuery a la que responde (trazabilidad, Regla 16). */
  query_id: string;
  decision: AnswerDecision;
  /**
   * Texto mostrado al usuario. Según la decisión:
   *  - answer: la respuesta de fondo (estructura fija de CLAUDE.md §4 paso 6)
   *  - clarify: las preguntas de aclaración
   *  - out_of_scope / insufficient_criteria: la explicación honesta del rechazo
   */
  answer_text: string;
  /** IDs de LegalCriterion usados, sin duplicados. VACÍO salvo decision === "answer". */
  criteria_used: string[];
  /** Citas criterio → resolución. VACÍO salvo decision === "answer". */
  sources_used: SourceUsed[];
  /** Límites declarados de la respuesta. */
  limits: string;
  /** Confianza global; null cuando no hay respuesta de fondo. */
  confidence_level: ConfidenceLevel | null;
  /** Recordatorio de orientación informativa. SIEMPRE no vacío (Reglas 11–12). */
  disclaimer: string;
  created_at: string;
}

const ANSWER_KEYS: readonly string[] = [
  "id",
  "query_id",
  "decision",
  "answer_text",
  "criteria_used",
  "sources_used",
  "limits",
  "confidence_level",
  "disclaimer",
  "created_at",
] as const;

function isSourceUsed(s: unknown): s is SourceUsed {
  return (
    typeof s === "object" &&
    s !== null &&
    isNonEmptyString((s as SourceUsed).criterion_id) &&
    isNonEmptyString((s as SourceUsed).judgment_id) &&
    unknownKeys(s, ["criterion_id", "judgment_id"]).length === 0
  );
}

export function validateAdvisorAnswer(a: AdvisorAnswer): ValidationResult {
  const errors: string[] = [];

  if (typeof a !== "object" || a === null) return fail(["AdvisorAnswer: debe ser un objeto"]);
  for (const k of unknownKeys(a, ANSWER_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(a.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(a.query_id)) errors.push("query_id: requerido (Regla 16)");
  if (!ANSWER_DECISIONS.includes(a.decision))
    errors.push(`decision: debe ser una de ${ANSWER_DECISIONS.join(" | ")}`);
  if (!isNonEmptyString(a.answer_text)) errors.push("answer_text: requerido y no vacío");
  if (!isNonEmptyString(a.limits)) errors.push("limits: requerido y no vacío");
  if (a.confidence_level !== null && !CONFIDENCE_LEVELS.includes(a.confidence_level))
    errors.push(`confidence_level: null o uno de ${CONFIDENCE_LEVELS.join(" | ")}`);
  if (!isNonEmptyString(a.disclaimer))
    errors.push("disclaimer: SIEMPRE requerido y no vacío (Reglas 11-12)");
  if (!isIsoDateTime(a.created_at)) errors.push("created_at: instante ISO 8601 requerido");

  // Guardas de forma de los arrays. Si no tienen la forma esperada, se corta
  // aquí: el validador DEVUELVE inválido, nunca lanza (deny-by-default, no crash).
  const criteriaOk = isArrayOfNonEmptyStrings(a.criteria_used);
  if (!criteriaOk) errors.push("criteria_used: array de IDs no vacíos");
  else if (!hasUniqueStrings(a.criteria_used)) errors.push("criteria_used: sin duplicados");

  const sourcesOk = Array.isArray(a.sources_used) && a.sources_used.every(isSourceUsed);
  if (!sourcesOk) errors.push("sources_used: array de {criterion_id, judgment_id} no vacíos");
  else if (!hasUniqueStrings(a.sources_used.map((s) => s.criterion_id)))
    errors.push("sources_used: sin citas duplicadas del mismo criterio");

  if (!criteriaOk || !sourcesOk) return fail(errors);

  // VALIDACIONES CONSTITUCIONALES sobre la decisión.
  if (a.decision === "answer") {
    // "Una respuesta no puede tener decision: answer si criteria_used está vacío."
    if (a.criteria_used.length === 0)
      errors.push("criteria_used: no puede estar vacío con decision \"answer\" (Reglas 1 y 5)");
    // "Toda respuesta con decision: answer debe tener sources_used."
    if (a.sources_used.length === 0)
      errors.push("sources_used: requerido con decision \"answer\" (Reglas 4 y 9)");
    // Cada cita debe corresponder a un criterio efectivamente usado (Regla 4:
    // imposibilidad estructural de citas sin origen).
    const used = new Set(a.criteria_used);
    for (const s of a.sources_used) {
      if (!used.has(s.criterion_id))
        errors.push(`sources_used: cita de criterio no usado "${s.criterion_id}" (Regla 4)`);
    }
    // Y cada criterio usado debe estar citado (Regla 9: trazabilidad completa).
    const cited = new Set(a.sources_used.map((s) => s.criterion_id));
    for (const id of a.criteria_used) {
      if (!cited.has(id))
        errors.push(`criteria_used: criterio "${id}" usado sin cita en sources_used (Regla 9)`);
    }
    if (a.confidence_level === null)
      errors.push("confidence_level: requerido cuando decision es \"answer\"");
  } else if (ANSWER_DECISIONS.includes(a.decision)) {
    // Repreguntas y rechazos NO usan criterios: si los hubiera, sería una
    // respuesta de fondo encubierta (Regla 17).
    if (a.criteria_used.length > 0)
      errors.push(`criteria_used: debe estar vacío con decision "${a.decision}" (Regla 17)`);
    if (a.sources_used.length > 0)
      errors.push(`sources_used: debe estar vacío con decision "${a.decision}" (Regla 17)`);
    if (a.confidence_level !== null)
      errors.push("confidence_level: debe ser null si no hay respuesta de fondo");
  }

  return errors.length ? fail(errors) : ok();
}

/**
 * Validación con contexto (la que debe usar el pipeline antes de servir):
 * comprueba, además de validateAdvisorAnswer, que cada criterio usado existe y
 * es SERVIBLE — "un criterio pending_review no puede ser usado para responder"
 * (Reglas 5 y 14) — y que cada resolución citada EXISTE en el corpus (Reglas 4
 * y 9: una cita a una resolución inexistente es una cita fabricada).
 * Deny-by-default: criterio o resolución no encontrados => inválido.
 */
export function validateAnswerAgainstCriteria(
  a: AdvisorAnswer,
  criteriaById: ReadonlyMap<string, LegalCriterion>,
  judgmentsById: ReadonlyMap<string, Judgment>,
): ValidationResult {
  const base = validateAdvisorAnswer(a);
  if (!Array.isArray(a.criteria_used) || !Array.isArray(a.sources_used)) return base;
  const errors = [...base.errors];

  for (const id of a.criteria_used) {
    const c = criteriaById.get(id);
    if (!c) {
      errors.push(`criteria_used: criterio "${id}" no existe en la base de conocimiento (Regla 1)`);
    } else {
      if (!isServable(c))
        errors.push(
          `criteria_used: criterio "${id}" NO es servible (review_status="${c.review_status}") — ` +
            "solo criterios aprobados pueden usarse (Reglas 5 y 14)",
        );
      if (!judgmentsById.has(c.judgment_id))
        errors.push(
          `criteria_used: el criterio "${id}" cita la resolución "${c.judgment_id}", ` +
            "que no existe en el corpus (Reglas 4 y 9)",
        );
    }
  }
  for (const s of a.sources_used) {
    if (!isSourceUsed(s)) continue; // ya reportado por la validación base
    const c = criteriaById.get(s.criterion_id);
    if (c && c.judgment_id !== s.judgment_id)
      errors.push(
        `sources_used: la cita de "${s.criterion_id}" apunta a judgment "${s.judgment_id}" ` +
          `pero el criterio procede de "${c.judgment_id}" (Regla 4: citas solo desde metadatos)`,
      );
    if (!judgmentsById.has(s.judgment_id))
      errors.push(
        `sources_used: la resolución citada "${s.judgment_id}" no existe en el corpus (Reglas 4 y 9)`,
      );
  }

  return errors.length ? fail(errors) : ok();
}
