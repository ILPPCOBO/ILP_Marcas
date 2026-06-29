/**
 * catalog/service — Navegación del catálogo con las puertas constitucionales.
 *
 * Solo expone preguntas SERVIBLES: aprobadas, conectadas a criterios APROBADOS
 * del corpus, con fuentes y límites (Reglas 1-4). Además (refuerzos de la
 * auditoría de seguridad):
 *   - las citas (source_references) se DERIVAN de los metadatos de los criterios
 *     enlazados, no del texto libre de la entrada (Regla 4);
 *   - la resolución de cada criterio enlazado debe EXISTIR en el registro (Regla 9);
 *   - short_answer/full_answer pasan el guardarraíl de lenguaje vetado (Regla 10);
 *   - el aviso se añade al servir, en el idioma pedido (Reglas 11-12).
 */
import type { CatalogCategories, CatalogQuestion, Judgment, LegalCriterion } from "../models";
import { isCatalogServable, isServable } from "../models";
import { DISCLAIMER, hasForbiddenLanguage } from "../answerComposer";
import { SHORT_DISCLAIMER_EN } from "../legal/disclaimer";
import { readableCitation } from "../legal/citations";
import { loadApprovedCriteria } from "../criteriaRetriever";
import { loadJudgmentRegistry } from "../judgmentRegistry";
import type { Locale } from "../i18n";
import {
  CatalogPaths,
  DEFAULT_CATALOG_PATHS,
  loadCatalogQuestions,
  loadCategories,
} from "./loader";

/** Criterios APROBADOS y servibles del corpus, por id. */
function approvedCriteriaById(approvedDir: string): Map<string, LegalCriterion> {
  const map = new Map<string, LegalCriterion>();
  for (const c of loadApprovedCriteria(approvedDir) as LegalCriterion[]) {
    if (isServable(c)) map.set(c.id, c);
  }
  return map;
}

export interface ServedQuestion {
  id: string;
  area: string;
  topic: string;
  question: string;
  short_answer: string;
  full_answer: string;
  related_criteria_ids: string[];
  /** Citas DERIVADAS de los metadatos de los criterios (no texto libre). */
  source_references: string[];
  limits: string[];
  version: string;
  last_reviewed_at: string | null;
  /** Aviso de orientación informativa (Reglas 11-12), añadido al servir. */
  disclaimer: string;
}

/** Citas trazables ensambladas desde los metadatos del corpus (Regla 4). */
function citationsFromMetadata(
  q: CatalogQuestion,
  criteriaById: ReadonlyMap<string, LegalCriterion>,
): string[] {
  return q.related_criteria_ids.map((id) => {
    const c = criteriaById.get(id);
    return c ? readableCitation(c) : `(criterio ${id} no disponible)`;
  });
}

function toServed(
  q: CatalogQuestion,
  criteriaById: ReadonlyMap<string, LegalCriterion>,
  locale: Locale,
): ServedQuestion {
  return {
    id: q.id,
    area: q.area,
    topic: q.topic,
    question: q.question,
    short_answer: q.short_answer,
    full_answer: q.full_answer,
    related_criteria_ids: q.related_criteria_ids,
    source_references: citationsFromMetadata(q, criteriaById),
    limits: q.limits,
    version: q.version,
    last_reviewed_at: q.last_reviewed_at,
    disclaimer: locale === "en" ? SHORT_DISCLAIMER_EN : DISCLAIMER,
  };
}

/**
 * Puerta de servibilidad REFORZADA del catálogo: además de isCatalogServable
 * (aprobada + criterios aprobados + fuentes + límites), exige que la resolución
 * de cada criterio enlazado exista en el registro y que el contenido no use
 * lenguaje vetado. Cualquier fallo => no servible (deny-by-default).
 */
function isFullyServable(
  q: CatalogQuestion,
  categories: CatalogCategories,
  criteriaById: ReadonlyMap<string, LegalCriterion>,
  judgmentsById: ReadonlyMap<string, Judgment>,
): boolean {
  const approvedIds = new Set(criteriaById.keys());
  if (!isCatalogServable(q, categories, approvedIds)) return false;
  // Regla 9: la resolución de cada criterio enlazado debe existir.
  for (const id of q.related_criteria_ids) {
    const c = criteriaById.get(id);
    if (!c || !judgmentsById.has(c.judgment_id)) return false;
  }
  // Regla 10: ni la respuesta breve ni la completa pueden usar lenguaje vetado.
  if (hasForbiddenLanguage(q.short_answer) || hasForbiddenLanguage(q.full_answer)) return false;
  return true;
}

function servableQuestions(
  categories: CatalogCategories,
  questions: CatalogQuestion[],
  criteriaById: ReadonlyMap<string, LegalCriterion>,
  judgmentsById: ReadonlyMap<string, Judgment>,
): CatalogQuestion[] {
  return questions.filter((q) => isFullyServable(q, categories, criteriaById, judgmentsById));
}

export interface CatalogTree {
  areas: Array<{
    area: string;
    topics: Array<{ topic: string; approved_count: number }>;
  }>;
}

export function getCatalogTree(paths: CatalogPaths = DEFAULT_CATALOG_PATHS): CatalogTree {
  const categories = loadCategories(paths);
  const criteriaById = approvedCriteriaById(paths.approved);
  const judgmentsById = loadJudgmentRegistry(paths.judgments);
  const servable = servableQuestions(categories, loadCatalogQuestions(paths), criteriaById, judgmentsById);
  return {
    areas: categories.areas.map((a) => ({
      area: a.area,
      topics: a.topics.map((t) => ({
        topic: t,
        approved_count: servable.filter((q) => q.area === a.area && q.topic === t).length,
      })),
    })),
  };
}

export function listApprovedQuestions(
  area: string,
  topic: string,
  paths: CatalogPaths = DEFAULT_CATALOG_PATHS,
  locale: Locale = "es",
): ServedQuestion[] {
  const categories = loadCategories(paths);
  const criteriaById = approvedCriteriaById(paths.approved);
  const judgmentsById = loadJudgmentRegistry(paths.judgments);
  return servableQuestions(categories, loadCatalogQuestions(paths), criteriaById, judgmentsById)
    .filter((q) => q.area === area && q.topic === topic)
    .map((q) => toServed(q, criteriaById, locale));
}

export function getApprovedQuestion(
  id: string,
  paths: CatalogPaths = DEFAULT_CATALOG_PATHS,
  locale: Locale = "es",
): ServedQuestion | null {
  const categories = loadCategories(paths);
  const criteriaById = approvedCriteriaById(paths.approved);
  const judgmentsById = loadJudgmentRegistry(paths.judgments);
  const q = loadCatalogQuestions(paths).find((x) => x.id === id);
  if (!q || !isFullyServable(q, categories, criteriaById, judgmentsById)) return null;
  return toServed(q, criteriaById, locale);
}
