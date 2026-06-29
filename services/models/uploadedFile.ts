/**
 * UploadedFile — Archivo subido por el usuario (Case Material) o por un admin
 * (Corpus Document). Es METADATO + texto extraído; NUNCA es un criterio jurídico.
 *
 * SEPARACIÓN ESTRICTA (núcleo de esta funcionalidad):
 *   - upload_type "corpus_document": sentencia/resolución. Fuente jurídica
 *     POTENCIAL — solo sirve tras extracción → pending_review → aprobación humana
 *     (Reglas 13-15). Nunca responde directamente al usuario final.
 *   - upload_type "case_material": documento del propio caso del usuario. SOLO
 *     hecho/evidencia; nunca fuente jurídica. No crea criterios ni entra al corpus.
 *
 * Regla 4 / "no inventes contenido visual": extraction_status y extracted_text
 * reflejan SOLO lo realmente extraído. Un extractor no configurado (PDF/DOCX/OCR)
 * deja status "pending"/"failed" + warnings; jamás inventa contenido.
 */
import {
  ValidationResult,
  fail,
  isIsoDateTime,
  isNonEmptyString,
  ok,
  unknownKeys,
} from "./validation";

export type UploadType = "corpus_document" | "case_material";
export const UPLOAD_TYPES: readonly UploadType[] = ["corpus_document", "case_material"] as const;

export type FileType = "pdf" | "docx" | "txt" | "png" | "jpg" | "jpeg";
export const FILE_TYPES: readonly FileType[] = ["pdf", "docx", "txt", "png", "jpg", "jpeg"] as const;

export type ExtractionStatus = "pending" | "completed" | "failed";
export const EXTRACTION_STATUSES: readonly ExtractionStatus[] = ["pending", "completed", "failed"] as const;

/**
 * Cómo se obtuvo el texto (Regla 4 — honestidad sobre el origen del contenido):
 *   - "native_text"               : capa de texto del propio archivo (PDF/DOCX/TXT digital).
 *   - "ocr"                       : reconocimiento óptico sobre un documento escaneado/imagen.
 *   - "native_plus_ocr"           : mezcla (PDF con páginas digitales + páginas escaneadas).
 *   - "manual_description_needed" : no se pudo extraer; el usuario debe describir o pegar el texto.
 */
export type ExtractionMethod = "native_text" | "ocr" | "native_plus_ocr" | "manual_description_needed";
export const EXTRACTION_METHODS: readonly ExtractionMethod[] = [
  "native_text",
  "ocr",
  "native_plus_ocr",
  "manual_description_needed",
] as const;

/** Confianza del texto extraído: capa nativa → high; OCR → medium; fallo/escaneo sin OCR → low. */
export type ExtractionConfidence = "low" | "medium" | "high";
export const EXTRACTION_CONFIDENCES: readonly ExtractionConfidence[] = ["low", "medium", "high"] as const;

/** Localización interna de un fragmento (para trazar de qué página/sección sale un hecho). */
export interface SourceLocation {
  fragment_id: string;
  page: number | null;
  section: string | null;
  char_start: number | null;
  char_end: number | null;
}

export interface UploadedFile {
  id: string;
  /** Caso al que pertenece el documento (Evaluador de Caso); opcional. */
  case_id?: string | null;
  original_filename: string;
  file_type: FileType;
  upload_type: UploadType;
  uploaded_at: string; // ISO 8601
  /** Identidad del admin (corpus) o null. */
  uploaded_by: string | null;
  /** Sesión del usuario (case_material anónimo) o null. */
  session_id: string | null;
  extraction_status: ExtractionStatus;
  /** Método de obtención del texto (opcional; honestidad sobre el origen). */
  extraction_method?: ExtractionMethod | null;
  /** Texto extraído por página/fragmento, en orden (opcional; "" para páginas sin texto). */
  page_texts?: string[];
  /** Confianza del texto extraído (opcional). */
  confidence?: ExtractionConfidence | null;
  /** Texto extraído; "" si pendiente o fallido (nunca inventado). */
  extracted_text: string;
  summary: string;
  detected_entities: string[];
  detected_legal_topics: string[];
  warnings: string[];
  source_locations: SourceLocation[];
  created_at: string;
  updated_at: string;
}

