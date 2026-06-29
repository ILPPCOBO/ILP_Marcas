/**
 * ingestion/judgmentLoader — Registro de resoluciones originales (F4, paso 1-2).
 *
 * "Cargar sentencia original" + "registrar metadatos". Construye un Judgment
 * (modelo F1, validado) a partir de los datos de registro y lo escribe en
 * data/source_judgments/. Las notas de administración y la procedencia van al
 * manifiesto, NO al Judgment (modelo cerrado).
 *
 * CLAUDE.md: la resolución original queda en data/source_judgments/ y NUNCA se
 * usa para responder (Regla 13). Aquí solo se cataloga su metadato.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Judgment } from "../models";
import { validateJudgment } from "../models";
import type { IngestionContext, IngestionPaths, JudgmentRegistration } from "./types";
import { DEFAULT_PATHS } from "./types";
import { appendManifestEntry } from "./store";

export interface RegisterResult {
  ok: boolean;
  judgment?: Judgment;
  errors: string[];
}

/**
 * Registra una resolución: valida, escribe el Judgment y anota notes/procedencia
 * en el manifiesto. Deny-by-default: si el Judgment no valida, NO se escribe
 * nada y se devuelven los errores.
 */
export function registerJudgment(
  reg: JudgmentRegistration,
  ctx: IngestionContext,
  paths: IngestionPaths = DEFAULT_PATHS,
): RegisterResult {
  const judgment: Judgment = {
    id: reg.id,
    title: reg.title,
    court: reg.court,
    date: reg.date,
    resolution_number: reg.resolution_number,
    jurisdiction: reg.jurisdiction,
    legal_area: reg.legal_area,
    topics: reg.topics,
    original_language: reg.original_language ?? "es",
    file_path: reg.file_path,
    // summary_internal es de catalogación interna (nunca servible). Si no se da,
    // deriva de notes o title para no quedar vacío (lo exige el modelo).
    summary_internal:
      (reg.summary_internal ?? "").trim() ||
      (reg.notes ?? "").trim() ||
      reg.title,
    created_at: ctx.now,
    updated_at: ctx.now,
  };

  const verdict = validateJudgment(judgment);
  if (!verdict.valid) return { ok: false, errors: verdict.errors };

  // Aviso honesto: el archivo original referido por file_path debería existir
  // (cuando se carguen las reales). No bloquea el registro de metadatos, pero
  // se reporta para la verificación posterior (no se inventa su presencia).
  const warnings: string[] = [];
  const abs = reg.file_path; // ruta relativa al repo
  if (!existsSync(abs)) {
    warnings.push(
      `Aviso: el archivo original "${reg.file_path}" no existe todavía; el metadato queda registrado.`,
    );
  }

  // Envoltorio {judgments:[...]} para que loadJudgmentRegistry lo reconozca
  // (mismo formato que mock_judgments.json). Se asegura el directorio destino.
  mkdirSync(paths.judgments, { recursive: true });
  writeFileSync(
    join(paths.judgments, `${judgment.id}.judgment.json`),
    JSON.stringify({ judgments: [judgment] }, null, 2) + "\n",
    "utf-8",
  );

  appendManifestEntry(paths.manifest, {
    judgment_id: judgment.id,
    original_file: reg.file_path,
    registered_by: ctx.actor,
    registered_at: ctx.now,
    notes: reg.notes,
  });

  return { ok: true, judgment, errors: warnings };
}
