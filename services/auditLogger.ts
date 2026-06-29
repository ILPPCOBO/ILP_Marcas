/**
 * auditLogger — Paso 7 del flujo cerrado (IMPLEMENTADO mínimo, F2).
 *
 * Construye y guarda la trazabilidad de CADA interacción (también repreguntas y
 * rechazos), conforme al modelo AuditLog (F1). La cadena de trazabilidad de la
 * Regla 16 es UserQuery ⋈ AdvisorAnswer ⋈ AuditLog; este módulo produce el
 * AuditLog y lo enlaza por query_id/answer_id.
 *
 * Reglas de CLAUDE.md que aplica:
 *   - Regla 16: trazabilidad de cada respuesta, sin excepciones.
 *   - Minimización de datos: el AuditLog NO guarda PII (la pregunta vive en
 *     UserQuery; aquí solo van ids, decisión y razón).
 *   - Regla 17: la trazabilidad no es opcional. `buildAuditRecord` valida el
 *     registro contra el modelo y lanza si no es conforme; un fallo de registro
 *     debe degradar la salida a rechazo seguro, nunca servir sin traza.
 *
 * Implementación mínima: registro en memoria (suficiente para tests y para el
 * cableado del motor). La persistencia append-only en data/audit/ (JSONL) con
 * política de retención se añadirá con la capa de backend (F6).
 */
import type { AdvisorAnswer, AuditLog } from "./models";
import type { DecisionResult, RetrievalResult } from "./types";
import { validateAuditLog } from "./models";

export interface BuildAuditInput {
  audit_id: string;
  query_id: string;
  answer: AdvisorAnswer;
  retrieval: RetrievalResult;
  decision: DecisionResult;
  /** Señales de seguridad de safetyGuardrails (vacío hasta que exista, F2). */
  safety_flags?: string[];
  created_at: string; // ISO 8601
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Construye el AuditLog de una interacción. `retrieved` = criterios que recuperó
 * el retriever; `rejected` = los recuperados que NO se usaron en la respuesta
 * (rejected ⊆ retrieved, exigido por el modelo). Valida antes de devolver.
 */
export function buildAuditRecord(input: BuildAuditInput): AuditLog {
  const retrieved = unique(input.retrieval.criteria.map((c) => c.id));
  const used = new Set(input.answer.criteria_used);
  const rejected = retrieved.filter((id) => !used.has(id));

  const record: AuditLog = {
    id: input.audit_id,
    query_id: input.query_id,
    answer_id: input.answer.id,
    retrieved_criteria_ids: retrieved,
    rejected_criteria_ids: rejected,
    decision_reason: input.decision.reason,
    safety_flags: unique(input.safety_flags ?? []),
    created_at: input.created_at,
  };

  const verdict = validateAuditLog(record);
  if (!verdict.valid) {
    throw new Error(`auditLogger: registro no conforme al modelo: ${verdict.errors.join("; ")}`);
  }
  return record;
}

/** Sumidero de auditoría. Implementaciones: memoria (tests), JSONL (F6). */
export interface AuditLogger {
  log(record: AuditLog): void;
  readAll(): AuditLog[];
}

/** Registro en memoria, append-only, para tests y cableado del motor. */
export function createInMemoryAuditLogger(): AuditLogger {
  const records: AuditLog[] = [];
  return {
    log(record: AuditLog): void {
      const verdict = validateAuditLog(record);
      if (!verdict.valid) {
        throw new Error(`auditLogger: intento de registrar un AuditLog no conforme: ${verdict.errors.join("; ")}`);
      }
      records.push(record);
    },
    readAll(): AuditLog[] {
      return [...records];
    },
  };
}
