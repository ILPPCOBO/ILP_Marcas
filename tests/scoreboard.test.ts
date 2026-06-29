/**
 * Tests del SCOREBOARD ("Score de alineación con criterios del corpus").
 *
 * Verifican las reglas 1-7 del spec: no se calcula sin criterios aprobados ni con
 * pending; no usa el material del usuario como fuente jurídica; NUNCA lenguaje de
 * probabilidad de ganar; cada factor lleva criterio + fuente; insuficiente si
 * faltan hechos; baja confianza con evidencia ilegible.
 */
import { describe, expect, it } from "vitest";
import {
  computeCaseScoreboard,
  hasScoreboardForbiddenLanguage,
  runCaseScoreboard,
} from "../services/caseScoreboard";
import { extractText } from "../services/extraction";
import { loadApprovedCriteria } from "../services/criteriaRetriever";
import type { UploadedFile } from "../services/models";
import { FIX_CORPUS, FIX_JUDGMENTS } from "./fixtures/corpus";

const CORPUS = FIX_CORPUS;

function caseFile(text: string, opts?: { status?: UploadedFile["extraction_status"]; ftype?: UploadedFile["file_type"] }): UploadedFile {
  const ftype = opts?.ftype ?? "txt";
  const ex = extractText({ file_type: ftype, filename: `m.${ftype}`, text: ftype === "txt" ? text : undefined, base64: ftype === "txt" ? undefined : "AAAA" });
  return {
    id: "upl-1", original_filename: `m.${ftype}`, file_type: ftype, upload_type: "case_material",
    uploaded_at: "2026-06-13T00:00:00Z", uploaded_by: null, session_id: "sess-1",
    extraction_status: opts?.status ?? ex.status, extracted_text: ex.text, summary: "",
    detected_entities: [], detected_legal_topics: [], warnings: ex.warnings,
    source_locations: ex.source_locations, created_at: "2026-06-13T00:00:00Z", updated_at: "2026-06-13T00:00:00Z",
  };
}

const COMPLETE =
  "Mi marca está registrada en España, vendo productos de cosmética; un competidor usa un logo muy parecido y ambas operamos en el mercado español.";

function allText(sb: ReturnType<typeof runCaseScoreboard>): string {
  return [
    ...sb.favorable_factors.map((f) => f.factor),
    ...sb.unfavorable_factors.map((f) => f.factor),
    ...sb.uncertain_factors.map((f) => `${f.factor} ${f.why_it_matters} ${f.what_is_missing}`),
    ...sb.limits,
    sb.disclaimer,
    sb.reason ?? "",
  ].join(" ");
}

describe("scoreboard — caso con criterios aprobados", () => {
  const sb = runCaseScoreboard("riesgo de confusión con mi marca", { files: [caseFile(COMPLETE)], corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });

  it("calcula un score 0-100 de alineación (no de mérito)", () => {
    expect(sb.computable).toBe(true);
    expect(typeof sb.case_fit_score).toBe("number");
    expect(sb.case_fit_score!).toBeGreaterThanOrEqual(0);
    expect(sb.case_fit_score!).toBeLessThanOrEqual(100);
    expect(["bajo", "medio", "alto"]).toContain(sb.score_label);
  });

  it("Regla 13: cada factor favorable/desfavorable conecta criterio + fuente", () => {
    const factors = [...sb.favorable_factors, ...sb.unfavorable_factors];
    expect(factors.length).toBeGreaterThan(0);
    for (const f of factors) {
      expect(f.criterion_id).toBeTruthy();
      expect(f.source_reference).toBeTruthy();
      expect(f.judgment_id).toBeTruthy();
    }
  });

  it("Regla 3 (uso del usuario no es fuente): criteria_used vienen del corpus aprobado", () => {
    const approved = new Set(CORPUS.map((c) => c.id));
    expect(sb.criteria_used.length).toBeGreaterThan(0);
    for (const c of sb.criteria_used) expect(approved.has(c.criterion_id)).toBe(true);
  });

  it("Reglas 9/12: siempre incluye límites + aviso de no asesoramiento", () => {
    expect(sb.limits.some((l) => /no predice/i.test(l))).toBe(true);
    expect(sb.disclaimer.toLowerCase()).toContain("no constituye asesoramiento jurídico");
  });
});

