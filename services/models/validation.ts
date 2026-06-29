/**
 * validation.ts — Utilidades compartidas de validación (puras, sin dependencias).
 *
 * Convención del proyecto: cada modelo expone validateX(value): ValidationResult.
 * Las validaciones son DENY-BY-DEFAULT (Regla 17): ante un valor dudoso, el
 * resultado es inválido — y NUNCA una excepción: un validador que lanza ante
 * datos malformados no es un rechazo seguro, es un crash.
 *
 * Paridad con los JSON Schema (data/schemas/): los validadores TS son la mitad
 * ESTRICTA de la puerta — rechazan strings de solo espacios (trim) y fechas de
 * calendario imposibles, cosas que JSON Schema no expresa. La puerta de
 * lectura/escritura de data/ son AMBOS espejos, no uno de los dos.
 *
 * Cuando exista base de datos real (migración prevista), estas mismas reglas
 * deben convertirse en restricciones del esquema (CHECK / NOT NULL / enums),
 * no quedarse solo en código.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

export function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Fecha de calendario ISO 8601 (YYYY-MM-DD) REAL: rechaza 2026-02-31. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Instante ISO 8601 con zona, p. ej. 2026-06-11T09:30:00Z. */
export function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return false;
  return !Number.isNaN(new Date(v).getTime());
}

/** Array de strings no vacíos (admite array vacío). */
export function isArrayOfNonEmptyStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => isNonEmptyString(x));
}

/** true si el array no contiene duplicados. */
export function hasUniqueStrings(v: readonly string[]): boolean {
  return new Set(v).size === v.length;
}

/** Código de idioma tipo ISO 639-1 ("es", "en") con subetiqueta opcional ("es-ES"). */
export function isLanguageCode(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(v);
}

/**
 * Claves no declaradas en el modelo (paridad con additionalProperties: false de
 * los JSON Schema). Un objeto con campos colados no pasa la validación TS.
 */
export function unknownKeys(obj: object, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}