const UPLOAD_KEYS: readonly string[] = [
  "id",
  "case_id",
  "original_filename",
  "file_type",
  "upload_type",
  "uploaded_at",
  "uploaded_by",
  "session_id",
  "extraction_status",
  "extraction_method",
  "page_texts",
  "confidence",
  "extracted_text",
  "summary",
  "detected_entities",
  "detected_legal_topics",
  "warnings",
  "source_locations",
  "created_at",
  "updated_at",
] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function validateSourceLocation(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  if (unknownKeys(o, ["fragment_id", "page", "section", "char_start", "char_end"]).length) return false;
  return (
    isNonEmptyString(o.fragment_id) &&
    isNumberOrNull(o.page) &&
    isStringOrNull(o.section) &&
    isNumberOrNull(o.char_start) &&
    isNumberOrNull(o.char_end)
  );
}

export function validateUploadedFile(f: UploadedFile): ValidationResult {
  const errors: string[] = [];
  if (typeof f !== "object" || f === null) return fail(["UploadedFile: debe ser un objeto"]);
  for (const k of unknownKeys(f, UPLOAD_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(f.id)) errors.push("id: requerido y no vacío");
  if (f.case_id !== undefined && f.case_id !== null && !isNonEmptyString(f.case_id))
    errors.push("case_id: null o string no vacío (opcional)");
  if (!isNonEmptyString(f.original_filename)) errors.push("original_filename: requerido y no vacío");
  if (!FILE_TYPES.includes(f.file_type)) errors.push(`file_type: debe ser uno de ${FILE_TYPES.join(" | ")}`);
  if (!UPLOAD_TYPES.includes(f.upload_type)) errors.push(`upload_type: debe ser uno de ${UPLOAD_TYPES.join(" | ")}`);
  if (!isIsoDateTime(f.uploaded_at)) errors.push("uploaded_at: instante ISO 8601 requerido");
  // Trazabilidad de quién subió (Regla 16): al menos uno de los dos.
  if (!isNonEmptyString(f.uploaded_by) && !isNonEmptyString(f.session_id))
    errors.push("uploaded_by o session_id: al menos uno requerido (trazabilidad, Regla 16)");
  if (f.uploaded_by !== null && !isNonEmptyString(f.uploaded_by)) errors.push("uploaded_by: null o string no vacío");
  if (f.session_id !== null && !isNonEmptyString(f.session_id)) errors.push("session_id: null o string no vacío");
  if (!EXTRACTION_STATUSES.includes(f.extraction_status))
    errors.push(`extraction_status: debe ser uno de ${EXTRACTION_STATUSES.join(" | ")}`);
  if (
    f.extraction_method !== undefined &&
    f.extraction_method !== null &&
    !EXTRACTION_METHODS.includes(f.extraction_method)
  )
    errors.push(`extraction_method: null o uno de ${EXTRACTION_METHODS.join(" | ")}`);
  if (f.page_texts !== undefined && !isStringArray(f.page_texts))
    errors.push("page_texts: array de strings (opcional)");
  if (
    f.confidence !== undefined &&
    f.confidence !== null &&
    !EXTRACTION_CONFIDENCES.includes(f.confidence)
  )
    errors.push(`confidence: null o uno de ${EXTRACTION_CONFIDENCES.join(" | ")}`);
  if (typeof f.extracted_text !== "string") errors.push("extracted_text: string (vacío si no extraído)");
  if (typeof f.summary !== "string") errors.push("summary: string");
  if (!isStringArray(f.detected_entities)) errors.push("detected_entities: array de strings");
  if (!isStringArray(f.detected_legal_topics)) errors.push("detected_legal_topics: array de strings");
  if (!isStringArray(f.warnings)) errors.push("warnings: array de strings");
  if (!Array.isArray(f.source_locations) || !f.source_locations.every(validateSourceLocation))
    errors.push("source_locations: array de localizaciones válidas");
  if (!isIsoDateTime(f.created_at)) errors.push("created_at: ISO 8601 requerido");
  if (!isIsoDateTime(f.updated_at)) errors.push("updated_at: ISO 8601 requerido");

  // Coherencia: "completed" exige texto; "pending"/"failed" deben explicar por qué (warning).
  if (
    f.extraction_status === "completed" &&
    typeof f.extracted_text === "string" &&
    f.extracted_text.trim() === ""
  )
    errors.push("extracted_text: no puede estar vacío si extraction_status es 'completed'");
  if (
    (f.extraction_status === "failed" || f.extraction_status === "pending") &&
    Array.isArray(f.warnings) &&
    f.warnings.length === 0
  )
    errors.push("warnings: requerido cuando extraction_status no es 'completed' (explicar por qué)");

  return errors.length ? fail(errors) : ok();
}
