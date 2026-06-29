/**
 * interaction.ts — Validadores CRUZADOS entre entidades de una misma interacción.
 *
 * Las validaciones por entidad no bastan: hay estados que la constitución
 * prohíbe y que solo se ven mirando la interacción completa
 * (UserQuery ⋈ AdvisorAnswer ⋈ AuditLog). Estos validadores los hacen
 * irrepresentables como "datos válidos":
 *
 *   - Una consulta fuera de alcance no puede tener respuesta de fondo (Regla 8).
 *   - Una consulta con datos faltantes no puede tener respuesta de fondo (Regla 7).
 *   - Un criterio servido que el motor nunca recuperó es una vía de elusión de
 *     la trazabilidad (Regla 16, invariante I2 de safetyGuardrails).
 *
 * El pipeline (F2/F6) debe ejecutar validateInteraction() antes de persistir y
 * de servir. safetyGuardrails los reutilizará como parte de sus invariantes.
 */
import { AdvisorAnswer } from "./advisorAnswer";
import { AuditLog } from "./auditLog";
import { UserQuery } from "./userQuery";
import { ValidationResult, fail, ok } from "./validation";

/**
 * Coherencia pregunta ↔ respuesta (Reglas 7 y 8). Deny-by-default: si la
 * clasificación de la consulta exige repreguntar o rechazar, cualquier otra
 * decisión es inválida.
 */
export function validateAnswerAgainstQuery(
  a: AdvisorAnswer,
  q: UserQuery,
): ValidationResult {
  const errors: string[] = [];

  if (a.query_id !== q.id)
    errors.push(`query_id: la respuesta apunta a "${a.query_id}" pero la consulta es "${q.id}"`);

  if (q.out_of_scope === true && a.decision !== "out_of_scope")
    errors.push(
      `decision: la consulta está fuera de alcance => la única decisión válida es ` +
        `"out_of_scope", no "${a.decision}" (Regla 8)`,
    );

  if (
    q.out_of_scope !== true &&
    Array.isArray(q.missing_facts) &&
    q.missing_facts.length > 0 &&
    a.decision === "answer"
  )
    errors.push(
      "decision: la consulta tiene datos faltantes => no puede haber respuesta de fondo " +
        "sin repreguntar antes (Regla 7)",
    );

  return errors.length ? fail(errors) : ok();
}

/**
 * Coherencia respuesta ↔ registro de auditoría (Reglas 4 y 16). Todo criterio
 * usado en la respuesta debe constar como RECUPERADO y NO DESCARTADO en el
 * AuditLog de la misma interacción.
 */
export function validateAuditConsistency(
  log: AuditLog,
  a: AdvisorAnswer,
): ValidationResult {
  const errors: string[] = [];

  if (log.answer_id !== a.id)
    errors.push(`answer_id: el registro apunta a "${log.answer_id}" pero la respuesta es "${a.id}"`);
  if (log.query_id !== a.query_id)
    errors.push(
      `query_id: el registro apunta a "${log.query_id}" pero la respuesta es de "${a.query_id}"`,
    );

  if (Array.isArray(a.criteria_used) && Array.isArray(log.retrieved_criteria_ids)) {
    const retrieved = new Set(log.retrieved_criteria_ids);
    const rejected = new Set(
      Array.isArray(log.rejected_criteria_ids) ? log.rejected_criteria_ids : [],
    );
    for (const id of a.criteria_used) {
      if (!retrieved.has(id))
        errors.push(
          `criteria_used: el criterio "${id}" se sirvió sin constar como recuperado en el ` +
            "AuditLog — vía de elusión de la trazabilidad (Reglas 4 y 16)",
        );
      if (rejected.has(id))
        errors.push(
          `criteria_used: el criterio "${id}" fue descartado por el motor y aun así se sirvió ` +
            "(Regla 16)",
        );
    }
  }

  return errors.length ? fail(errors) : ok();
}

/**
 * Validación de la interacción completa. Es la que debe ejecutar el pipeline
 * antes de persistir/servir (las validaciones por entidad se ejecutan aparte
 * con validateUserQuery / validateAdvisorAnswer / validateAuditLog, y la de
 * contexto de corpus con validateAnswerAgainstCriteria).
 */
export function validateInteraction(
  q: UserQuery,
  a: AdvisorAnswer,
  log: AuditLog,
): ValidationResult {
  const errors = [
    ...validateAnswerAgainstQuery(a, q).errors,
    ...validateAuditConsistency(log, a).errors,
  ];
  return errors.length ? fail(errors) : ok();
}
