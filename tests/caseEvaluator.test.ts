/**
 * Tests del EVALUADOR DE CASO (Case Fit Grade). Verifican los 14 puntos del spec:
 * documentos del usuario solo como hechos (nunca fuente jurídica ni criterios),
 * solo criterios aprobados, nunca pending, NUNCA lenguaje de probabilidad de
 * ganar, factores con criterio+fuente+evidencia, condiciones para no calificar.
 */
import { describe, expect, it } from "vitest";
import { asksForPrediction, runCaseEvaluation } from "../services/caseEvaluator";
import { hasScoreboardForbiddenLanguage } from "../services/caseScoreboard";
import { extractText } from "../services/extraction";
import { loadApprovedCriteria } from "../services/criteriaRetriever";
import type { UploadedFile } from "../services/models";
import { FIX_CORPUS, FIX_JUDGMENTS } from "./fixtures/corpus";

const CORPUS = FIX_CORPUS;
const COMPLETE =
  "Mi marca está registrada en España, vendo productos de cosmética; un competidor usa un logo muy parecido y ambas operamos en el mercado español.";

function caseFile(text: string, opts?: { status?: UploadedFile["extraction_status"]; ftype?: UploadedFile["file_type"] }): UploadedFile {
  const ftype = opts?.ftype ?? "txt";
  const ex = extractText({ file_type: ftype, filename: `m.${ftype}`, text: ftype === "txt" ? text : undefined, base64: ftype === "txt" ? undefined : "AAAA" });
  return {
    id: "upl-1", case_id: "case-1", original_filename: `m.${ftype}`, file_type: ftype, upload_type: "case_material",
    uploaded_at: "2026-06-13T00:00:00Z", uploaded_by: null, session_id: "sess-1",
    extraction_status: opts?.status ?? ex.status, extracted_text: ex.text, summary: "",
    detected_entities: [], detected_legal_topics: [], warnings: ex.warnings,
    source_locations: ex.source_locations, created_at: "2026-06-13T00:00:00Z", updated_at: "2026-06-13T00:00:00Z",
  };
}
function allText(ev: ReturnType<typeof runCaseEvaluation>): string {
  return [
    ...ev.favorable_factors.flatMap((f) => [f.factor, f.explicacion]),
    ...ev.unfavorable_factors.flatMap((f) => [f.factor, f.explicacion]),
    ...ev.uncertain_factors.flatMap((u) => [u.factor, u.why_it_matters, u.what_is_missing]),
    ...ev.limits, ev.disclaimer, ev.reason ?? "", ev.case_summary,
  ].join(" ");
}

