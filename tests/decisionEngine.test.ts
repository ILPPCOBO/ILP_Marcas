/**
 * Tests del decisionEngine (F2). Los cuatro escenarios de la spec, las
 * salvaguardas deny-by-default (Reglas 5, 7, 8, 17) y la integración de
 * extremo a extremo con los módulos reales sobre el corpus mock.
 */
import { describe, expect, it } from "vitest";
import { decide, decideCaseEvaluation } from "../services/decisionEngine";
import { classifyScope } from "../services/scopeClassifier";
import { detectMissingFacts } from "../services/missingFactsDetector";
import { retrieveApprovedCriteria } from "../services/criteriaRetriever";
import type {
  LegalCriterion,
  MissingFactsResult,
  RetrievalResult,
  ScopeResult,
} from "../services/types";

// ---------- fixtures sintéticos ----------

function makeScope(over: Partial<ScopeResult>): ScopeResult {
  return {
    area: "Marcas",
    topic: "riesgo de confusión",
    subtopics: ["similitud de signos"],
    out_of_scope: false,
    confidence: "medium",
    reason: "scope sintético de test",
    ...over,
  };
}

function makeFacts(over: Partial<MissingFactsResult>): MissingFactsResult {
  return { needs_clarification: false, missing_facts: [], clarifying_questions: [], ...over };
}

function makeCriterion(over: Partial<LegalCriterion>): LegalCriterion {
  return {
    id: "crit-fix-0001",
    judgment_id: "jdg-fix-0001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "FICTICIO (fixture de test) — criterio de prueba.",
    conditions_for_application: ["FICTICIO — condición de prueba."],
    does_not_answer: ["FICTICIO — exclusión de prueba."],
    limits: ["FICTICIO — límite de prueba."],
    source_excerpt: "FICTICIO — extracto de prueba.",
    source_reference: "Fundamento de prueba 1.º (ficticio)",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "fixture-test (no es revisión jurídica real)",
    approved_at: "2026-06-13T00:00:00Z",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
    ...over,
  };
}

function makeRetrieval(over: Partial<RetrievalResult>): RetrievalResult {
  return { criteria: [makeCriterion({})], insufficient_criteria: false, ...over };
}

// ---------- los cuatro escenarios de la spec ----------

describe("decisionEngine — los cuatro casos", () => {
  it("Caso 1: out_of_scope true → 'out_of_scope' con explicación honesta", () => {
    const r = decide(
      makeScope({ area: "Fuera de alcance", topic: null, out_of_scope: true, confidence: "high" }),
      makeFacts({}),
      makeRetrieval({ criteria: [], insufficient_criteria: true }),
    );
    expect(r.decision).toBe("out_of_scope");
    expect(r.reason).toMatch(/no cubre la materia/i);
    expect(r.clarifying_questions).toEqual([]);
  });

  it("Caso 2: needs_clarification true → 'clarify' solo con preguntas de aclaración", () => {
    const r = decide(
      makeScope({}),
      makeFacts({
        needs_clarification: true,
        missing_facts: ["si existe marca registrada", "productos o servicios afectados"],
        clarifying_questions: ["¿La marca está registrada?", "¿Qué productos o servicios están afectados?"],
      }),
      makeRetrieval({}),
    );
    expect(r.decision).toBe("clarify");
    expect(r.reason).toBe("Faltan datos esenciales para aplicar los criterios del corpus.");
    expect(r.clarifying_questions).toEqual([
      "¿La marca está registrada?",
      "¿Qué productos o servicios están afectados?",
    ]);
  });

  it("Caso 3: sin criterios suficientes → 'insufficient_criteria' con explicación", () => {
    const r = decide(
      makeScope({}),
      makeFacts({}),
      makeRetrieval({ criteria: [], insufficient_criteria: true }),
    );
    expect(r.decision).toBe("insufficient_criteria");
    expect(r.reason).toMatch(/no hay criterios aprobados suficientes/i);
  });

  it("Caso 4: en alcance + sin datos faltantes + criterios aprobados → 'answer'", () => {
    const r = decide(makeScope({}), makeFacts({}), makeRetrieval({}));
    expect(r.decision).toBe("answer");
    expect(r.reason).toMatch(/1 criterio/);
  });
});

// ---------- prioridades y salvaguardas ----------

