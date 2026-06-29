/**
 * criteriaRetriever — Paso 4 del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Recupera criterios jurídicos relevantes para el área/tema/subtemas
 * clasificados, EXCLUSIVAMENTE desde data/approved_criteria/ y EXCLUSIVAMENTE
 * criterios servibles (aprobados por revisión humana).
 *
 * Reglas de CLAUDE.md que aplica:
 *   - Regla 1: solo la base de conocimiento interna (un directorio local).
 *   - Regla 2: sin internet — únicamente lectura de archivos locales.
 *   - Regla 3 / §6: sin conocimiento del modelo — coincidencia exacta y
 *     determinista de claves area/topic/subtopic; nada de juicio libre.
 *   - Regla 5: solo criterios con la puerta isServable() superada. DEFENSA EN
 *     PROFUNDIDAD: aunque esta carpeta solo debería contener aprobados, cada
 *     criterio se valida (validateLegalCriterion) y se filtra con isServable —
 *     un pending_review, rejected, approved:false o estado incoherente que se
 *     colara en la carpeta NUNCA se devuelve (Reglas 13 y 14).
 *   - Regla 6: sin criterios suficientes => criteria: [] e
 *     insufficient_criteria: true. Jamás se rellena con nada.
 *   - Regla 17: cualquier error (carpeta ausente, JSON malformado, criterio
 *     inválido) degrada a "no hay criterios", nunca a una excepción ni a
 *     resultados dudosos.
 *
 * Entrada: { area, topic, subtopics } — el ScopeResult del clasificador puede
 * pasarse tal cual (subconjunto estructural). Los nombres visibles se traducen
 * a claves del corpus con los puentes del clasificador (scopeAreaToLegalArea,
 * toCorpusTopicKey).
 *
 * Salida: { criteria, insufficient_criteria }. Los criterios devueltos son
 * objetos LegalCriterion COMPLETOS (superconjunto de los campos del contrato:
 * id, criterion_text, source_reference, limits…) porque el answerComposer
 * necesita judgment_id y source_excerpt para las citas (Regla 9).
 *
 * Orden de resultados (determinista): primero los criterios cuyo subtopic
 * coincide con algún subtema consultado, después el resto del mismo tema;
 * a igualdad, por id ascendente.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LegalCriterion, RetrievalQuery, RetrievalResult } from "./types";
import { isServable, validateLegalCriterion } from "./models";
import { scopeAreaToLegalArea, toCorpusTopicKey } from "./scopeClassifier";

/** Única carpeta del corpus consultable por el motor (Reglas 1, 5 y 13). */
export const APPROVED_CRITERIA_DIR = "data/approved_criteria";

/** Umbral mínimo de criterios para considerar que hay cobertura (Regla 6). */
const MIN_RESULTS = 1;

/**
 * Carga los criterios de data/approved_criteria/ (todos los .json, en orden
 * alfabético estable). Acepta el envoltorio de colección
 * {_warning, dataset, criteria: [...]} o un array a secas.
 *
 * NUNCA lanza: carpeta ausente, archivo malformado o criterio que no valida
 * contra el modelo => se descarta (deny-by-default: lo inválido no se carga).
 */
export function loadApprovedCriteria(dir: string = APPROVED_CRITERIA_DIR): LegalCriterion[] {
  try {
    if (!existsSync(dir)) return [];
    const out: LegalCriterion[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(join(dir, name), "utf-8"));
        const items: unknown[] = Array.isArray(raw)
          ? raw
          : typeof raw === "object" &&
              raw !== null &&
              Array.isArray((raw as { criteria?: unknown }).criteria)
            ? ((raw as { criteria: unknown[] }).criteria)
            : [];
        for (const item of items) {
          const c = item as LegalCriterion;
          if (validateLegalCriterion(c).valid) out.push(c);
          // Criterio inválido => descartado. La salud del corpus se revisará
          // con herramientas de admin, nunca sirviendo material dudoso.
        }
      } catch {
        // Archivo ilegible o JSON malformado => se ignora (Regla 17).
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Recuperación determinista por claves cerradas. `corpus` es inyectable para
 * tests; por defecto se carga de data/approved_criteria/.
 */
export function retrieveApprovedCriteria(
  query: RetrievalQuery,
  corpus: LegalCriterion[] = loadApprovedCriteria(),
  judgmentIds?: ReadonlySet<string>,
): RetrievalResult {
  const legalArea = scopeAreaToLegalArea(query.area);

  // Fuera de alcance, área desconocida o tema sin concretar => no hay nada que
  // buscar; el motor rechazará o repreguntará (Reglas 6-8, deny-by-default).
  if (legalArea === null || query.topic === null) {
    return { criteria: [], insufficient_criteria: true };
  }

  const topicKey = toCorpusTopicKey(query.topic);
  const subtopicKeys = new Set(
    (Array.isArray(query.subtopics) ? query.subtopics : []).map(toCorpusTopicKey),
  );

  // PUERTA DURA (Regla 5): isServable como filtro, no como preferencia. Defensa
  // en profundidad (Regla 9): si se aporta el registro de resoluciones, se exige
  // además que el judgment_id del criterio exista en él (un criterio aprobado
  // colado con una resolución inexistente NO se recupera, no solo se veta luego).
  const matched = corpus.filter(
    (c) =>
      isServable(c) &&
      c.area === legalArea &&
      c.topic === topicKey &&
      (judgmentIds === undefined || judgmentIds.has(c.judgment_id)),
  );

  matched.sort((a, b) => {
    const sa = a.subtopic !== null && subtopicKeys.has(a.subtopic) ? 1 : 0;
    const sb = b.subtopic !== null && subtopicKeys.has(b.subtopic) ? 1 : 0;
    if (sa !== sb) return sb - sa; // coincidencia de subtema primero
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // estable por id
  });

  return { criteria: matched, insufficient_criteria: matched.length < MIN_RESULTS };
}
