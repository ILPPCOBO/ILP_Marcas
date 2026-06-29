/**
 * catalog/admin — Edición y aprobación de preguntas estándar (Regla 5).
 *
 * Única vía a approved: true. La aprobación es un acto HUMANO registrado
 * (last_reviewed_by/at + historial) y exige que la pregunta sea SERVIBLE: válida,
 * conectada a criterios APROBADOS, con fuentes y límites (Reglas 1-4).
 *
 * Ids/timestamps se inyectan (no se inventan aquí). Nunca lanza por E/S.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogQuestion, LegalCriterion } from "../models";
import { isCatalogServable, isServable, validateCatalogQuestion } from "../models";
import { hasForbiddenLanguage } from "../answerComposer";
import { loadApprovedCriteria } from "../criteriaRetriever";
import { CatalogPaths, DEFAULT_CATALOG_PATHS, loadCategories } from "./loader";

export interface CatalogContext {
  now: string; // ISO 8601
  actor: string; // revisor/admin humano
}

export interface CatalogOpResult {
  ok: boolean;
  question?: CatalogQuestion;
  errors: string[];
}

const REVIEW_LOG = "data/catalog_review_log.jsonl";

/** Campos editables (nunca approved/last_reviewed_* por esta vía). */
export type EditableCatalogFields = Pick<
  CatalogQuestion,
  | "area"
  | "topic"
  | "question"
  | "short_answer"
  | "full_answer"
  | "related_criteria_ids"
  | "source_references"
  | "limits"
  | "version"
>;
const EDITABLE: readonly (keyof EditableCatalogFields)[] = [
  "area",
  "topic",
  "question",
  "short_answer",
  "full_answer",
  "related_criteria_ids",
  "source_references",
  "limits",
  "version",
] as const;

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readQuestions(file: string): CatalogQuestion[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (Array.isArray(raw)) return raw as CatalogQuestion[];
    if (typeof raw === "object" && raw !== null && Array.isArray((raw as { questions?: unknown }).questions))
      return (raw as { questions: CatalogQuestion[] }).questions;
    return [];
  } catch {
    return [];
  }
}

function findFile(id: string, dir: string): { question: CatalogQuestion; file: string } | null {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || name === "categories.json") continue;
    const file = join(dir, name);
    const q = readQuestions(file).find((x) => x.id === id);
    if (q) return { question: q, file };
  }
  return null;
}

function rewrite(file: string, updated: CatalogQuestion): void {
  const list = readQuestions(file).map((q) => (q.id === updated.id ? updated : q));
  writeFileSync(file, JSON.stringify({ questions: list }, null, 2) + "\n", "utf-8");
}

function approvedCriterionIds(approvedDir: string): Set<string> {
  const ids = new Set<string>();
  for (const c of loadApprovedCriteria(approvedDir) as LegalCriterion[]) if (isServable(c)) ids.add(c.id);
  return ids;
}

function applyEdits(q: CatalogQuestion, edits?: Partial<EditableCatalogFields>): CatalogQuestion {
  if (!edits) return q;
  const picked: Partial<EditableCatalogFields> = {};
  for (const key of EDITABLE) {
    const v = edits[key];
    if (v !== undefined) (picked as Record<string, unknown>)[key] = v;
  }
  return { ...q, ...picked };
}

function logEvent(action: string, id: string, actor: string, at: string, detail: string): void {
  try {
    const dir = REVIEW_LOG.slice(0, REVIEW_LOG.lastIndexOf("/"));
    ensureDir(dir);
    appendFileSync(REVIEW_LOG, JSON.stringify({ action, question_id: id, actor, at, detail }) + "\n", "utf-8");
  } catch {
    /* el log es best-effort; la operación ya se persistió */
  }
}

/** Crea una pregunta BORRADOR (approved:false). Nunca servible hasta aprobarse. */
export function createDraftQuestion(
  draft: EditableCatalogFields & { id: string },
  ctx: CatalogContext,
  paths: CatalogPaths = DEFAULT_CATALOG_PATHS,
): CatalogOpResult {
  if (findFile(draft.id, paths.dir)) return { ok: false, errors: [`Ya existe una pregunta con id "${draft.id}".`] };
  const q: CatalogQuestion = {
    id: draft.id,
    area: draft.area,
    topic: draft.topic,
    question: draft.question,
    short_answer: draft.short_answer,
    full_answer: draft.full_answer,
    related_criteria_ids: draft.related_criteria_ids,
    source_references: draft.source_references,
    limits: draft.limits,
    approved: false,
    version: draft.version,
    last_reviewed_at: null,
    last_reviewed_by: null,
  };
  const verdict = validateCatalogQuestion(q, loadCategories(paths));
  if (!verdict.valid) return { ok: false, errors: verdict.errors };
  ensureDir(paths.dir);
  writeFileSync(join(paths.dir, `${q.id}.json`), JSON.stringify({ questions: [q] }, null, 2) + "\n", "utf-8");
  logEvent("create", q.id, ctx.actor, ctx.now, "Borrador creado (approved:false).");
  return { ok: true, question: q, errors: [] };
}