describe("scoreboard — Reglas 7-8/18: nunca probabilidad de ganar", () => {
  it("ningún texto del scoreboard contiene pronóstico/probabilidad", () => {
    const sb = runCaseScoreboard("riesgo de confusión con mi marca", { files: [caseFile(COMPLETE)], corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(hasScoreboardForbiddenLanguage(allText(sb))).toBe(false);
  });
  it("el guardarraíl veta las fórmulas prohibidas", () => {
    for (const bad of ["Tienes 80% de éxito", "Probabilidad de ganar alta", "Vas a perder", "Debe usted demandar", "Probabilidad de éxito media"]) {
      expect(hasScoreboardForbiddenLanguage(bad)).toBe(true);
    }
  });
});

describe("scoreboard — cuándo NO se calcula", () => {
  it("Regla 1: sin criterios aprobados (tema sin corpus) => no score", () => {
    const sb = runCaseScoreboard("Quiero anular la patente registrada por falta de novedad", {
      files: [caseFile("patente registrada, falta de novedad, divulgación previa publicada")],
      corpus: CORPUS, judgmentsById: FIX_JUDGMENTS,
    });
    expect(sb.computable).toBe(false);
    expect(sb.case_fit_score).toBeNull();
  });

  it("fuera de alcance => no score", () => {
    const sb = runCaseScoreboard("Tengo un problema penal de estafa", { files: [caseFile("estafa penal")], corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(sb.computable).toBe(false);
  });

  it("Regla 2: con solo criterios pending => no score (no servible)", () => {
    // corpus con un único criterio NO aprobado (pending_review)
    const fake = {
      ...CORPUS[0]!,
      id: "crit-pending",
      review_status: "pending_review" as const,
      approved: false,
      approved_by: null,
      approved_at: null,
    };
    const sb = runCaseScoreboard("riesgo de confusión con mi marca", { files: [caseFile(COMPLETE)], corpus: [fake], judgmentsById: FIX_JUDGMENTS });
    expect(sb.computable).toBe(false);
  });
});

describe("scoreboard — calidad de datos", () => {
  it("Regla 6: faltan hechos esenciales => insuficiente o no computable", () => {
    const sb = runCaseScoreboard("mi marca", { files: [caseFile("Tengo una marca.")], corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(sb.computable === false || sb.score_label === "insuficiente").toBe(true);
  });

  it("Regla 7: un documento ilegible baja la confianza", () => {
    const sb = runCaseScoreboard(
      "riesgo de confusión con mi marca registrada cosmética competidor mercado español signos",
      { files: [caseFile(COMPLETE), caseFile("", { status: "failed", ftype: "png" })], corpus: CORPUS, judgmentsById: FIX_JUDGMENTS },
    );
    expect(sb.confidence_level).toBe("bajo");
  });
});

describe("scoreboard — computeCaseScoreboard puro (sin orquestación)", () => {
  it("sin criterios => insuficiente + reason", () => {
    const sb = computeCaseScoreboard({
      question: "x",
      scope: { area: "Marcas", topic: "riesgo de confusión", subtopics: [], out_of_scope: false, confidence: "high", reason: "" },
      facts: { case_summary: "", classified_area: null, classified_topic: null, relevant_facts: [], missing_facts: [], evidence_items: [], possible_topics: [], uncertainties: [], extraction_warnings: [] },
      retrieval: { criteria: [], insufficient_criteria: true },
    });
    expect(sb.computable).toBe(false);
    expect(sb.reason).toBeTruthy();
  });
});
