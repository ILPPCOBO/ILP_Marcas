/**
 * ingestion/extractor — Extracción de criterios candidatos (F4, paso 3-4).
 *
 * La GENERACIÓN de candidatos es pluggable; el SELLADO es innegociable: pase lo
 * que pase, todo criterio escrito queda review_status:"pending_review",
 * approved:false, approved_by:null, approved_at:null (Reglas 14-15), y SOLO se
 * escribe en data/processed_criteria/ (nunca en approved, Regla 1).
 *
 * Extractores incluidos:
 *   - passthroughExtractor: usa los candidatos provistos por el operador (hoy la
 *     fuente es humana; cada candidato debe traer su extracto verbatim).
 *   - unconfiguredLlmExtractor: PLACEHOLDER que lanza. Un futuro extractor
 *     asistido por LLM debe (a) emitir source_excerpt VERBATIM del texto, sin
 *     inventar, y (b) seguir pasando por este sellado. Hasta entonces, lanza
 *     (deny-by-default): el sistema no inventa criterios.
 */
import type { LegalCriterion } from "../models";
import { validateLegalCriterion } from "../models";
import { loadJudgmentRegistry } from "../judgmentRegistry";
import type {
  CandidateCriterion,
  CriterionExtractor,
  IngestionContext,
  IngestionPaths,
} from "./types";
import { DEFAULT_PATHS } from "./types";
import { appendReviewEvent, readAllFrom, writeCriterionFile } from "./store";

export const passthroughExtractor: CriterionExtractor = {
  name: "passthrough",
  extract(input) {
    return input.candidates ?? [];
  },
};

export const unconfiguredLlmExtractor: CriterionExtractor = {
  name: "llm-unconfigured",
  extract() {
    throw new Error(
      "Extractor LLM no configurado: el sistema no inventa criterios. Debe proveer un " +
        "extractor que emita extractos verbatim, o usar candidatos humanos (passthrough).",
    );
  },
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** SELLADO: convierte un candidato en un criterio PENDING (Reglas 14-15). */
function sealPending(c: CandidateCriterion, id: string, now: string): LegalCriterion {
  return {
    id,
    judgment_id: c.judgment_id,
    area: c.area,
    topic: c.topic,
    subtopic: c.subtopic,
    criterion_text: c.criterion_text,
    conditions_for_application: c.conditions_for_application,
    does_not_answer: c.does_not_answer,
    limits: c.limits,
    source_excerpt: c.source_excerpt,
    source_reference: c.source_reference,
    confidence_level: c.confidence_level,
    // ESTADO FORZADO — nunca se copia de la entrada (defensa en profundidad).
    review_status: "pending_review",
    approved: false,
    approved_by: null,
    approved_at: null,
    created_at: now,
    updated_at: now,
  };
}

export interface ExtractionResult {
  written: LegalCriterion[];
  rejected: Array<{ candidate: CandidateCriterion; errors: string[] }>;
}

/**
 * Extrae y guarda criterios PENDING para una resolución ya registrada.
 *
 * Deny-by-default: si la resolución no está registrada, no se extrae nada
 * (Regla 4: no hay vínculo válido). Cada candidato se sella a pending y se valida
 * contra el modelo; el que no valida (o cuyo judgment_id no coincide) se rechaza
 * y NO se escribe. Lo escrito va SIEMPRE a processed_criteria/.
 */
export function extractPendingCriteria(
  judgment_id: string,
  candidates: CandidateCriterion[],
  ctx: IngestionContext,
  opts: { extractor?: CriterionExtractor; paths?: IngestionPaths } = {},
): ExtractionResult {
  const paths = opts.paths ?? DEFAULT_PATHS;
  const extractor = opts.extractor ?? passthroughExtractor;

  const registry = loadJudgmentRegistry(paths.judgments);
  const judgment = registry.get(judgment_id);
  if (!judgment) {
    return {
      written: [],
      rejected: candidates.map((candidate) => ({
        candidate,
        errors: [
          `La resolución "${judgment_id}" no está registrada; regístrela antes de extraer (Regla 4).`,
        ],
      })),
    };
  }

  const produced = extractor.extract({
    judgment_id,
    legal_area: judgment.legal_area,
    candidates,
  });

  // IDs ya existentes (en processed Y approved) para detectar colisiones: un id
  // duplicado dejaría copias incoherentes que ninguna operación posterior limpia.
  const existingIds = new Set<string>(
    [...readAllFrom(paths.processed), ...readAllFrom(paths.approved)].map((s) => s.criterion.id),
  );

  const result: ExtractionResult = { written: [], rejected: [] };
  let seq = 0;
  for (const cand of produced) {
    seq += 1;
    const errors: string[] = [];
    // Vínculo obligatorio criterio → resolución (Regla 4).
    if (cand.judgment_id !== judgment_id) {
      errors.push(
        `judgment_id del candidato ("${cand.judgment_id}") no coincide con la resolución ("${judgment_id}").`,
      );
    }
    const id = cand.id ?? `crit-${slug(judgment_id)}-${String(seq).padStart(3, "0")}`;
    if (existingIds.has(id)) {
      errors.push(`Ya existe un criterio con id "${id}" (colisión); use un id único.`);
    }
    const sealed = sealPending(cand, id, ctx.now);
    const verdict = validateLegalCriterion(sealed);
    errors.push(...verdict.errors);

    if (errors.length > 0) {
      result.rejected.push({ candidate: cand, errors });
      continue;
    }

    existingIds.add(id); // evita colisiones dentro del mismo lote
    writeCriterionFile(paths.processed, sealed);
    appendReviewEvent(paths.reviewLog, {
      id: `rev-extract-${id}`,
      criterion_id: id,
      judgment_id,
      action: "extract",
      actor: ctx.actor,
      at: ctx.now,
      detail: `Extraído como pending desde la resolución ${judgment_id} (extractor: ${extractor.name}).`,
    });
    result.written.push(sealed);
  }
  return result;
}
