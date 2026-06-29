/**
 * judgmentRegistry — Registro de resoluciones para VERIFICAR procedencia de citas.
 *
 * Carga el índice de resoluciones (Judgment) del corpus para que safetyGuardrails
 * pueda comprobar que cada cita criterio → resolución apunta a una resolución que
 * EXISTE realmente (Reglas 4 y 9: una cita a una resolución inexistente es una
 * cita fabricada).
 *
 * IMPORTANTE (Regla 13): esto NO viola "las sentencias originales no se usan
 * directamente para responder". Aquí solo se leen METADATOS de identificación
 * (id, número, fecha…) para VERIFICAR la procedencia de las citas; el contenido
 * de la respuesta procede exclusivamente de los criterios aprobados. El texto de
 * las resoluciones nunca se sirve al usuario.
 *
 * Deny-by-default: archivo ausente, JSON malformado o entrada inválida => se
 * descarta; nunca lanza.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Judgment } from "./models";
import { validateJudgment } from "./models";

/** Carpeta de resoluciones originales (solo se leen sus metadatos de id). */
export const SOURCE_JUDGMENTS_DIR = "data/source_judgments";

/**
 * Devuelve el registro id → Judgment de las resoluciones válidas del corpus.
 * Acepta el envoltorio {_warning, dataset, judgments:[...]} o un array a secas.
 */
export function loadJudgmentRegistry(
  dir: string = SOURCE_JUDGMENTS_DIR,
): Map<string, Judgment> {
  const registry = new Map<string, Judgment>();
  try {
    if (!existsSync(dir)) return registry;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(join(dir, name), "utf-8"));
        const items: unknown[] = Array.isArray(raw)
          ? raw
          : typeof raw === "object" &&
              raw !== null &&
              Array.isArray((raw as { judgments?: unknown }).judgments)
            ? ((raw as { judgments: unknown[] }).judgments)
            : [];
        for (const item of items) {
          const j = item as Judgment;
          if (validateJudgment(j).valid) registry.set(j.id, j);
        }
      } catch {
        // Archivo ilegible => se ignora (deny-by-default).
      }
    }
  } catch {
    return registry;
  }
  return registry;
}
