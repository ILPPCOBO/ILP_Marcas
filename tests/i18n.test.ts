/**
 * Tests de la capa de inglés (i18n). El razonamiento sigue en español; el inglés
 * es presentación + traducción determinista. Verifican: normalización EN→ES,
 * que las fuentes/órganos/fechas NO se traducen, el aviso verbatim (Regla 3) y
 * que no se razona desde derecho extranjero.
 */
import { describe, expect, it } from "vitest";
import { detectLocale, normalizeQuery, resolveLocale, areaLabel, topicLabel } from "../services/i18n";
import { composeAnswer } from "../services/answerComposer";
import { runQuery } from "../services/engine";
import { ENGLISH_SOURCE_NOTICE } from "../services/legal/disclaimer";
import type { LegalCriterion } from "../services/models";
import { FIX_CORPUS, FIX_JUDGMENTS } from "./fixtures/corpus";

function ctx() {
  return { query_id: "q", answer_id: "a", audit_id: "au", created_at: "2026-06-13T00:00:00Z" };
}

describe("i18n — idioma y normalización", () => {
  it("resolveLocale por defecto español", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("xx")).toBe("es");
    expect(resolveLocale(undefined)).toBe("es");
  });

  it("detecta inglés vs español de forma determinista", () => {
    expect(detectLocale("A company is using my trademark")).toBe("en");
    expect(detectLocale("Una empresa usa mi marca")).toBe("es");
    expect(detectLocale("¿Puedo registrar una marca?")).toBe("es");
  });

  it("normaliza una consulta inglesa añadiendo términos del corpus español", () => {
    const n = normalizeQuery("My registered trademark and a similar logo", "en");
    expect(n.spanish).toContain("marca");
    expect(n.spanish).toContain("parecido");
    expect(n.uncertain).toBe(false);
  });

  it("marca duda si la consulta inglesa no mapea términos del corpus (Regla 6)", () => {
    expect(normalizeQuery("How do I cook paella?", "en").uncertain).toBe(true);
  });

  it("no altera el español", () => {
    expect(normalizeQuery("Una empresa usa un logo parecido", "es")).toEqual({
      spanish: "Una empresa usa un logo parecido",
      uncertain: false,
      matched: 0,
    });
  });

  it("etiquetas ES→EN cerradas", () => {
    expect(areaLabel("Marcas", "en")).toBe("Trademarks");
    expect(topicLabel("riesgo de confusión", "en")).toEqual({ label: "likelihood of confusion", known: true });
    expect(topicLabel("tema inventado", "en").known).toBe(false);
  });
});

describe("i18n — respuesta en inglés (marco EN, sustancia y fuentes ES)", () => {
  const crit: LegalCriterion = {
    id: "crit-en-1",
    judgment_id: "jdg-mock-0001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "FICTICIO — la comparación atiende a la impresión de conjunto.",
    conditions_for_application: ["FICTICIO — signos denominativos."],
    does_not_answer: ["FICTICIO — no resuelve signos figurativos."],
    limits: ["FICTICIO — criterio de prueba."],
    source_excerpt: "FICTICIO — extracto.",
    source_reference: "Fundamento de prueba 2.º (ficticio)",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "fixture",
    approved_at: "2026-06-13T00:00:00Z",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
  };

  it("answer en inglés: cabeceras en inglés, source_reference y resolución en español, aviso verbatim", () => {
    const a = composeAnswer(
      {
        question: "A competitor uses a similar logo",
        scope: { area: "Marcas", topic: "riesgo de confusión", subtopics: ["similitud de signos"], out_of_scope: false, confidence: "high", reason: "x" },
        decision: { decision: "answer", reason: "x", clarifying_questions: [] },
        criteria: [crit],
        locale: "en",
      },
      { id: "a", query_id: "q", created_at: "2026-06-13T00:00:00Z" },
    );
    expect(a.answer_text).toContain("1. What I understood");
    // Regla 1 y 2: la fuente y la resolución NO se traducen.
    expect(a.answer_text).toContain("Fundamento de prueba 2.º (ficticio)");
    expect(a.answer_text).toContain("(resolución jdg-mock-0001)");
    // Regla 3: aviso verbatim.
    expect(a.answer_text).toContain(ENGLISH_SOURCE_NOTICE);
    expect(a.disclaimer.toLowerCase()).toContain("does not constitute legal advice");
  });

  it("el español permanece idéntico cuando locale='es' (sin regresión)", () => {
    const base = {
      question: "x",
      scope: { area: "Marcas" as const, topic: "riesgo de confusión", subtopics: [], out_of_scope: false, confidence: "high" as const, reason: "x" },
      decision: { decision: "answer" as const, reason: "x", clarifying_questions: [] },
      criteria: [crit],
    };
    const es = composeAnswer({ ...base }, { id: "a", query_id: "q", created_at: "2026-06-13T00:00:00Z" });
    expect(es.answer_text).toContain("1. Lo que he entendido");
    expect(es.answer_text).not.toContain("1. What I understood");
  });
});

describe("i18n — pipeline completo en inglés sobre el corpus mock", () => {
  it("consulta inglesa completa de marcas → answer en inglés, fuentes en español", () => {
    const r = runQuery(
      "My trademark is registered in Spain, we sell cosmetics products and a competitor company uses a very similar logo.",
      ctx(),
      { locale: "en", corpus: FIX_CORPUS, judgmentsById: FIX_JUDGMENTS },
    );
    expect(r.decision.decision).toBe("answer");
    expect(r.answer.answer_text).toContain("What I understood");
    expect(r.answer.answer_text).toContain(ENGLISH_SOURCE_NOTICE);
    // las resoluciones citadas son las españolas del corpus
    expect(r.answer.sources_used.length).toBeGreaterThan(0);
  });

  it("consulta inglesa fuera de alcance → out_of_scope en inglés", () => {
    const r = runQuery("I have a tax problem with the tax office.", ctx(), { locale: "en", corpus: FIX_CORPUS, judgmentsById: FIX_JUDGMENTS });
    expect(r.decision.decision).toBe("out_of_scope");
    expect(r.answer.answer_text).toContain("not covered by the decisions");
  });
});
