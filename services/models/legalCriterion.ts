/**
 * LegalCriterion — Criterio jurídico estructurado, extraído de una Judgment.
 *
 * Es la UNIDAD DE CONOCIMIENTO del sistema: el motor responde con criterios,
 * nunca con sentencias crudas (Regla 13).
 *
 * Estado de aprobación — decisión de diseño:
 *   El estado canónico es `review_status`. El flag `approved` existe en el
 *   esquema (es la forma literal "approved: true" de la constitución, Regla 5)
 *   pero es REDUNDANTE POR DISEÑO y debe coincidir SIEMPRE con
 *   `review_status === "approved"`. La validación rechaza cualquier
 *   incoherencia, y la puerta de servibilidad (isServable) exige que AMBOS
 *   campos coincidan en "aprobado" — si discrepan, el criterio NO es servible
 *   (deny-by-default, Regla 17). En la futura base de datos, `approved` debe
 *   ser columna generada/derivada o tener una CHECK constraint de coherencia.
 *
 * Reglas de CLAUDE.md que afectan a esta entidad:
 *   - Regla 5: solo criterios aprobados son servibles.
 *   - Regla 9: trazabilidad criterio → resolución (judgment_id, source_excerpt,
 *     source_reference son obligatorios; sin fuente verificable no hay criterio).
 *   - Regla 14: extracción automática => review_status "pending_review".
 *   - Regla 15: solo un humano aprueba => approved_by / approved_at obligatorios
 *     al aprobar.
 *
 * Espejo JSON Schema: data/schemas/legal_criterion.schema.json
 */
import { Judgment, LEGAL_AREAS, LegalArea } from "./judgment";
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

export type ReviewStatus = "pending_review" | "approved" | "rejected";

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending_review",
  "approved",
  "rejected",
] as const;

/** Confianza declarada por el proceso de EXTRACCIÓN (no sustituye la revisión humana). */
export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["high", "medium", "low"] as const;

