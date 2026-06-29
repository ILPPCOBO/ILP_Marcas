/**
 * criterionExtractor — Extracción de criterios desde una resolución (Corpus
 * Document) hacia estado pending_review.
 *
 * NO duplica el sellado: DELEGA en services/ingestion.extractPendingCriteria, que
 * fuerza review_status:"pending_review" / approved:false (Reglas 14-15), valida
 * contra el modelo, detecta colisiones de id y exige el vínculo a la resolución
 * registrada. Aquí solo se eligen adaptadores y se orquesta desde el documento.
 *
 * Reglas del módulo:
 *   1. Ningún criterio extraído automáticamente sirve para responder (queda pending).
 *   2-3. Nunca se marca approved automáticamente (lo hace el sellado).
 *   4. El operador distingue hecho / razonamiento del tribunal / criterio / límites
 *      al construir cada CandidateCriterion (criterion_text vs limits vs does_not_answer).
 *   5-6. No se convierte el resultado del caso en regla general ni se generaliza:
 *      el texto del criterio lo escribe un humano a partir del source_excerpt verbatim.
 *   7. Cada criterio debe traer source_excerpt y source_reference (lo valida el sellado).
 *   8-9. Sin candidatos claros => 0 criterios + nota; ambigüedad => confidence low/medium.
 *   10. Falta de metadato de fuente => el criterio no se escribe (validación).
 */
import type {
  CandidateCriterion,
  CriterionExtractor,
  ExtractionResult,
  IngestionContext,
  IngestionPaths,
} from "./ingestion";
import { extractPendingCriteria, passthroughExtractor, unconfiguredLlmExtractor } from "./ingestion";

/** Usa los candidatos marcados por el operador humano (fuente actual). */
export const passthroughCriterionExtractor: CriterionExtractor = passthroughExtractor;

/** Placeholder de extractor asistido: LANZA (no inventa). Debe emitir extractos verbatim. */
export const unconfiguredLlmCriterionExtractor: CriterionExtractor = unconfiguredLlmExtractor;

export interface DocumentExtractionInput {
  judgment_id: string;
  /** Texto extraído del documento (referencia para el humano/futuro extractor). */
  sourceText?: string;
  /** Candidatos ya separados (hecho / razonamiento / criterio / límites). */
  candidates?: CandidateCriterion[];
}

export interface DocumentExtractionResult extends ExtractionResult {
  /** Nota cuando no hubo candidatos (deny-by-default: no se inventa nada). */
  note: string | null;
}

/**
 * Extrae criterios PENDING desde una resolución YA registrada. Todo pasa por
 * extractPendingCriteria (sellado + validación + colisión + vínculo a resolución).
 */
export function extractCriteriaFromDocument(
  input: DocumentExtractionInput,
  ctx: IngestionContext,
  opts: { extractor?: CriterionExtractor; paths?: IngestionPaths } = {},
): DocumentExtractionResult {
  const candidates = input.candidates ?? [];
  const res = extractPendingCriteria(input.judgment_id, candidates, ctx, {
    extractor: opts.extractor, // por defecto passthrough (candidatos humanos)
    paths: opts.paths,
  });
  const note =
    candidates.length === 0 && res.written.length === 0
      ? "No se aportaron candidatos: no se extrajo ningún criterio. Un humano debe marcar los criterios " +
        "(separando hecho / razonamiento del tribunal / criterio / límites) a partir del texto fuente, " +
        "o configurar un extractor que emita extractos verbatim sin inventar."
      : null;
  return { ...res, note };
}