/** Edita una pregunta: aplica cambios y la deja en BORRADOR (editar no aprueba). */
export function editCatalogQuestion(
  id: string,
  ctx: CatalogContext,
  opts: { edits: Partial<EditableCatalogFields>; paths?: CatalogPaths },
): CatalogOpResult {
  const paths = opts.paths ?? DEFAULT_CATALOG_PATHS;
  const found = findFile(id, paths.dir);
  if (!found) return { ok: false, errors: [`Pregunta "${id}" no encontrada.`] };
  if (!ctx.actor.trim()) return { ok: false, errors: ["Falta el usuario/admin (Regla 3)."] };
  const edited: CatalogQuestion = {
    ...applyEdits(found.question, opts.edits),
    approved: false, // editar reabre la revisión (nunca aprueba)
    last_reviewed_at: null,
    last_reviewed_by: null,
  };
  const verdict = validateCatalogQuestion(edited, loadCategories(paths));
  if (!verdict.valid) return { ok: false, errors: verdict.errors };
  rewrite(found.file, edited);
  logEvent("edit", id, ctx.actor, ctx.now, `Editado (${Object.keys(opts.edits).join(", ")}); vuelve a borrador.`);
  return { ok: true, question: edited, errors: [] };
}

/**
 * APRUEBA una pregunta (Regla 5): aplica ediciones opcionales, exige que sea
 * SERVIBLE (válida + criterios aprobados + fuentes + límites) y registra el acto
 * humano. Deny-by-default: si no es servible, NO se aprueba.
 */
export function approveCatalogQuestion(
  id: string,
  ctx: CatalogContext,
  opts: { edits?: Partial<EditableCatalogFields>; paths?: CatalogPaths } = {},
): CatalogOpResult {
  const paths = opts.paths ?? DEFAULT_CATALOG_PATHS;
  const found = findFile(id, paths.dir);
  if (!found) return { ok: false, errors: [`Pregunta "${id}" no encontrada.`] };
  if (!ctx.actor.trim()) return { ok: false, errors: ["Falta el usuario/admin que aprueba (Regla 3)."] };

  const approved: CatalogQuestion = {
    ...applyEdits(found.question, opts.edits),
    approved: true,
    last_reviewed_at: ctx.now,
    last_reviewed_by: ctx.actor,
  };
  const categories = loadCategories(paths);
  const verdict = validateCatalogQuestion(approved, categories);
  const approvedIds = approvedCriterionIds(paths.approved);
  if (!verdict.valid) return { ok: false, errors: verdict.errors };
  if (!isCatalogServable(approved, categories, approvedIds))
    return {
      ok: false,
      errors: [
        "No se puede aprobar: la pregunta debe estar conectada a criterios APROBADOS y tener fuentes y límites (Reglas 2-4).",
      ],
    };
  // Regla 10: no se aprueba contenido con lenguaje vetado (imperativo/garantista).
  if (hasForbiddenLanguage(approved.short_answer) || hasForbiddenLanguage(approved.full_answer))
    return {
      ok: false,
      errors: ["No se puede aprobar: la respuesta contiene lenguaje vetado (asesoramiento/garantía); reformúlela (Regla 10)."],
    };
  rewrite(found.file, approved);
  logEvent("approve", id, ctx.actor, ctx.now, "Aprobada (approved:true).");
  return { ok: true, question: approved, errors: [] };
}

/** RECHAZA una pregunta: approved:false; registra el motivo en el historial. */
export function rejectCatalogQuestion(
  id: string,
  ctx: CatalogContext,
  opts: { reason: string; paths?: CatalogPaths },
): CatalogOpResult {
  const paths = opts.paths ?? DEFAULT_CATALOG_PATHS;
  const found = findFile(id, paths.dir);
  if (!found) return { ok: false, errors: [`Pregunta "${id}" no encontrada.`] };
  if (!ctx.actor.trim()) return { ok: false, errors: ["Falta el usuario/admin que rechaza (Regla 3)."] };
  if (!opts.reason.trim()) return { ok: false, errors: ["Falta el motivo de rechazo."] };
  const rejected: CatalogQuestion = {
    ...found.question,
    approved: false,
    last_reviewed_at: ctx.now,
    last_reviewed_by: ctx.actor,
  };
  const verdict = validateCatalogQuestion(rejected, loadCategories(paths));
  if (!verdict.valid) return { ok: false, errors: verdict.errors };
  rewrite(found.file, rejected);
  logEvent("reject", id, ctx.actor, ctx.now, `Rechazada. Motivo: ${opts.reason}`);
  return { ok: true, question: rejected, errors: [] };
}