export interface LegalCriterion {
  id: string;
  /** Judgment de la que se extrajo el criterio (trazabilidad, Regla 9). */
  judgment_id: string;
  area: LegalArea;
  topic: string;
  subtopic: string | null;
  /** Enunciado del criterio en lenguaje claro y neutro. */
  criterion_text: string;
  /** Condiciones bajo las que el criterio es aplicable. */
  conditions_for_application: string[];
  /** Qué NO responde este criterio (anti-sobreextensión, Reglas 8 y 10). */
  does_not_answer: string[];
  /** Límites del criterio (matices, excepciones, alcance temporal). */
  limits: string[];
  /** Extracto VERBATIM de la resolución que sustenta el criterio. */
  source_excerpt: string;
  /** Localización dentro de la resolución (p. ej. "Fundamento Jurídico 3º"). */
  source_reference: string;
  confidence_level: ConfidenceLevel;
  /** Estado canónico del ciclo editorial (CLAUDE.md §5). */
  review_status: ReviewStatus;
  /** Flag redundante por diseño: DEBE coincidir con review_status === "approved". */
  approved: boolean;
  /** Revisor humano que aprobó (Regla 15). null si no está aprobado. */
  approved_by: string | null;
  /** Instante de la aprobación. null si no está aprobado. */
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Puerta de servibilidad (Regla 5): la ÚNICA forma legítima de decidir si un
 * criterio puede usarse para responder. Exige coherencia total del estado de
 * aprobación; cualquier discrepancia => NO servible (Regla 17).
 */
export function isServable(c: LegalCriterion): boolean {
  return (
    c.review_status === "approved" &&
    c.approved === true &&
    isNonEmptyString(c.approved_by) &&
    isIsoDateTime(c.approved_at) &&
    validateLegalCriterion(c).valid
  );
}

const CRITERION_KEYS: readonly string[] = [
  "id",
  "judgment_id",
  "area",
  "topic",
  "subtopic",
  "criterion_text",
  "conditions_for_application",
  "does_not_answer",
  "limits",
  "source_excerpt",
  "source_reference",
  "confidence_level",
  "review_status",
  "approved",
  "approved_by",
  "approved_at",
  "created_at",
  "updated_at",
] as const;

export function validateLegalCriterion(c: LegalCriterion): ValidationResult {
  const errors: string[] = [];

  if (typeof c !== "object" || c === null) return fail(["LegalCriterion: debe ser un objeto"]);
  for (const k of unknownKeys(c, CRITERION_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(c.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(c.judgment_id))
    errors.push("judgment_id: requerido — un criterio sin resolución de origen no existe (Regla 9)");
  if (!LEGAL_AREAS.includes(c.area)) errors.push(`area: debe ser una de ${LEGAL_AREAS.join(" | ")}`);
  if (!isNonEmptyString(c.topic)) errors.push("topic: requerido y no vacío");
  if (c.subtopic !== null && !isNonEmptyString(c.subtopic))
    errors.push("subtopic: null o string no vacío");
  if (!isNonEmptyString(c.criterion_text)) errors.push("criterion_text: requerido y no vacío");
  if (!isArrayOfNonEmptyStrings(c.conditions_for_application))
    errors.push("conditions_for_application: array de strings no vacíos");
  else if (!hasUniqueStrings(c.conditions_for_application))
    errors.push("conditions_for_application: sin duplicados");
  if (!isArrayOfNonEmptyStrings(c.does_not_answer))
    errors.push("does_not_answer: array de strings no vacíos");
  else if (!hasUniqueStrings(c.does_not_answer)) errors.push("does_not_answer: sin duplicados");
  if (!isArrayOfNonEmptyStrings(c.limits)) errors.push("limits: array de strings no vacíos");
  else if (!hasUniqueStrings(c.limits)) errors.push("limits: sin duplicados");
  if (!isNonEmptyString(c.source_excerpt))
    errors.push("source_excerpt: requerido — sin extracto verbatim no hay verificabilidad (Regla 9)");
  if (!isNonEmptyString(c.source_reference))
    errors.push("source_reference: requerido — localización dentro de la resolución (Regla 9)");
  if (!CONFIDENCE_LEVELS.includes(c.confidence_level))
    errors.push(`confidence_level: debe ser uno de ${CONFIDENCE_LEVELS.join(" | ")}`);
  if (!REVIEW_STATUSES.includes(c.review_status))
    errors.push(`review_status: debe ser uno de ${REVIEW_STATUSES.join(" | ")}`);
  if (!isIsoDateTime(c.created_at)) errors.push("created_at: instante ISO 8601 requerido");
  if (!isIsoDateTime(c.updated_at)) errors.push("updated_at: instante ISO 8601 requerido");

  // VALIDACIÓN CONSTITUCIONAL: coherencia del estado de aprobación.
  // "Un criterio no puede tener approved: true si review_status no es 'approved'"
  // — y la inversa también: un estado a medias es un estado inválido (Regla 17).
  if (typeof c.approved !== "boolean") {
    errors.push("approved: debe ser boolean");
  } else if (c.approved !== (c.review_status === "approved")) {
    errors.push(
      `approved: incoherente — approved=${c.approved} con review_status="${c.review_status}" ` +
        "(approved debe equivaler a review_status === \"approved\"; Reglas 5 y 14)",
    );
  }

  // Regla 15: aprobar es un acto humano registrado.
  if (c.review_status === "approved") {
    if (!isNonEmptyString(c.approved_by))
      errors.push("approved_by: obligatorio cuando review_status es \"approved\" (Regla 15)");
    if (!isIsoDateTime(c.approved_at))
      errors.push("approved_at: obligatorio (ISO 8601) cuando review_status es \"approved\" (Regla 15)");
  } else {
    if (c.approved_by !== null)
      errors.push("approved_by: debe ser null si el criterio no está aprobado");
    if (c.approved_at !== null)
      errors.push("approved_at: debe ser null si el criterio no está aprobado");
  }

  return errors.length ? fail(errors) : ok();
}

/**
 * Validación con contexto: el judgment_id del criterio debe corresponder a una
 * Judgment REAL del corpus. Es la comprobación que la puerta de aprobación
 * (admin/, Regla 15) debe ejecutar antes de aprobar — un criterio que cita una
 * resolución inexistente sería una cita fabricada servible (Reglas 4 y 9).
 * Deny-by-default: judgment no encontrada => inválido.
 */
export function validateCriterionAgainstJudgments(
  c: LegalCriterion,
  judgmentsById: ReadonlyMap<string, Judgment>,
): ValidationResult {
  const base = validateLegalCriterion(c);
  const errors = [...base.errors];

  if (isNonEmptyString(c.judgment_id) && !judgmentsById.has(c.judgment_id))
    errors.push(
      `judgment_id: la resolución "${c.judgment_id}" no existe en el corpus — ` +
        "sin resolución de origen real no hay criterio (Reglas 4 y 9)",
    );

  return errors.length ? fail(errors) : ok();
}
