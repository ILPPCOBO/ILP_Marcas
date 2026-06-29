/**
 * uploadAudit — Eventos de ingesta/subida (Regla 16) en un log JSONL append-only,
 * SEPARADO del AuditLog por respuesta (que es un modelo cerrado y no debe
 * bloatearse). Registra: subida de archivo, extracción (status + warnings),
 * hechos extraídos (case_material) y criterios extraídos (corpus_document). La
 * aprobación/rechazo de criterios ya queda trazada en data/review_log.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type IngestionEventType =
  | "upload"
  | "extraction"
  | "facts_extracted"
  | "criteria_extracted"
  | "scoreboard"
  | "case_evaluation"
  | "access_denied";

export interface IngestionEvent {
  id: string;
  type: IngestionEventType;
  at: string; // ISO 8601
  /** Quién: id de admin o session_id del usuario. */
  actor: string;
  file_id: string | null;
  file_type: string | null;
  upload_type: string | null;
  extraction_status: string | null;
  warnings: string[];
  /** ids de hechos o criterios producidos por el evento. */
  produced_ids: string[];
  detail: string;
}

export const DEFAULT_EVENTS_LOG = "data/audit/ingestion_events.jsonl";

/** Best-effort: un fallo de persistencia no tumba la operación (la traza es deseable, no bloqueante). */
export function logIngestionEvent(event: IngestionEvent, path: string = DEFAULT_EVENTS_LOG): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf-8");
  } catch {
    /* la traza es best-effort */
  }
}

export function readIngestionEvents(path: string = DEFAULT_EVENTS_LOG): IngestionEvent[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as IngestionEvent);
  } catch {
    return [];
  }
}
