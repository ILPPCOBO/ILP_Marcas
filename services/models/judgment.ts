/**
 * Judgment — Resolución judicial original (materia prima del corpus).
 *
 * Reglas de CLAUDE.md que afectan a esta entidad:
 *   - Regla 13: una Judgment NUNCA se usa directamente para responder al usuario.
 *     Es la fuente de la que se extraen LegalCriterion, y el ancla de su
 *     trazabilidad (Regla 9).
 *   - El archivo original vive en data/source_judgments/ (file_path apunta ahí).
 *   - summary_internal es de uso interno (catalogación); JAMÁS es servible.
 *
 * Espejo JSON Schema: data/schemas/judgment.schema.json
 */
import {
  ValidationResult,
  fail,
  hasUniqueStrings,
  isArrayOfNonEmptyStrings,
  isIsoDate,
  isIsoDateTime,
  isLanguageCode,
  isNonEmptyString,
  ok,
  unknownKeys,
} from "./validation";

/**
 * Vocabulario CERRADO de materias (léxico cerrado, coherente con deny-by-default:
 * una materia nueva exige decisión explícita y actualización del esquema).
 */
export type LegalArea = "marcas" | "propiedad_intelectual" | "patentes" | "procesal";

export const LEGAL_AREAS: readonly LegalArea[] = [
  "marcas",
  "propiedad_intelectual",
  "patentes",
  "procesal",
] as const;

export interface Judgment {
  id: string;
  /** Título descriptivo interno (no necesariamente el rótulo oficial). */
  title: string;
  /** Tribunal que dictó la resolución, tal como consta en ella. */
  court: string;
  /** Fecha de la resolución (YYYY-MM-DD). */
  date: string;
  /** Número/identificador oficial de la resolución (o ECLI si existe). */
  resolution_number: string;
  /** Jurisdicción/país (p. ej. "ES"). */
  jurisdiction: string;
  legal_area: LegalArea;
  /** Temas tratados (vocabulario de temas a consolidar en el catálogo de áreas). */
  topics: string[];
  /** Idioma original del documento (ISO 639-1). */
  original_language: string;
  /** Ruta relativa al archivo original dentro de data/source_judgments/. */
  file_path: string;
  /** Resumen interno de catalogación. NUNCA servible al usuario (Regla 13). */
  summary_internal: string;
  created_at: string;
  updated_at: string;
}

const JUDGMENT_KEYS: readonly string[] = [
  "id",
  "title",
  "court",
  "date",
  "resolution_number",
  "jurisdiction",
  "legal_area",
  "topics",
  "original_language",
  "file_path",
  "summary_internal",
  "created_at",
  "updated_at",
] as const;

const SOURCE_PREFIX = "data/source_judgments/";

export function validateJudgment(j: Judgment): ValidationResult {
  const errors: string[] = [];

  if (typeof j !== "object" || j === null) return fail(["Judgment: debe ser un objeto"]);
  for (const k of unknownKeys(j, JUDGMENT_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(j.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(j.title)) errors.push("title: requerido y no vacío");
  if (!isNonEmptyString(j.court)) errors.push("court: requerido y no vacío");
  if (!isIsoDate(j.date))
    errors.push("date: debe ser fecha ISO YYYY-MM-DD de calendario válida");
  if (!isNonEmptyString(j.resolution_number))
    errors.push("resolution_number: requerido — sin identificador oficial no hay trazabilidad (Regla 9)");
  if (!isNonEmptyString(j.jurisdiction)) errors.push("jurisdiction: requerido y no vacío");
  if (!LEGAL_AREAS.includes(j.legal_area))
    errors.push(`legal_area: debe ser una de ${LEGAL_AREAS.join(" | ")}`);
  if (!isArrayOfNonEmptyStrings(j.topics)) errors.push("topics: array de strings no vacíos");
  else if (!hasUniqueStrings(j.topics)) errors.push("topics: sin duplicados");
  if (!isLanguageCode(j.original_language))
    errors.push("original_language: código de idioma tipo ISO 639-1 (p. ej. \"es\")");
  // Sandbox de originales: dentro de data/source_judgments/, con nombre de archivo
  // y sin ".." (path traversal => fuera del sandbox, Regla 13 + deny-by-default).
  if (
    !isNonEmptyString(j.file_path) ||
    !j.file_path.startsWith(SOURCE_PREFIX) ||
    j.file_path.length <= SOURCE_PREFIX.length ||
    j.file_path.includes("..")
  )
    errors.push(
      "file_path: debe apuntar a un archivo dentro de data/source_judgments/ (sin \"..\")",
    );
  if (!isNonEmptyString(j.summary_internal)) errors.push("summary_internal: requerido y no vacío");
  if (!isIsoDateTime(j.created_at)) errors.push("created_at: instante ISO 8601 requerido");
  if (!isIsoDateTime(j.updated_at)) errors.push("updated_at: instante ISO 8601 requerido");

  return errors.length ? fail(errors) : ok();
}
