/**
 * CatalogQuestion — Pregunta estándar del catálogo (modo de respuestas
 * PREAPROBADAS, sin generación libre).
 *
 * A diferencia del modo asistido, aquí la respuesta NO se compone en tiempo de
 * consulta: es texto fijo, revisado y aprobado por un humano, conectado a
 * criterios aprobados del corpus.
 *
 * Reglas que codifica esta entidad (las del propietario + CLAUDE.md):
 *   - Regla 1 (catálogo): solo se muestran preguntas con approved: true.
 *   - Regla 2: cada respuesta estándar está conectada a criterios APROBADOS
 *     (related_criteria_ids no vacío y verificado contra el corpus al servir).
 *   - Regla 3: no hay respuesta estándar sin source_references.
 *   - Regla 4: incluye límites; el aviso de no asesoramiento se añade al servir.
 *   - Regla 5 / Regla 3 constitucional: aprobar es un acto humano registrado
 *     (last_reviewed_by + last_reviewed_at).
 *
 * `area`/`topic` son nombres VISIBLES de un vocabulario CERRADO de categorías
 * (data/catalog/categories.json). La validación comprueba la pertenencia.
 *
 * Espejo JSON Schema: data/schemas/catalog_question.schema.json
 */
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

/** Vocabulario cerrado de categorías del catálogo. */
export interface CatalogCategories {
  areas: Array<{ area: string; topics: string[] }>;
}

export interface CatalogQuestion {
  id: string;
  /** Área visible; debe pertenecer a las categorías del catálogo. */
  area: string;
  /** Tema visible; debe pertenecer a los temas de su área. */
  topic: string;
  question: string;
  short_answer: string;
  full_answer: string;
  /** IDs de criterios APROBADOS que respaldan la respuesta (Regla 2). */
  related_criteria_ids: string[];
  /** Citas a resoluciones/fuentes (Regla 3). */
  source_references: string[];
  /** Límites de la respuesta (Regla 4). */
  limits: string[];
  /** Solo las aprobadas se muestran (Regla 1). */
  approved: boolean;
  /** Versión editorial (p. ej. "1.0.0"). */
  version: string;
  /** Instante de la última revisión/aprobación humana (Regla 3). */
  last_reviewed_at: string | null;
  /** Revisor/admin de la última revisión/aprobación humana (Regla 3). */
  last_reviewed_by: string | null;
}

const CATALOG_KEYS: readonly string[] = [
  "id",
  "area",
  "topic",
  "question",
  "short_answer",
  "full_answer",
  "related_criteria_ids",
  "source_references",
  "limits",
  "approved",
  "version",
  "last_reviewed_at",
  "last_reviewed_by",
] as const;

/** ¿(area, topic) pertenecen al vocabulario cerrado de categorías? */
export function isKnownCategory(
  area: string,
  topic: string,
  categories: CatalogCategories,
): boolean {
  const a = categories.areas.find((x) => x.area === area);
  return a ? a.topics.includes(topic) : false;
}

export function validateCatalogQuestion(
  q: CatalogQuestion,
  categories: CatalogCategories,
): ValidationResult {
  const errors: string[] = [];
  if (typeof q !== "object" || q === null) return fail(["CatalogQuestion: debe ser un objeto"]);
  for (const k of unknownKeys(q, CATALOG_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(q.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(q.area)) errors.push("area: requerida y no vacía");
  if (!isNonEmptyString(q.topic)) errors.push("topic: requerido y no vacío");
  if (isNonEmptyString(q.area) && isNonEmptyString(q.topic) && !isKnownCategory(q.area, q.topic, categories))
    errors.push(`area/topic "${q.area}/${q.topic}" no pertenece al vocabulario de categorías`);
  if (!isNonEmptyString(q.question)) errors.push("question: requerida y no vacía");
  // short_answer/full_answer pueden estar vacíos en un BORRADOR; son obligatorios
  // al aprobar (ver bloque "approved" más abajo).
  if (typeof q.short_answer !== "string") errors.push("short_answer: debe ser string");
  if (typeof q.full_answer !== "string") errors.push("full_answer: debe ser string");

  if (!Array.isArray(q.related_criteria_ids) || !q.related_criteria_ids.every((x) => isNonEmptyString(x)))
    errors.push("related_criteria_ids: array de IDs no vacíos");
  else if (!hasUniqueStrings(q.related_criteria_ids)) errors.push("related_criteria_ids: sin duplicados");

  if (!isArrayOfNonEmptyStrings(q.source_references))
    errors.push("source_references: array de strings no vacíos");
  else if (!hasUniqueStrings(q.source_references)) errors.push("source_references: sin duplicados");

  if (!isArrayOfNonEmptyStrings(q.limits)) errors.push("limits: array de strings no vacíos");
  else if (!hasUniqueStrings(q.limits)) errors.push("limits: sin duplicados");

  if (typeof q.approved !== "boolean") errors.push("approved: debe ser boolean");
  if (!isNonEmptyString(q.version)) errors.push("version: requerida y no vacía");

  // Aprobada => contenido + respaldo + fuentes + límites + acto humano registrado.
  if (q.approved === true) {
    if (!isNonEmptyString(q.short_answer)) errors.push("short_answer: no vacía si approved");
    if (!isNonEmptyString(q.full_answer)) errors.push("full_answer: no vacía si approved");
    if (!Array.isArray(q.related_criteria_ids) || q.related_criteria_ids.length === 0)
      errors.push("related_criteria_ids: no vacío si approved (Regla 2)");
    if (!Array.isArray(q.source_references) || q.source_references.length === 0)
      errors.push("source_references: no vacío si approved (Regla 3)");
    if (!Array.isArray(q.limits) || q.limits.length === 0)
      errors.push("limits: no vacío si approved (Regla 4)");
    if (!isIsoDateTime(q.last_reviewed_at))
      errors.push("last_reviewed_at: ISO 8601 requerido si approved (Regla 3)");
    if (!isNonEmptyString(q.last_reviewed_by))
      errors.push("last_reviewed_by: requerido si approved (Regla 3)");
  } else {
    if (q.last_reviewed_at !== null && !isIsoDateTime(q.last_reviewed_at))
      errors.push("last_reviewed_at: null o ISO 8601");
    if (q.last_reviewed_by !== null && !isNonEmptyString(q.last_reviewed_by))
      errors.push("last_reviewed_by: null o string no vacío");
  }

  return errors.length ? fail(errors) : ok();
}

/**
 * Puerta de SERVIBILIDAD del catálogo (Reglas 1-4): la ÚNICA forma legítima de
 * decidir si una pregunta puede mostrarse al usuario. Exige aprobación + que sus
 * criterios relacionados estén realmente APROBADOS en el corpus (no basta con
 * que la entrada lo afirme) + fuentes + límites.
 */
export function isCatalogServable(
  q: CatalogQuestion,
  categories: CatalogCategories,
  approvedCriterionIds: ReadonlySet<string>,
): boolean {
  if (!validateCatalogQuestion(q, categories).valid) return false;
  if (q.approved !== true) return false;
  if (q.related_criteria_ids.length === 0) return false; // Regla 2
  if (!q.related_criteria_ids.every((id) => approvedCriterionIds.has(id))) return false; // Regla 2 real
  if (q.source_references.length === 0) return false; // Regla 3
  if (q.limits.length === 0) return false; // Regla 4
  return true;
}
