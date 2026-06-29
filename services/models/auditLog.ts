/**
 * AuditLog — Trazabilidad de cada interacción (Regla 16).
 *
 * La trazabilidad completa que exige la Regla 16 (pregunta original, criterios
 * usados, fuentes, decisión y límites) se reconstruye con la cadena:
 *
 *   UserQuery (pregunta) ⋈ AdvisorAnswer (decisión, criterios, fuentes, límites)
 *                        ⋈ AuditLog (qué recuperó y descartó el motor, y por qué)
 *
 * AuditLog aporta lo que las otras dos entidades no guardan: el "porqué" interno
 * del motor — qué criterios se recuperaron, cuáles se descartaron y qué señales
 * de seguridad saltaron.
 *
 * Reglas de CLAUDE.md que afectan a esta entidad:
 *   - Regla 16: TODA interacción genera exactamente un AuditLog, también las
 *     repreguntas y los rechazos. Sin registro, no se sirve la respuesta
 *     (auditLogger: fallo de registro => rechazo seguro).
 *   - Minimización de datos: sin PII (la pregunta vive en UserQuery).
 *
 * Espejo JSON Schema: data/schemas/audit_log.schema.json
 */
import {
  ValidationResult,
  fail,
  hasUniqueStrings,
  isArrayOfNonEmptyStrings,
  isIsoDateTime,
  isNonEmptyString,
  ok,
  unknownKeys,
} from "./validation";

export interface AuditLog {
  id: string;
  /** UserQuery de la interacción (Regla 16). */
  query_id: string;
  /** AdvisorAnswer producida (completa la cadena de trazabilidad). */
  answer_id: string;
  /** Criterios que el retriever recuperó como candidatos (sin duplicados). */
  retrieved_criteria_ids: string[];
  /**
   * SUBCONJUNTO de retrieved_criteria_ids que fue descartado (relevancia
   * insuficiente, veto de guardarraíl...). Semántica: descartado ⊆ recuperado;
   * un ID rechazado que nunca se recuperó es un estado incoherente.
   */
  rejected_criteria_ids: string[];
  /** Justificación auditable de la decisión del motor. */
  decision_reason: string;
  /** Señales de seguridad activadas (códigos de safetyGuardrails; vacío si ninguna). */
  safety_flags: string[];
  created_at: string;
}

const AUDIT_KEYS: readonly string[] = [
  "id",
  "query_id",
  "answer_id",
  "retrieved_criteria_ids",
  "rejected_criteria_ids",
  "decision_reason",
  "safety_flags",
  "created_at",
] as const;

export function validateAuditLog(l: AuditLog): ValidationResult {
  const errors: string[] = [];

  if (typeof l !== "object" || l === null) return fail(["AuditLog: debe ser un objeto"]);
  for (const k of unknownKeys(l, AUDIT_KEYS)) errors.push(`propiedad desconocida: "${k}"`);

  if (!isNonEmptyString(l.id)) errors.push("id: requerido y no vacío");
  if (!isNonEmptyString(l.query_id)) errors.push("query_id: requerido (Regla 16)");
  if (!isNonEmptyString(l.answer_id)) errors.push("answer_id: requerido (Regla 16)");

  const retrievedOk = isArrayOfNonEmptyStrings(l.retrieved_criteria_ids);
  if (!retrievedOk) errors.push("retrieved_criteria_ids: array de IDs no vacíos");
  else if (!hasUniqueStrings(l.retrieved_criteria_ids))
    errors.push("retrieved_criteria_ids: sin duplicados");

  const rejectedOk = isArrayOfNonEmptyStrings(l.rejected_criteria_ids);
  if (!rejectedOk) errors.push("rejected_criteria_ids: array de IDs no vacíos");
  else if (!hasUniqueStrings(l.rejected_criteria_ids))
    errors.push("rejected_criteria_ids: sin duplicados");

  if (retrievedOk && rejectedOk) {
    const retrieved = new Set(l.retrieved_criteria_ids);
    for (const id of l.rejected_criteria_ids) {
      if (!retrieved.has(id))
        errors.push(
          `rejected_criteria_ids: "${id}" nunca fue recuperado — descartado ⊆ recuperado (Regla 16)`,
        );
    }
  }

  if (!isNonEmptyString(l.decision_reason))
    errors.push("decision_reason: requerido — la decisión del motor siempre se justifica (Regla 16)");
  if (!isArrayOfNonEmptyStrings(l.safety_flags))
    errors.push("safety_flags: array de strings no vacíos (vacío si ninguna señal)");
  else if (!hasUniqueStrings(l.safety_flags)) errors.push("safety_flags: sin duplicados");
  if (!isIsoDateTime(l.created_at)) errors.push("created_at: instante ISO 8601 requerido");

  return errors.length ? fail(errors) : ok();
}
