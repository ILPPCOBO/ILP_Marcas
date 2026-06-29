/**
 * Tests del answerComposer (F2). Las cuatro decisiones con su formato, las
 * reglas de prudencia/trazabilidad (Reglas 4, 9, 10, 11-12) y la garantía de
 * que el AdvisorAnswer emitido es siempre conforme al modelo F1.
 */
import { describe, expect, it } from "vitest";
import { composeAnswer, DISCLAIMER } from "../services/answerComposer";
import type { ComposeInput, ComposeMeta } from "../services/answerComposer";
import { validateAdvisorAnswer } from "../services/models";
import type {
  DecisionResult,
  LegalCriterion,
  ScopeResult,
} from "../services/types";

const META: ComposeMeta = {
  id: "ans-test-0001",
  query_id: "qry-test-0001",
  created_at: "2026-06-13T00:00:00Z",
};

function makeScope(over: Partial<ScopeResult>): ScopeResult {
  return {
    area: "Marcas",
    topic: "riesgo de confusión",
    subtopics: ["similitud de signos"],
    out_of_scope: false,
    confidence: "medium",
    reason: "scope sintético",
    ...over,
  };
}

function makeDecision(over: Partial<DecisionResult>): DecisionResult {
  return { decision: "answer", reason: "sintético", clarifying_questions: [], ...over };
}

function makeCriterion(over: Partial<LegalCriterion>): LegalCriterion {
  return {
    id: "crit-fix-0001",
    judgment_id: "jdg-fix-0001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "FICTICIO (fixture) — la comparación atiende a la impresión de conjunto.",
    conditions_for_application: ["FICTICIO — ambos signos son denominativos."],
    does_not_answer: ["FICTICIO — no resuelve signos figurativos."],
    limits: ["FICTICIO — criterio de prueba sin valor jurídico."],
    source_excerpt: "FICTICIO — extracto de prueba.",
    source_reference: "Fundamento de prueba 2.º (ficticio)",
    confidence_level: "medium",
    review_status: "approved",
    approved: true,
    approved_by: "fixture-test",
    approved_at: "2026-06-13T00:00:00Z",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
    ...over,
  };
}

describe("answerComposer — decision 'answer'", () => {
  const input: ComposeInput = {
    question: "Una empresa usa un logo parecido a mi marca registrada de cosmética en España.",
    scope: makeScope({}),
    decision: makeDecision({}),
    criteria: [makeCriterion({})],
  };

  it("produce las 6 secciones obligatorias", () => {
    const a = composeAnswer(input, META);
    expect(a.decision).toBe("answer");
    for (const h of [
      "1. Lo que he entendido",
      "2. Encaje dentro del corpus",
      "3. Criterios aplicables",
      "4. Orientación informativa",
      "5. Límites de esta respuesta",
      "6. Aviso",
    ]) {
      expect(a.answer_text).toContain(h);
    }
  });

  it("cada criterio aparece con su source_reference y resolución (Reglas 4 y 9)", () => {
    const a = composeAnswer(input, META);
    expect(a.answer_text).toContain("Fundamento de prueba 2.º (ficticio)");
    expect(a.answer_text).toContain("jdg-fix-0001");
    expect(a.criteria_used).toEqual(["crit-fix-0001"]);
    expect(a.sources_used).toEqual([{ criterion_id: "crit-fix-0001", judgment_id: "jdg-fix-0001" }]);
  });

  it("usa lenguaje prudente y el aviso completo", () => {
    const a = composeAnswer(input, META);
    expect(a.answer_text).toMatch(/podría ser relevante|según los criterios disponibles|el corpus/i);
    expect(a.answer_text).toContain(DISCLAIMER);
    expect(a.disclaimer).toBe(DISCLAIMER);
  });

  it("confianza = la más prudente entre los criterios usados", () => {
    const a = composeAnswer(
      { ...input, criteria: [makeCriterion({ confidence_level: "high" }), makeCriterion({ id: "crit-2", confidence_level: "low" })] },
      META,
    );
    expect(a.confidence_level).toBe("low");
  });

  it("el AdvisorAnswer emitido es conforme al modelo F1", () => {
    expect(validateAdvisorAnswer(composeAnswer(input, META)).valid).toBe(true);
  });

  it("nunca cita un criterio fuera de criteria_used", () => {
    const a = composeAnswer(input, META);
    // el id del único criterio aparece; un id ajeno no
    expect(a.answer_text).toContain("crit-fix-0001");
    expect(a.answer_text).not.toContain("crit-AJENO");
  });

  it("integridad: 'answer' sin criterios servibles → lanza (deny-by-default)", () => {
    const pending = makeCriterion({
      review_status: "pending_review",
      approved: false,
      approved_by: null,
      approved_at: null,
    });
    expect(() =>
      composeAnswer({ ...input, criteria: [pending] }, META),
    ).toThrow(/sin criterios servibles|incoherencia/i);
  });

  it("guardarraíl de lenguaje: un criterio con frase vetada aborta la composición (Regla 10)", () => {
    const malo = makeCriterion({
      criterion_text: "FICTICIO — con estos hechos seguro que gana el juicio.",
    });
    expect(() => composeAnswer({ ...input, criteria: [malo] }, META)).toThrow(/lenguaje vetado/i);
  });
});

