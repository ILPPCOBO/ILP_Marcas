/**
 * catalog/loader — Carga de categorías y preguntas del catálogo (deny-by-default).
 *
 * Nunca lanza: archivo ausente o malformado => estructura vacía. Acepta el
 * envoltorio {_warning, dataset, questions:[...]} o un array a secas.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogCategories, CatalogQuestion } from "../models";

export interface CatalogPaths {
  /** Carpeta del catálogo (categories.json + *.json de preguntas). */
  dir: string;
  /** Carpeta de criterios aprobados (para verificar el respaldo). */
  approved: string;
  /** Carpeta de resoluciones (para verificar que las citas existen, Regla 9). */
  judgments: string;
}

export const DEFAULT_CATALOG_PATHS: CatalogPaths = {
  dir: "data/catalog",
  approved: "data/approved_criteria",
  judgments: "data/source_judgments",
};

const EMPTY_CATEGORIES: CatalogCategories = { areas: [] };

export function loadCategories(paths: CatalogPaths = DEFAULT_CATALOG_PATHS): CatalogCategories {
  try {
    const file = join(paths.dir, "categories.json");
    if (!existsSync(file)) return EMPTY_CATEGORIES;
    const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
    const areas = (raw as { areas?: unknown }).areas;
    if (!Array.isArray(areas)) return EMPTY_CATEGORIES;
    const clean = areas
      .filter(
        (a): a is { area: string; topics: string[] } =>
          typeof a === "object" &&
          a !== null &&
          typeof (a as { area?: unknown }).area === "string" &&
          Array.isArray((a as { topics?: unknown }).topics),
      )
      .map((a) => ({ area: a.area, topics: a.topics.filter((t): t is string => typeof t === "string") }));
    return { areas: clean };
  } catch {
    return EMPTY_CATEGORIES;
  }
}

/** Lee todas las preguntas de los *.json del catálogo (excepto categories.json). */
export function loadCatalogQuestions(
  paths: CatalogPaths = DEFAULT_CATALOG_PATHS,
): CatalogQuestion[] {
  try {
    if (!existsSync(paths.dir)) return [];
    const out: CatalogQuestion[] = [];
    for (const name of readdirSync(paths.dir).sort()) {
      if (!name.endsWith(".json") || name === "categories.json") continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(join(paths.dir, name), "utf-8"));
        const items: unknown[] = Array.isArray(raw)
          ? raw
          : typeof raw === "object" &&
              raw !== null &&
              Array.isArray((raw as { questions?: unknown }).questions)
            ? ((raw as { questions: unknown[] }).questions)
            : [];
        for (const item of items) out.push(item as CatalogQuestion);
      } catch {
        // archivo ilegible => ignorado
      }
    }
    return out;
  } catch {
    return [];
  }
}
