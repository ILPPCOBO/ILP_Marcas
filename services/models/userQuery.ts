/**
 * UserQuery — Pregunta hecha por el usuario, tal como entró y como se clasificó.
 *
 * Reglas de CLAUDE.md que afectan a esta entidad:
 *   - Regla 16: original_question forma parte de la trazabilidad de cada
 *     respuesta (la cadena completa es UserQuery ⋈ AdvisorAnswer ⋈ AuditLog).
 *   - Reglas 7 y 8: missing_facts y out_of_scope registran lo que el pipeline
 *     detectó (pasos 2–3 del flujo), que justifica repreguntar o rechazar.
 *   - Minimización de datos: esta entidad NO guarda PII del usuario (ni IP, ni
 *     identidad, ni user-agent); solo la pregunta y su clasificación.
 *
 * Espejo JSON Schema: data/schemas/user_query.schema.json
 */
import { LEGAL_AREAS, LegalArea } from "./judgment";
import {
  ValidationResult,
  fail,
  hasUniqueStrings,
  isArrayOfNonEmptyStrings,
  isIsoDateTime,
  isLanguageCode,
  isNonEmptyString,
  ok,
  unknownKeys,
} from "./validation";

export interface UserQuery {
  id: string;
  /** Pregunta literal del usuario, sin tocar. */
  original_question: string;
  /** Versión normalizada (minúsculas, espacios, etc.) usada por el pipeline. */
  normalized_question: string;
  /** Idioma detectado (ISO 639-1). */
  detected_language: string;
  /**
   * Materia clasificada; null si no se pudo clasificar O si está fuera de
   * alcance (scopeAreaToLegalArea("Fuera de alcance") === null) — la marca
   * distintiva de fuera-de-alcance es el flag out_of_scope, no este null.
   */
  classified_area: LegalArea | null;
  /** Tema clasificado dentro de la materia; null si no se pudo. */
  classified_topic: string | null;
  /** Datos que faltan para poder responder (alimenta las repreguntas, Regla 7). */
  missing_facts: string[];
  /** true si el pipeline determinó que la consulta está fuera del corpus (Regla 8). */
  out_of_scope: boolean;
  created_at: string;
}

const QUERY_KEYS: readonly string[] = [
  "id",
  "original_question",
  "normalized_question",
  "detected_language",
  "classified_area",
  "classified_topic",
  "missing_facts",
  "out_of_scope",
  "created_at",
] as const;

export function validateUserQuery(q: UserQuery): ValidationResult {
  const errors: string[] = [];

  if (typeof q !== "object" || q === null) return fail(["UserQuery: debe ser un objeto"]);
  for (const k of unknownKeys(q, QUERY_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(q.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(q.original_question)) errors.push("original_question: requerida y no vacía");
  if (!isNonEmptyString(q.normalized_question))
    errors.push("normalized_question: requerida y no vacía");
  if (!isLanguageCode(q.detected_language))
    errors.push("detected_language: código de idioma tipo ISO 639-1");
  if (q.classified_area !== null && !LEGAL_AREAS.includes(q.classified_area))
    errors.push(`classified_area: null o una de ${LEGAL_AREAS.join(" | ")}`);
  if (q.classified_topic !== null && !isNonEmptyString(q.classified_topic))
    errors.push("classified_topic: null o string no vacío");
  if (!isArrayOfNonEmptyStrings(q.missing_facts))
    errors.push("missing_facts: array de strings no vacíos");
  else if (!hasUniqueStrings(q.missing_facts)) errors.push("missing_facts: sin duplicados");
  if (typeof q.out_of_scope !== "boolean") errors.push("out_of_scope: debe ser boolean");
  if (!isIsoDateTime(q.created_at)) errors.push("created_at: instante ISO 8601 requerido");

  return errors.length ? fail(errors) : ok();
}
