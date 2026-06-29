/**
 * ingestion/types — Contratos del flujo interno de ingesta y revisión (F4/F5).
 *
 * Pipeline editorial (CLAUDE.md Reglas 13-15):
 *   resolución original → registro de metadatos → extracción de candidatos
 *   → criterios PENDING en data/processed_criteria/ → revisión humana
 *   → (aprobar) data/approved_criteria/  |  (rechazar) | (editar → sigue pending)
 *
 * Invariantes que el código DEBE garantizar:
 *   - La extracción nunca escribe en data/approved_criteria/ (Regla 1).
 *   - Todo criterio extraído nace review_status:"pending_review", approved:false
 *     (Regla 14), sea cual sea el extractor.
 *   - Solo la aprobación HUMANA mueve un criterio a approved (Reglas 2, 15) y
 *     queda registrada con fecha y usuario (Regla 3).
 *   - El vínculo criterio → resolución se conserva siempre (Regla 4).
 *   - Sin metadato de fuente verificable, no se puede aprobar (Regla 5).
 */
import type { ConfidenceLevel, LegalArea } from "../models";

/**
 * Datos para registrar una resolución original. Incluye los campos mínimos que
 * pidió el propietario más los que el modelo canónico Judgment (F1) exige para
 * trazabilidad: `jurisdiction` (obligatorio, no se inventa) y, con valores por
 * defecto documentados, `original_language` ("es") y `summary_internal`.
 * `notes` es metadato de administración: NO va en el Judgment (modelo cerrado),
 * se guarda en el manifiesto de ingesta.
 */
export interface JudgmentRegistration {
  id: string;
  title: string;
  court: string;
  date: string; // YYYY-MM-DD
  resolution_number: string;
  legal_area: LegalArea;
  topics: string[];
  /** Ruta al archivo original dentro de data/source_judgments/ (Regla 13). */
  file_path: string;
  /** Notas internas de administración (no servibles, no van al Judgment). */
  notes: string;
  /** Jurisdicción/país. Obligatorio para la trazabilidad; no se infiere. */
  jurisdiction: string;
  /** Idioma original (ISO 639-1). Por defecto "es" si se omite. */
  original_language?: string;
  /** Resumen interno de catalogación. Por defecto deriva de notes/title. */
  summary_internal?: string;
}

/**
 * Candidato de criterio que produce un extractor, ANTES de sellarlo. No lleva
 * los campos de estado (review_status/approved/approved_by/approved_at) ni
 * timestamps: los pone el pipeline (forzando pending). `id` es opcional; si se
 * omite, el pipeline lo genera de forma determinista a partir del judgment.
 */
export interface CandidateCriterion {
  id?: string;
  judgment_id: string;
  area: LegalArea;
  topic: string;
  subtopic: string | null;
  criterion_text: string;
  conditions_for_application: string[];
  does_not_answer: string[];
  limits: string[];
  /** Extracto VERBATIM de la resolución (Regla 9). */
  source_excerpt: string;
  /** Localización dentro de la resolución (Regla 9). */
  source_reference: string;
  confidence_level: ConfidenceLevel;
}

/** Contexto inyectado por el llamador: nunca se inventan ids ni fechas aquí. */
export interface IngestionContext {
  /** Instante ISO 8601 de la operación. */
  now: string;
  /** Identidad del operador/revisor humano (para la trazabilidad, Regla 3). */
  actor: string;
}

/** Acciones registradas en el historial de revisión. */
export type ReviewAction = "extract" | "approve" | "reject" | "edit";

/** Evento de trazabilidad editorial (Regla 3 + historial completo). */
export interface ReviewEvent {
  id: string;
  criterion_id: string;
  judgment_id: string;
  action: ReviewAction;
  /** Usuario/admin que realizó la acción. */
  actor: string;
  /** Instante ISO 8601. */
  at: string;
  /** Detalle: motivo de rechazo, campos editados, etc. */
  detail: string;
}

/**
 * Extractor de candidatos. La GENERACIÓN de candidatos es pluggable (humana hoy;
 * un futuro extractor asistido por LLM debería emitir SOLO extractos verbatim).
 * Sea cual sea, el pipeline fuerza pending y valida: el extractor no puede
 * saltarse las reglas.
 */
export interface CriterionExtractor {
  readonly name: string;
  /** Devuelve candidatos para una resolución. `sourceText` es opcional. */
  extract(input: {
    judgment_id: string;
    legal_area: LegalArea;
    sourceText?: string;
    candidates?: CandidateCriterion[];
  }): CandidateCriterion[];
}

/** Rutas de almacenamiento (inyectables para tests). */
export interface IngestionPaths {
  judgments: string;
  processed: string;
  approved: string;
  manifest: string;
  reviewLog: string;
}

export const DEFAULT_PATHS: IngestionPaths = {
  judgments: "data/source_judgments",
  processed: "data/processed_criteria",
  approved: "data/approved_criteria",
  manifest: "data/source_judgments/ingestion_manifest.json",
  reviewLog: "data/review_log.jsonl",
};