describe("answerComposer — decision 'clarify'", () => {
  it("no responde el fondo; hace las preguntas y avisa", () => {
    const a = composeAnswer(
      {
        question: "Una empresa usa un logo parecido al mío.",
        scope: makeScope({}),
        decision: makeDecision({
          decision: "clarify",
          clarifying_questions: ["¿La marca está registrada?", "¿Qué productos están afectados?"],
        }),
        criteria: [],
      },
      META,
    );
    expect(a.decision).toBe("clarify");
    expect(a.criteria_used).toEqual([]);
    expect(a.sources_used).toEqual([]);
    expect(a.confidence_level).toBeNull();
    expect(a.answer_text).toContain("¿La marca está registrada?");
    expect(a.answer_text).toContain("¿Qué productos están afectados?");
    expect(a.answer_text).toMatch(/faltan datos/i);
    // el aviso breve conserva la frase canónica (Reglas 11-12)
    expect(a.answer_text.toLowerCase()).toContain("no constituye asesoramiento jurídico");
    expect(a.disclaimer).toBe(DISCLAIMER);
    expect(validateAdvisorAnswer(a).valid).toBe(true);
  });
});

describe("answerComposer — decision 'out_of_scope'", () => {
  it("dice que no está cubierto, no responde jurídicamente y sugiere reformular", () => {
    const a = composeAnswer(
      {
        question: "Tengo un problema fiscal con Hacienda.",
        scope: makeScope({ area: "Fuera de alcance", topic: null, out_of_scope: true }),
        decision: makeDecision({ decision: "out_of_scope" }),
        criteria: [],
      },
      META,
    );
    expect(a.decision).toBe("out_of_scope");
    expect(a.answer_text).toMatch(/no está cubierta por las resoluciones del corpus/i);
    expect(a.answer_text).toMatch(/reformular/i);
    expect(a.criteria_used).toEqual([]);
    expect(validateAdvisorAnswer(a).valid).toBe(true);
  });
});

describe("answerComposer — decision 'insufficient_criteria'", () => {
  it("dice que no hay criterios suficientes, no improvisa y sugiere catálogo/profesional", () => {
    const a = composeAnswer(
      {
        question: "Quiero anular una patente por falta de novedad.",
        scope: makeScope({ area: "Patentes", topic: "validez" }),
        decision: makeDecision({ decision: "insufficient_criteria" }),
        criteria: [],
      },
      META,
    );
    expect(a.decision).toBe("insufficient_criteria");
    expect(a.answer_text).toMatch(/no hay criterios aprobados suficientes/i);
    expect(a.answer_text).toMatch(/catálogo|profesional/i);
    expect(validateAdvisorAnswer(a).valid).toBe(true);
  });
});

describe("answerComposer — determinismo", () => {
  it("misma entrada, misma salida", () => {
    const input: ComposeInput = {
      question: "consulta",
      scope: makeScope({}),
      decision: makeDecision({}),
      criteria: [makeCriterion({})],
    };
    expect(composeAnswer(input, META)).toEqual(composeAnswer(input, META));
  });
});