describe("decisionEngine — prioridades y deny-by-default", () => {
  it("la cascada respeta el orden: out_of_scope gana a clarify y a insufficient", () => {
    const r = decide(
      makeScope({ out_of_scope: true, area: "Fuera de alcance", topic: null }),
      makeFacts({ needs_clarification: true, clarifying_questions: ["¿…?"], missing_facts: ["x"] }),
      makeRetrieval({ criteria: [], insufficient_criteria: true }),
    );
    expect(r.decision).toBe("out_of_scope");
  });

  it("clarify gana a insufficient (primero se completa la consulta)", () => {
    const r = decide(
      makeScope({}),
      makeFacts({ needs_clarification: true, clarifying_questions: ["¿…?"], missing_facts: ["x"] }),
      makeRetrieval({ criteria: [], insufficient_criteria: true }),
    );
    expect(r.decision).toBe("clarify");
  });

  it("clasificación ambigua (confidence low) → clarify con plantilla fija, nunca answer", () => {
    const r = decide(makeScope({ confidence: "low" }), makeFacts({}), makeRetrieval({}));
    expect(r.decision).toBe("clarify");
    expect(r.clarifying_questions).toHaveLength(1);
    expect(r.clarifying_questions[0]).toMatch(/concretando/);
  });

  it("contradicción (flag false pero lista vacía) → insufficient_criteria", () => {
    const r = decide(
      makeScope({}),
      makeFacts({}),
      makeRetrieval({ criteria: [], insufficient_criteria: false }),
    );
    expect(r.decision).toBe("insufficient_criteria");
  });

  it("criterio no servible colado en la recuperación → insufficient_criteria (integridad)", () => {
    const pending = makeCriterion({
      id: "crit-pending",
      review_status: "pending_review",
      approved: false,
      approved_by: null,
      approved_at: null,
    });
    const r = decide(
      makeScope({}),
      makeFacts({}),
      makeRetrieval({ criteria: [makeCriterion({}), pending] }),
    );
    expect(r.decision).toBe("insufficient_criteria");
    expect(r.reason).toMatch(/integridad/i);
  });

  it("toda decisión lleva reason no vacío y clarifying_questions vacío salvo clarify", () => {
    const cases = [
      decide(makeScope({ out_of_scope: true }), makeFacts({}), makeRetrieval({})),
      decide(makeScope({}), makeFacts({}), makeRetrieval({ criteria: [], insufficient_criteria: true })),
      decide(makeScope({}), makeFacts({}), makeRetrieval({})),
    ];
    for (const r of cases) {
      expect(r.reason.length).toBeGreaterThan(0);
      if (r.decision !== "clarify") expect(r.clarifying_questions).toEqual([]);
    }
  });

  it("determinista: misma entrada, misma salida", () => {
    const args = [makeScope({}), makeFacts({}), makeRetrieval({})] as const;
    expect(decide(...args)).toEqual(decide(...args));
  });
});

// ---------- integración de extremo a extremo (módulos reales + corpus mock) ----------

function pipeline(question: string) {
  const scope = classifyScope(question);
  const facts = detectMissingFacts(question, scope);
  const retrieval = retrieveApprovedCriteria(scope);
  return decide(scope, facts, retrieval);
}

describe("decisionEngine — pipeline completo sobre el corpus mock", () => {
  it("consulta fiscal → out_of_scope", () => {
    expect(pipeline("Tengo un problema fiscal con Hacienda.").decision).toBe("out_of_scope");
  });

  it("consulta incompleta de marcas → clarify con las repreguntas del detector", () => {
    const r = pipeline("Una empresa está usando un logo parecido al mío.");
    expect(r.decision).toBe("clarify");
    expect(r.clarifying_questions.length).toBeGreaterThan(0);
  });

  it("consulta completa de marcas → answer (criterios mock aprobados disponibles)", () => {
    const r = pipeline(
      "Mi marca está registrada en España, vendemos productos de cosmética y una empresa competidora usa un logo muy parecido.",
    );
    expect(r.decision).toBe("answer");
  });

  it("consulta completa de patentes (tema sin criterios aprobados) → insufficient_criteria", () => {
    const r = pipeline(
      "Quiero anular la patente registrada de mi competidor: falta de novedad, ya existía divulgación previa.",
    );
    expect(r.decision).toBe("insufficient_criteria");
  });
});

describe("decideCaseEvaluation — flujo de evaluación (evaluate_case | cannot_evaluate_case)", () => {
  it("en alcance + hechos + criterios aprobados → 'evaluate_case'", () => {
    const r = decideCaseEvaluation(makeScope({}), makeFacts({}), makeRetrieval({}));
    expect(r.decision).toBe("evaluate_case");
  });
  it("fuera de alcance → 'cannot_evaluate_case' (conserva la razón)", () => {
    const r = decideCaseEvaluation(
      makeScope({ area: "Fuera de alcance", topic: null, out_of_scope: true, confidence: "high" }),
      makeFacts({}),
      makeRetrieval({ criteria: [], insufficient_criteria: true }),
    );
    expect(r.decision).toBe("cannot_evaluate_case");
    expect(r.reason).toMatch(/no cubre la materia/i);
  });
  it("faltan hechos esenciales → 'cannot_evaluate_case'", () => {
    const r = decideCaseEvaluation(
      makeScope({}),
      makeFacts({ needs_clarification: true, clarifying_questions: ["¿La marca está registrada?"] }),
      makeRetrieval({}),
    );
    expect(r.decision).toBe("cannot_evaluate_case");
  });
  it("sin criterios aprobados → 'cannot_evaluate_case'", () => {
    const r = decideCaseEvaluation(makeScope({}), makeFacts({}), makeRetrieval({ criteria: [], insufficient_criteria: true }));
    expect(r.decision).toBe("cannot_evaluate_case");
  });
});
