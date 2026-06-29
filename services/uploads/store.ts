/**
 * uploads/store — Persistencia de UploadedFile. La raíz se elige por upload_type
 * (separación estructural): corpus_document → corpus_documents/, case_material →
 * case_materials/. Nunca lee de la raíz equivocada; nunca escribe un registro no
 * conforme. Deny-by-default en lectura: ilegible/ inválido => se ignora.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UploadType, UploadedFile } from "../models";
import { validateUploadedFile } from "../models";
import type { UploadPaths } from "./types";
import { DEFAULT_UPLOAD_PATHS } from "./types";

/** Raíz de almacenamiento por tipo (SEPARACIÓN ESTRUCTURAL). */
export function rootFor(upload_type: UploadType, paths: UploadPaths = DEFAULT_UPLOAD_PATHS): string {
  return upload_type === "corpus_document" ? paths.corpus_documents : paths.case_materials;
}

export function writeUploadedFile(file: UploadedFile, paths: UploadPaths = DEFAULT_UPLOAD_PATHS): string {
  const verdict = validateUploadedFile(file);
  if (!verdict.valid) {
    throw new Error(`UploadedFile no conforme: ${verdict.errors.join("; ")}`);
  }
  const dir = rootFor(file.upload_type, paths);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${file.id}.json`);
  writeFileSync(p, JSON.stringify(file, null, 2), "utf-8");
  return p;
}

export function readUploadedFile(
  id: string,
  upload_type: UploadType,
  paths: UploadPaths = DEFAULT_UPLOAD_PATHS,
): UploadedFile | null {
  try {
    const p = join(rootFor(upload_type, paths), `${id}.json`);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as UploadedFile;
    return validateUploadedFile(raw).valid ? raw : null;
  } catch {
    return null;
  }
}

export function listUploadedFiles(
  upload_type: UploadType,
  paths: UploadPaths = DEFAULT_UPLOAD_PATHS,
): UploadedFile[] {
  try {
    const dir = rootFor(upload_type, paths);
    if (!existsSync(dir)) return [];
    const out: UploadedFile[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(dir, name), "utf-8")) as UploadedFile;
        if (validateUploadedFile(raw).valid) out.push(raw);
      } catch {
        /* archivo ilegible => ignorado */
      }
    }
    return out;
  } catch {
    return [];
  }
}
