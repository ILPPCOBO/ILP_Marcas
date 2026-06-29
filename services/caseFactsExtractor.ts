/**
 * caseFactsExtractor — Prepara HECHOS del caso del usuario (Case Materials) para
 * compararlos con criterios ya aprobados. NO es fuente jurídica, NO concluye
 * resultado, NO recomienda acciones (Reglas 18 y reglas 1-9 del módulo).
 *
 * Determinista, reutilizando el cerebro cerrado:
 *   - possible_topics  ← classifyScope (léxico cerrado).
 *   - relevant_facts   ← por cada hecho esencial de la checklist cuya SEÑAL aparezca
 *                        en el texto de un documento (o en la consulta), trazado al
 *                        documento/fragmento (Regla 9 del módulo). No inventa: solo
 *                        reporta señales presentes con su localización.
 *   - missing_facts    ← hechos esenciales sin señal detectada.
 *   - evidence_items   ← los archivos aportados (id/filename/tipo/estado).
 *   - uncertainties    ← documentos ilegibles + contradicciones detectables.
 *   - extraction_warnings ← warnings de la extracción.
 *
 * Separación estricta: SOLO procesa upload_type "case_material"; ignora cualquier
 * otro. No tiene ninguna ruta de escritura a processed_criteria/approved_criteria:
 * un material del usuario NO puede crear criterios jurídicos.
 */
import type { SourceLocation, UploadedFile } from "./models";
import { classifyScope, matchesAnyKeyword, normalize } from "./scopeClassifier";
import { getChecklist } from "./missingFactsDetector";
import { hasForbiddenLanguage } from "./answerComposer";

export interface RelevantFact {
  fact_id: string;
  fact_text: string;
  /** De dónde sale el hecho: la descripción del usuario o un documento subido. */
  source_type: "user_description" | "uploaded_document";
  source_document_id: string;
  source_filename: string;
  page_or_location: string;
  confidence: "low" | "medium" | "high";
}

export interface EvidenceItem {
  document_id: string;
  filename: string;
  file_type: string;
  extraction_status: string;
}

export interface CaseFactsResult {
  case_summary: string;
  /** Clasificación del asunto (del léxico cerrado); null si fuera de alcance. */
  classified_area: string | null;
  classified_topic: string | null;
  relevant_facts: RelevantFact[];
  missing_facts: string[];
  evidence_items: EvidenceItem[];
  possible_topics: string[];
  uncertainties: string[];
  extraction_warnings: string[];
}

export interface CaseFactsInput {
  question: string;
  /** Archivos del caso (se filtran a upload_type "case_material"). */
  files: UploadedFile[];
}

interface FactSource {
  id: string;
  filename: string;
  text: string;
  locs: SourceLocation[];
}

function deaccentLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Localiza la primera señal coincidente y la mapea a página/sección/fragmento. */
function locate(signals: string[], src: FactSource): string {
  if (src.id === "user-input") return "consulta del usuario";
  if (!src.locs.length) return "documento completo";
  const hay = deaccentLower(src.text);
  let idx = -1;
  for (const s of signals) {
    const needle = deaccentLower(s.replace(/\*/g, "").split(/\s+/)[0] ?? "");
    if (!needle) continue;
    const at = hay.indexOf(needle);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  if (idx < 0) return "documento completo";
  const frag = src.locs.find(
    (l) => l.char_start !== null && l.char_end !== null && idx >= l.char_start && idx < l.char_end,
  );
  if (!frag) return "documento completo";
  if (frag.page !== null) return `página ${frag.page}`;
  if (frag.section !== null) return `sección "${frag.section}"`;
  return `fragmento ${frag.fragment_id}`;
}

export function extractCaseFacts(input: CaseFactsInput): CaseFactsResult {
  const all = input.files ?? [];
  const files = all.filter((f) => f.upload_type === "case_material");
  const droppedNonCase = all.length - files.length;

  const extraction_warnings: string[] = [];
  const uncertainties: string[] = [];
  if (droppedNonCase > 0) {
    // Separación: lo que no es material del caso no se procesa aquí.
    extraction_warnings.push(`Se ignoraron ${droppedNonCase} archivo(s) que no son material del caso.`);
  }
  for (const f of files) {
    for (const w of f.warnings) extraction_warnings.push(`[${f.original_filename}] ${w}`);
    if (f.extraction_status !== "completed") {
      uncertainties.push(`No se pudo leer con fiabilidad "${f.original_filename}" (estado: ${f.extraction_status}).`);
    }
  }

  const readable = files.filter((f) => f.extraction_status === "completed");
  const combined = [input.question ?? "", ...readable.map((f) => f.extracted_text)].join("\n");
  const scope = classifyScope(combined);
  const possible_topics: string[] = scope.out_of_scope
    ? []
    : [`${scope.area} / ${scope.topic ?? "(tema no determinado)"}`];

  const sources: FactSource[] = [
    { id: "user-input", filename: "consulta del usuario", text: input.question ?? "", locs: [] },
    ...readable.map((f) => ({
      id: f.id,
      filename: f.original_filename,
      text: f.extracted_text,
      locs: f.source_locations,
    })),
  ];

  const relevant_facts: RelevantFact[] = [];
  const missing_facts: string[] = [];
  const checklist = !scope.out_of_scope && scope.topic ? getChecklist(scope.area, scope.topic) : [];
  let factSeq = 0;

  for (const fact of checklist) {
    let found = false;
    for (const src of sources) {
      const tokens = normalize(src.text);
      const matchedSignals = fact.signals.filter((s) => matchesAnyKeyword([s], tokens));
      if (matchedSignals.length === 0) continue;
      found = true;
      factSeq += 1;
      relevant_facts.push({
        fact_id: `fact-${String(factSeq).padStart(3, "0")}`,
        fact_text: fact.fact,
        source_type: src.id === "user-input" ? "user_description" : "uploaded_document",
        source_document_id: src.id,
        source_filename: src.filename,
        page_or_location: locate(matchedSignals, src),
        // Hechos del usuario sin verificar: confianza acotada (nunca "high").
        confidence: matchedSignals.length >= 2 ? "medium" : "low",
      });
    }
    if (!found) missing_facts.push(fact.question);
  }

  // Contradicción representativa (determinista): registro afirmado y negado a la vez.
  const tk = normalize(sources.map((s) => s.text).join("\n"));
  if (matchesAnyKeyword(["registrad*", "registro"], tk) && matchesAnyKeyword(["sin registrar"], tk)) {
    uncertainties.push(
      "Posible contradicción sobre el registro: aparecen indicios de 'registrada' y de 'sin registrar'.",
    );
  }

  const evidence_items: EvidenceItem[] = files.map((f) => ({
    document_id: f.id,
    filename: f.original_filename,
    file_type: f.file_type,
    extraction_status: f.extraction_status,
  }));

  // Resumen DETERMINISTA, sin conclusiones de resultado ni recomendaciones.
  const case_summary = scope.out_of_scope
    ? `Los materiales aportados (${files.length} documento/s) no encajan en una materia cubierta por el ` +
      `corpus, por lo que no se preparan hechos jurídicos. Esto no es una valoración del caso.`
    : `Materia probable: ${possible_topics[0]}. ${files.length} documento/s aportado/s; ` +
      `${relevant_facts.length} indicio/s de hecho detectado/s y ${missing_facts.length} dato/s esencial/es ` +
      `pendiente/s. Es preparación factual para comparar con criterios aprobados; no anticipa ningún resultado.`;

  // Defensa Regla 18: el resumen jamás contiene pronóstico ni recomendación.
  if (hasForbiddenLanguage(case_summary)) {
    return {
      case_summary: "Resumen no disponible por una comprobación de seguridad (deny-by-default).",
      classified_area: scope.out_of_scope ? null : scope.area,
      classified_topic: scope.topic,
      relevant_facts: [],
      missing_facts,
      evidence_items,
      possible_topics,
      uncertainties,
      extraction_warnings,
    };
  }

  return {
    case_summary,
    classified_area: scope.out_of_scope ? null : scope.area,
    classified_topic: scope.topic,
    relevant_facts,
    missing_facts,
    evidence_items,
    possible_topics,
    uncertainties,
    extraction_warnings,
  };
}
