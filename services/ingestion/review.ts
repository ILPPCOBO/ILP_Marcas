/**
 * ingestion/review — Revisión humana de criterios (F5, pasos 5-6).
 *
 * Listar criterios pendientes, y aprobar / rechazar / editar. Es la ÚNICA puerta
 * entre data/processed_criteria/ y data/approved_criteria/.
 *
 * CLAUDE.md:
 *   - Regla 2/15: solo la aprobación HUMANA mueve un criterio a approved.
 *   - Regla 3: toda aprobación (y rechazo/edición) queda registrada con fecha y
 *     usuario en el historial de revisión.
 *   - Regla 4: el vínculo criterio → resolución se conserva.
 *   - Regla 5: sin metadato de fuente verificable (resolución existente +
 *     source_excerpt + source_reference), NO se puede aprobar.
 *   - Editar nunca aprueba: un criterio editado vuelve/permanece en pending.
 */
import type { Judgment, LegalCriterion } from "../models";
import {
  isIsoDateTime,
  isNonEmptyString,
  isServable,
  validateCriterionAgainstJudgments,
  validateLegalCriterion,
} from "../models";
import { loadJudgmentRegistry } from "../judgmentRegistry";
import { hasForbiddenLanguage } from "../answerComposer";
import type { IngestionContext, IngestionPaths, ReviewEvent } from "./types";
import { DEFAULT_PATHS } from "./types";
import {
  appendReviewEvent,
  readAllFrom,
  removeCriterionFromFile,
  replaceCriterionInFile,
  writeCriterionFile,
} from "./store";

export interface ReviewItem {
  criterion: LegalCriterion;
  /** Resolución de origen (metadatos), si está registrada (Regla 4). */
  judgment: Judgment | null;
  /** Archivo de processed_criteria que lo contiene. */
  file: string;
}

/** Lista criterios para revisión (por defecto, los pending_review). */
export function listForReview(
  opts: { status?: LegalCriterion["review_status"]; paths?: IngestionPaths } = {},
): ReviewItem[] {
  const paths = opts.paths ?? DEFAULT_PATHS;
  const status = opts.status ?? "pending_review";
  const registry = loadJudgmentRegistry(paths.judgments);
  return readAllFrom(paths.processed)
    .filter((s) => s.criterion.review_status === status)
    .map((s) => ({
      criterion: s.criterion,
      judgment: registry.get(s.criterion.judgment_id) ?? null,
      file: s.file,
    }));
}

function find(
  criterionId: string,
  paths: IngestionPaths,
): { criterion: LegalCriterion; file: string } | null {
  const hit = readAllFrom(paths.processed).find((s) => s.criterion.id === criterionId);
  return hit ? { criterion: hit.criterion, file: hit.file } : null;
}

/**
 * Motivos por los que NO se podría aprobar un criterio, para mostrarlos en el
 * panel y habilitar "Aprobar" SOLO cuando la aprobación vaya a aceptarse.
 *
 * Coherencia de contrato: se derivan de la MISMA puerta real que usa
 * approveCriterion (validateCriterionAgainstJudgments sobre el criterio sellado
 * como aprobado). Así nunca se anuncia "aprobable" algo que el servidor luego
 * rechazaría. Incluye la regla del propietario (judgment_id, criterion_text,
 * source_reference, limits) y todo lo demás del modelo (topic, área, sin
 * duplicados en las listas, etc.) más que la resolución fuente exista (Regla 5).
 * Devuelve etiquetas cortas (el nombre del campo); [] significa aprobable.
 */
