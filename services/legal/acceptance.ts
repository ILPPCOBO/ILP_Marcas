/**
 * legal/acceptance — Registro de la ACEPTACIÓN EXPRESA del aviso (consentimiento).
 *
 * Antes de usar la herramienta, el usuario acepta el aviso (pantalla de
 * bienvenida). Se guarda un registro mínimo y trazable:
 *   - session_id (aleatorio; sin PII) o user_id (null hasta que haya login real),
 *   - fecha y hora (accepted_at),
 *   - versión del aviso (disclaimer_version),
 *   - idioma del aviso (language).
 *
 * Minimización de datos: NO se guarda IP, user-agent ni identidad. El registro
 * es append-only (JSONL) y no se versiona en git.
 *
 * Ids/timestamps se INYECTAN (el servidor los genera); el módulo no los inventa.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  ValidationResult,
  fail,
  isIsoDateTime,
  isLanguageCode,
  isNonEmptyString,
  ok,
} from "../models";
import { DISCLAIMER_VERSION } from "./disclaimer";

export interface AcceptanceRecord {
  id: string;
  /** Sesión local aleatoria (sin PII). */
  session_id: string;
  /** Usuario real; null hasta que exista login (estructura preparada). */
  user_id: string | null;
  accepted_at: string; // ISO 8601
  disclaimer_version: string;
  language: string;
}

export const DEFAULT_ACCEPTANCE_LOG = "data/acceptance_log.jsonl";

export function validateAcceptance(r: AcceptanceRecord): ValidationResult {
  const errors: string[] = [];
  if (!isNonEmptyString(r.id)) errors.push("id: requerido");
  if (!isNonEmptyString(r.session_id)) errors.push("session_id: requerido");
  if (r.user_id !== null && !isNonEmptyString(r.user_id))
    errors.push("user_id: null o string no vacío");
  if (!isIsoDateTime(r.accepted_at)) errors.push("accepted_at: instante ISO 8601 requerido");
  if (!isNonEmptyString(r.disclaimer_version)) errors.push("disclaimer_version: requerida");
  if (!isLanguageCode(r.language)) errors.push("language: código de idioma tipo ISO 639-1");
  return errors.length ? fail(errors) : ok();
}

export interface RecordAcceptanceInput {
  session_id: string;
  language: string;
  /** Opcional; null por defecto (sin login). */
  user_id?: string | null;
}

export interface AcceptanceContext {
  id: string;
  now: string; // ISO 8601
}

export interface RecordAcceptanceResult {
  ok: boolean;
  record?: AcceptanceRecord;
  errors: string[];
}

/**
 * Registra una aceptación. La VERSIÓN se sella desde la constante del servidor
 * (no se confía en el cliente: se acepta la versión vigente). Deny-by-default:
 * si el registro no es válido, no se persiste.
 */
export function recordAcceptance(
  input: RecordAcceptanceInput,
  ctx: AcceptanceContext,
  logPath: string = DEFAULT_ACCEPTANCE_LOG,
): RecordAcceptanceResult {
  const record: AcceptanceRecord = {
    id: ctx.id,
    session_id: input.session_id,
    user_id: input.user_id ?? null,
    accepted_at: ctx.now,
    disclaimer_version: DISCLAIMER_VERSION,
    language: input.language,
  };
  const verdict = validateAcceptance(record);
  if (!verdict.valid) return { ok: false, errors: verdict.errors };

  try {
    const dir = logPath.includes("/") ? logPath.slice(0, logPath.lastIndexOf("/")) : ".";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    return { ok: false, errors: ["No se pudo persistir la aceptación."] };
  }
  return { ok: true, record, errors: [] };
}

/** Lee todas las aceptaciones registradas (admin). Nunca lanza. */
export function readAcceptances(logPath: string = DEFAULT_ACCEPTANCE_LOG): AcceptanceRecord[] {
  try {
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AcceptanceRecord);
  } catch {
    return [];
  }
}
