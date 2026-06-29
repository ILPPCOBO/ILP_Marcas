/**
 * ingestion/store — E/S de archivos del flujo de ingesta (bajo nivel).
 *
 * Convenciones:
 *   - Cada criterio EXTRAÍDO se guarda en su propio archivo
 *     data/processed_criteria/<id>.json = { criteria: [criterio] } (facilita
 *     editar/aprobar/rechazar uno sin tocar los demás).
 *   - Al APROBAR, el criterio se MUEVE a data/approved_criteria/<id>.json y se
 *     borra de processed (el motor solo lee approved).
 *   - Lectura tolerante: acepta archivos {criteria:[...]} o un array a secas
 *     (compatibilidad con los datos mock existentes). NUNCA lanza al leer.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LegalCriterion } from "../models";
import type { ReviewEvent } from "./types";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Criterios de un archivo (acepta wrapper o array). Nunca lanza. */
function readCriteriaFile(path: string): LegalCriterion[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(raw)) return raw as LegalCriterion[];
    if (typeof raw === "object" && raw !== null && Array.isArray((raw as { criteria?: unknown }).criteria))
      return (raw as { criteria: LegalCriterion[] }).criteria;
    return [];
  } catch {
    return [];
  }
}

/** Un criterio guardado, con el archivo del que procede (para mutarlo). */
export interface StoredCriterion {
  criterion: LegalCriterion;
  /** Ruta del archivo que lo contiene. */
  file: string;
}

/** Lee todos los criterios de un directorio, anotando su archivo de origen. */
export function readAllFrom(dir: string): StoredCriterion[] {
  const out: StoredCriterion[] = [];
  try {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      for (const criterion of readCriteriaFile(file)) out.push({ criterion, file });
    }
  } catch {
    return out;
  }
  return out;
}

/** Escribe un criterio como archivo propio { criteria: [criterio] }. */
export function writeCriterionFile(dir: string, criterion: LegalCriterion): string {
  ensureDir(dir);
  const file = join(dir, `${criterion.id}.json`);
  writeFileSync(file, JSON.stringify({ criteria: [criterion] }, null, 2) + "\n", "utf-8");
  return file;
}

/**
 * Elimina un criterio de su archivo. Si el archivo tenía varios criterios,
 * reescribe el resto; si queda vacío, borra el archivo. Nunca lanza si no
 * existe.
 */
export function removeCriterionFromFile(file: string, criterionId: string): void {
  if (!existsSync(file)) return;
  const remaining = readCriteriaFile(file).filter((c) => c.id !== criterionId);
  if (remaining.length === 0) {
    rmSync(file, { force: true });
  } else {
    // Conserva el resto (preserva un posible wrapper como {criteria:[...]}).
    writeFileSync(file, JSON.stringify({ criteria: remaining }, null, 2) + "\n", "utf-8");
  }
}

/** Reemplaza un criterio dentro de su archivo (para editar/rechazar in situ). */
export function replaceCriterionInFile(file: string, updated: LegalCriterion): void {
  if (!existsSync(file)) {
    writeCriterionFile(join(file, ".."), updated);
    return;
  }
  const list = readCriteriaFile(file).map((c) => (c.id === updated.id ? updated : c));
  writeFileSync(file, JSON.stringify({ criteria: list }, null, 2) + "\n", "utf-8");
}

/** Añade una entrada al historial de revisión (JSONL append-only, Regla 3). */
export function appendReviewEvent(reviewLogPath: string, event: ReviewEvent): void {
  const dir = reviewLogPath.includes("/") ? reviewLogPath.slice(0, reviewLogPath.lastIndexOf("/")) : ".";
  ensureDir(dir);
  appendFileSync(reviewLogPath, JSON.stringify(event) + "\n", "utf-8");
}

/** Lee el historial de revisión completo. Nunca lanza. */
export function readReviewLog(reviewLogPath: string): ReviewEvent[] {
  try {
    if (!existsSync(reviewLogPath)) return [];
    return readFileSync(reviewLogPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ReviewEvent);
  } catch {
    return [];
  }
}

/** Lee/escribe el manifiesto de ingesta (metadatos admin: notes, provenance). */
export interface ManifestEntry {
  judgment_id: string;
  original_file: string;
  registered_by: string;
  registered_at: string;
  notes: string;
}

export function appendManifestEntry(manifestPath: string, entry: ManifestEntry): void {
  const dir = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/")) : ".";
  ensureDir(dir);
  let entries: ManifestEntry[] = [];
  try {
    if (existsSync(manifestPath)) {
      const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (Array.isArray((raw as { entries?: unknown }).entries))
        entries = (raw as { entries: ManifestEntry[] }).entries;
    }
  } catch {
    entries = [];
  }
  // Una entrada por judgment (la última gana si se re-registra).
  entries = entries.filter((e) => e.judgment_id !== entry.judgment_id);
  entries.push(entry);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        _warning:
          "Manifiesto de ingesta: metadatos de administración (notes/provenance) de las resoluciones. NO es corpus servible.",
        entries,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}