export function missingRequiredForApproval(
  c: LegalCriterion,
  judgmentsById: ReadonlyMap<string, Judgment>,
): string[] {
  // Sella como aprobado con metadatos válidos de marcador (el approve real los
  // pone desde ctx); así los únicos errores que quedan son de CONTENIDO/fuente.
  const wouldBe: LegalCriterion = {
    ...c,
    review_status: "approved",
    approved: true,
    approved_by: isNonEmptyString(c.approved_by) ? c.approved_by : "(revisor)",
    approved_at: isIsoDateTime(c.approved_at) ? c.approved_at : "2000-01-01T00:00:00Z",
  };
  const labels: string[] = [];
  for (const e of validateCriterionAgainstJudgments(wouldBe, judgmentsById).errors) {
    const label = e.includes("no existe en el corpus")
      ? "resolución fuente registrada"
      : (e.split(":")[0] ?? e).trim();
    if (!labels.includes(label)) labels.push(label);
  }
  // Regla del propietario: limits debe ser NO VACÍO para aprobar. El modelo F1
  // permite limits: [] en un criterio cualquiera, pero la APROBACIÓN lo exige.
  if (!Array.isArray(c.limits) || !c.limits.some((l) => isNonEmptyString(l))) {
    if (!labels.includes("limits")) labels.push("limits");
  }
  // Regla 18 (defensa en profundidad, hallazgo de auditoría): un criterio cuyo
  // contenido contenga lenguaje de pronóstico/recomendación NO puede aprobarse —
  // se renderizaría VERBATIM al usuario y burlaría el veto si el patrón se colara.
  const contentParts = [
    c.criterion_text,
    ...(Array.isArray(c.conditions_for_application) ? c.conditions_for_application : []),
    ...(Array.isArray(c.does_not_answer) ? c.does_not_answer : []),
    ...(Array.isArray(c.limits) ? c.limits : []),
  ];
  if (contentParts.some((t) => typeof t === "string" && hasForbiddenLanguage(t))) {
    if (!labels.includes("lenguaje vetado (Regla 18)")) labels.push("lenguaje vetado (Regla 18)");
  }
  return labels;
}

export interface ReviewResult {
  ok: boolean;
  criterion?: LegalCriterion;
  event?: ReviewEvent;
  errors: string[];
}

/**
 * APROBAR (Reglas 2, 3, 5, 15). Aplica ediciones opcionales, comprueba que la
 * fuente existe y es verificable, sella approved con usuario+fecha, MUEVE el
 * criterio a approved_criteria/ y registra el evento. Deny-by-default: cualquier
 * fallo => NO se aprueba ni se mueve nada.
 */
export function approveCriterion(
  criterionId: string,
  ctx: IngestionContext,
  opts: { edits?: Partial<EditableFields>; paths?: IngestionPaths } = {},
): ReviewResult {
  const paths = opts.paths ?? DEFAULT_PATHS;
  const found = find(criterionId, paths);
  if (!found) return { ok: false, errors: [`Criterio "${criterionId}" no está en processed_criteria.`] };

  // Regla 3: la aprobación es un acto humano identificado.
  if (!ctx.actor || !ctx.actor.trim())
    return { ok: false, errors: ["Falta el usuario/admin que aprueba (Regla 3)."] };

  const base = applyEdits(found.criterion, opts.edits);
  const registry = loadJudgmentRegistry(paths.judgments);

  // MISMA puerta que muestra el panel (coherencia de contrato): si falta o es
  // inválido cualquier campo obligatorio (incluidos topic, listas sin duplicados
  // y limits no vacío) o la resolución fuente no existe (Regla 5), no se aprueba.
  const blockers = missingRequiredForApproval(base, registry);
  if (blockers.length > 0) {
    return {
      ok: false,
      errors: [`No se puede aprobar; faltan o son inválidos: ${blockers.join(", ")}.`],
    };
  }

  const approved: LegalCriterion = {
    ...base,
    review_status: "approved",
    approved: true,
    approved_by: ctx.actor,
    approved_at: ctx.now,
    updated_at: ctx.now,
  };
  // Cinturón y tirantes: garantía final de servibilidad antes de mover.
  if (!isServable(approved)) {
    return { ok: false, errors: ["El criterio aprobado no supera la puerta de servibilidad."] };
  }

  // Mover con orden write-before-delete (durabilidad: ante un fallo de E/S es
  // preferible una copia duplicada — la pending sigue siendo NO servible — que
  // perder el criterio aprobado). El borrado es best-effort: si falla, la copia
  // approved es la fuente de verdad y queda un residuo pending inofensivo.
  writeCriterionFile(paths.approved, approved);
  try {
    removeCriterionFromFile(found.file, criterionId);
  } catch {
    /* residuo pending no servible; el criterio aprobado ya está persistido */
  }

  const event: ReviewEvent = {
    id: `rev-approve-${criterionId}-${ctx.now}`,
    criterion_id: criterionId,
    judgment_id: approved.judgment_id,
    action: "approve",
    actor: ctx.actor,
    at: ctx.now,
    detail: `Aprobado y movido a approved_criteria (resolución ${approved.judgment_id}).`,
  };
  appendReviewEvent(paths.reviewLog, event);
  return { ok: true, criterion: approved, event, errors: [] };
}

