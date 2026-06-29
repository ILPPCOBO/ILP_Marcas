/**
 * services/models — Modelos de datos canónicos del sistema (Fase F1).
 *
 * Una entidad por archivo, cada una con su interfaz y su validateX().
 * Espejos JSON Schema (formato de persistencia) en data/schemas/.
 * Ejemplos ficticios en data/schemas/examples/ (jamás servibles).
 */
export * from "./validation";
export * from "./judgment";
export * from "./legalCriterion";
export * from "./userQuery";
export * from "./advisorAnswer";
export * from "./auditLog";
export * from "./interaction";
export * from "./catalogQuestion";
export * from "./uploadedFile";