describe("evaluador — caso con criterios aprobados", () => {
  const ev = runCaseEvaluation({ description: COMPLETE, asunto_hint: "Marcas", files: [caseFile(COMPLETE)] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
  it("genera una calificación A-D con score y confianza", () => {
    expect(["A", "B", "C", "D"]).toContain(ev.case_fit_grade);
    expect(typeof ev.case_fit_score).toBe("number");
    expect(["baja", "media", "alta"]).toContain(ev.confidence_level);
  });
  it("solo usa criterios APROBADOS del corpus (docs del usuario no son fuente)", () => {
    const approved = new Set(CORPUS.map((c) => c.id));
    expect(ev.criteria_used.length).toBeGreaterThan(0);
    for (const c of ev.criteria_used) expect(approved.has(c.criterion_id)).toBe(true);
  });
  it("cada factor favorable tiene criterio + fuente + explicación + evidencia", () => {
    for (const f of ev.favorable_factors) {
      expect(f.criterion_id && f.source_reference && f.judgment_id && f.explicacion && f.evidence).toBeTruthy();
    }
  });
  it("cada factor desfavorable tiene criterio + fuente + explicación", () => {
    for (const f of ev.unfavorable_factors) {
      expect(f.criterion_id && f.source_reference && f.judgment_id && f.explicacion).toBeTruthy();
    }
  });
  it("incluye límites + aviso, y NO contiene pronóstico (Regla 18)", () => {
    expect(ev.limits.some((l) => /no predice/i.test(l))).toBe(true);
    expect(ev.disclaimer.toLowerCase()).toContain("no constituye asesoramiento jurídico");
    expect(hasScoreboardForbiddenLanguage(allText(ev))).toBe(false);
  });
});

describe("evaluador — condiciones para NO calificar", () => {
  it("el usuario pide una predicción => no califica + explica (condición 6, 13)", () => {
    const ev = runCaseEvaluation({ description: "Mi logo se parece, ¿voy a ganar el juicio?", files: [] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(ev.case_fit_grade).toBe("insuficiente");
    expect(ev.case_fit_score).toBeNull();
    expect(ev.reason).toMatch(/predicc/i);
  });
  it("fuera del corpus => insuficiente + motivo", () => {
    const ev = runCaseEvaluation({ description: "Tengo un problema penal de estafa", files: [] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(ev.case_fit_grade).toBe("insuficiente");
    expect(ev.reason).toBeTruthy();
  });
  it("solo criterios pending => no califica", () => {
    const fake = { ...CORPUS[0]!, id: "crit-pend", review_status: "pending_review" as const, approved: false, approved_by: null, approved_at: null };
    const ev = runCaseEvaluation({ description: COMPLETE, files: [caseFile(COMPLETE)] }, { corpus: [fake], judgmentsById: FIX_JUDGMENTS });
    expect(ev.case_fit_grade).toBe("insuficiente");
  });
  it("faltan hechos esenciales => insuficiente", () => {
    const ev = runCaseEvaluation({ description: "Tengo una marca.", asunto_hint: "Marcas", files: [] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(ev.case_fit_grade).toBe("insuficiente");
  });
  it("documento ilegible => baja confianza", () => {
    const ev = runCaseEvaluation(
      { description: COMPLETE + " signos territorio", files: [caseFile(COMPLETE), caseFile("", { status: "failed", ftype: "png" })] },
      { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS },
    );
    expect(ev.confidence_level === "baja" || ev.case_fit_grade === "insuficiente").toBe(true);
  });
});

describe("asksForPrediction", () => {
  it("detecta peticiones de predicción de victoria", () => {
    for (const q of ["¿voy a ganar?", "qué probabilidad tengo de ganar", "¿gano el juicio?", "me conviene demandar"]) {
      expect(asksForPrediction(q)).toBe(true);
    }
  });
  it("detecta conjugaciones (futuro/condicional/subjuntivo) — huecos de auditoría", () => {
    for (const q of ["¿ganaremos el caso?", "¿ganará mi demanda?", "ganaría con estos hechos", "dime si ganaré", "¿podrías ganar?", "mis perspectivas de éxito"]) {
      expect(asksForPrediction(q)).toBe(true);
    }
  });
  it("no bloquea una descripción de hechos normal", () => {
    expect(asksForPrediction("Mi marca está registrada y un competidor usa un logo parecido")).toBe(false);
    expect(asksForPrediction("La empresa ganadera registró el logo del toro")).toBe(false);
  });
});

describe("evaluador — decision + blindaje de asunto_hint (auditoría)", () => {
  it("caso calificable => decision 'evaluate_case'", () => {
    const ev = runCaseEvaluation({ description: COMPLETE, asunto_hint: "Marcas", files: [caseFile(COMPLETE)] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    if (ev.case_fit_grade !== "insuficiente") expect(ev.decision).toBe("evaluate_case");
  });
  it("no calificable => decision 'cannot_evaluate_case'", () => {
    const ev = runCaseEvaluation({ description: "Tengo un problema penal de estafa", files: [] }, { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(ev.decision).toBe("cannot_evaluate_case");
  });
  it("BLOCKER: predicción colada en asunto_hint NO evalúa (no evade Regla 18)", () => {
    const ev = runCaseEvaluation(
      { description: COMPLETE, asunto_hint: "¿Voy a ganar el juicio?", files: [caseFile(COMPLETE)] },
      { corpus: CORPUS, judgmentsById: FIX_JUDGMENTS },
    );
    expect(ev.decision).toBe("cannot_evaluate_case");
    expect(ev.case_fit_grade).toBe("insuficiente");
    expect(ev.case_fit_score).toBeNull();
  });
});