/** RECHAZAR. Marca rejected/approved:false, permanece en processed, registra motivo. */
export function rejectCriterion(
  criterionId: string,
  ctx: IngestionContext,
  opts: { reason: string; paths?: IngestionPaths },
): ReviewResult {
  const paths = opts.paths ?? DEFAULT_PATHS;
  const found = find(criterionId, paths);
  if (!found) return { ok: false, errors: [`Criterio "${criterionId}" no está en processed_criteria.`] };
  if (!ctx.actor || !ctx.actor.trim())
    return { ok: false, errors: ["Falta el usuario/admin que rechaza (Regla 3)."] };

  const rejected: LegalCriterion = {
    ...found.criterion,
    review_status: "rejected",
    approved: false,
    approved_by: null,
    approved_at: null,
    updated_at: ctx.now,
  };
  // El rechazo solo cambia el estado; el modelo lo valida igualmente.
  const verdict = validateLegalCriterion(rejected);
  if (!verdict.valid) return { ok: false, errors: verdict.errors };

  replaceCriterionInFile(found.file, rejected);
  const event: ReviewEvent = {
    id: `rev-reject-${criterionId}-${ctx.now}`,
    criterion_id: criterionId,
    judgment_id: rejected.judgment_id,
    action: "reject",
    actor: ctx.actor,
    at: ctx.now,
    detail: `Rechazado. Motivo: ${opts.reason}`,
  };
  appendReviewEvent(paths.reviewLog, event);
  return { ok: true, criterion: rejected, event, errors: [] };
}

/** Campos de contenido editables (nunca los de estado/aprobación). */
export interface EditableFields {
  area: LegalCriterion["area"];
  topic: string;
  subtopic: string | null;
  criterion_text: string;
  conditions_for_application: string[];
  does_not_answer: string[];
  limits: string[];
  source_excerpt: string;
  source_reference: string;
  confidence_level: LegalCriterion["confidence_level"];
}

/** Lista blanca real de campos editables (el estado nunca es editable por aquí). */
const EDITABLE_KEYS: readonly (keyof EditableFields)[] = [
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
] as const;

function applyEdits(c: LegalCriterion, edits?: Partial<EditableFields>): LegalCriterion {
  if (!edits) return c;
  // WHITELIST por construcción: solo se copian las claves de EDITABLE_KEYS; las
  // de estado (review_status/approved/approved_by/approved_at) y cualquier clave
  // desconocida se descartan aquí, no se confía en validaciones colaterales.
  const picked: Partial<EditableFields> = {};
  for (const key of EDITABLE_KEYS) {
    const value = edits[key];
    if (value !== undefined) (picked as Record<string, unknown>)[key] = value;
  }
  return { ...c, ...picked };
}

/**
 * EDITAR. Aplica cambios de contenido y deja el criterio en pending_review
 * (editar NUNCA aprueba). Registra los campos editados.
 */
export function editCriterion(
  criterionId: string,
  ctx: IngestionContext,
  opts: { edits: Partial<EditableFields>; paths?: IngestionPaths },
): ReviewResult {
  const paths = opts.paths ?? DEFAULT_PATHS;
  const found = find(criterionId, paths);
  if (!found) return { ok: false, errors: [`Criterio "${criterionId}" no está en processed_criteria.`] };
  if (!ctx.actor || !ctx.actor.trim())
    return { ok: false, errors: ["Falta el usuario/admin que edita (Regla 3)."] };

  const edited: LegalCriterion = {
    ...applyEdits(found.criterion, opts.edits),
    // Editar reabre/mantiene la revisión: nunca aprueba (Regla 15).
    review_status: "pending_review",
    approved: false,
    approved_by: null,
    approved_at: null,
    updated_at: ctx.now,
  };
  const verdict = validateLegalCriterion(edited);
  if (!verdict.valid) return { ok: false, errors: verdict.errors };

  replaceCriterionInFile(found.file, edited);
  const event: ReviewEvent = {
    id: `rev-edit-${criterionId}-${ctx.now}`,
    criterion_id: criterionId,
    judgment_id: edited.judgment_id,
    action: "edit",
    actor: ctx.actor,
    at: ctx.now,
    detail: `Editado (campos: ${Object.keys(opts.edits).join(", ")}); permanece en pending_review.`,
  };
  appendReviewEvent(paths.reviewLog, event);
  return { ok: true, criterion: edited, event, errors: [] };
}
