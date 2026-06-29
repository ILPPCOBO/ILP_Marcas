/**
 * Tests del missingFactsDetector (F2). Consultas incompletas → repregunta con
 * plantillas fijas; consultas suficientes → sin repregunta. Deny-by-default:
 * lo no mencionado se pregunta, nunca se asume (registro, infracción, etc.).
 */
import { describe, expect, it } from "vitest";
import { classifyScope, getKnownTopics } from "../services/scopeClassifier";
import { detectMissingFacts, hasChecklistFor } from "../services/missingFactsDetector";
import type { ScopeResult } from "../services/types";

function run(question: string) {
  return detectMissingFacts(question, classifyScope(question));
}

describe("missingFactsDetector — consultas incompletas", () => {
  it("'logo parecido' sin registro/productos/territorio → repregunta esos 3 hechos", () => {
    const r = run("Una empresa está usando un logo parecido al mío.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toContain("si existe marca registrada");
    expect(r.missing_facts).toContain("productos o servicios afectados");
    expect(r.missing_facts).toContain("territorio relevante");
    // mencionados: los signos (logo) y la actuación en el mercado (empresa)
    expect(r.missing_facts).not.toContain("cuáles son los signos comparados");
    expect(r.missing_facts).not.toContain("si las partes actúan en el mercado");
    expect(r.clarifying_questions).toHaveLength(r.missing_facts.length);
  });

  it("NO asume que existe marca registrada si el usuario no lo dice", () => {
    const r = run("Una empresa está usando un logo parecido al mío.");
    expect(r.missing_facts).toContain("si existe marca registrada");
  });

  it("querer registrar NO cuenta como tener marca registrada", () => {
    const r = run("Quiero registrar una marca parecida a otra ya existente.");
    expect(r.missing_facts).toContain("si existe marca registrada");
  });

  it("NO asume que hay infracción: pide el qué y el porqué (Patentes)", () => {
    const r = run("Están infringiendo mi patente, usan mi invención sin permiso.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toContain("producto o procedimiento supuestamente infractor");
    expect(r.missing_facts).toContain("en qué coincide con lo protegido");
    // la patente invocada sí fue mencionada
    expect(r.missing_facts).not.toContain("patente invocada y su titular");
  });

  it("obra laboral sin funciones ni contrato → repregunta esos hechos", () => {
    const r = run("Mi empleado creó una obra mientras trabajaba para mí.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toContain("si la creación estaba dentro de funciones laborales");
    expect(r.missing_facts).toContain("si hay contrato o cesión de derechos");
    expect(r.missing_facts).not.toContain("quién creó la obra");
    expect(r.missing_facts).not.toContain("si existía relación laboral");
  });

  it("mala fe sin relación/conocimiento/indicios → 3 repreguntas", () => {
    const r = run("Creo que registraron mi marca de mala fe.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toEqual([
      "relación previa entre las partes",
      "conocimiento previo del signo",
      "indicios de aprovechamiento o bloqueo",
    ]);
  });

  it("cautelares sin ningún dato → faltan los 5 hechos esenciales", () => {
    const r = run("Necesito medidas cautelares.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toEqual([
      "derecho invocado",
      "urgencia",
      "daño alegado",
      "apariencia de buen derecho",
      "pruebas disponibles",
    ]);
    expect(r.clarifying_questions).toHaveLength(5);
  });

  it("área sin tema concreto → repregunta el tema con la plantilla del área", () => {
    const r = run("Tengo una duda sobre mi marca.");
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toEqual(["tema concreto de la consulta"]);
    expect(r.clarifying_questions[0]).toMatch(/concretar qué aspecto de su marca/);
  });
});

describe("missingFactsDetector — consultas suficientemente claras", () => {
  it("riesgo de confusión con registro, signos, productos, mercado y territorio → sin repregunta", () => {
    const r = run(
      "Mi marca está registrada en España, vendemos productos de cosmética y una empresa competidora usa un logo muy parecido.",
    );
    expect(r).toEqual({
      needs_clarification: false,
      missing_facts: [],
      clarifying_questions: [],
    });
  });

  it("obra laboral con creador, relación, funciones y contrato → sin repregunta", () => {
    const r = run(
      "Mi empleado creó un diseño dentro de sus funciones y firmó un contrato laboral sin cesión pactada.",
    );
    expect(r).toEqual({
      needs_clarification: false,
      missing_facts: [],
      clarifying_questions: [],
    });
  });
});

describe("missingFactsDetector — seguridad y contratos", () => {
  it("fuera de alcance → no repregunta (el rechazo lo gestiona el motor, Regla 8)", () => {
    const r = run("Tengo un problema fiscal con Hacienda.");
    expect(r).toEqual({
      needs_clarification: false,
      missing_facts: [],
      clarifying_questions: [],
    });
  });

  it("las preguntas salen de plantillas fijas, no de generación libre", () => {
    const r = run("Una empresa está usando un logo parecido al mío.");
    expect(r.clarifying_questions).toContain(
      "¿En qué territorio se usa o está registrado cada signo?",
    );
  });

  it("forma exacta del resultado: 3 campos, listas alineadas 1:1", () => {
    const r = run("Necesito medidas cautelares.");
    expect(Object.keys(r).sort()).toEqual(
      ["clarifying_questions", "missing_facts", "needs_clarification"].sort(),
    );
    expect(r.clarifying_questions.length).toBe(r.missing_facts.length);
  });

  it("determinista: misma entrada, misma salida", () => {
    const q = "Mi empleado creó una obra mientras trabajaba para mí.";
    expect(run(q)).toEqual(run(q));
  });

  it("no inventa hechos: una consulta vacía de datos no marca nada como presente", () => {
    const r = run("Quiero información sobre medidas cautelares.");
    expect(r.missing_facts).toHaveLength(5);
  });

  it("cobertura: cada tema está GUARDADO — checklist propia o fallback de área que repregunta", () => {
    // Invariante deny-by-default: ningún tema del léxico puede llevar a una
    // respuesta de fondo sin pasar por detección. Un tema sin checklist propia
    // (p. ej. de los muchos del corpus real) DEBE repreguntar vía el fallback de
    // su área; nunca needs_clarification=false por ausencia de checklist.
    for (const { area, topic } of getKnownTopics()) {
      if (hasChecklistFor(area, topic)) continue;
      const scope = {
        area, topic, subtopics: [], out_of_scope: false, confidence: "high", reason: "",
      } as ScopeResult;
      const r = detectMissingFacts("consulta mínima sin datos", scope);
      expect(r.needs_clarification, `${area} / ${topic} debe repreguntar (fallback)`).toBe(true);
      expect(r.clarifying_questions.length, `${area} / ${topic}`).toBeGreaterThan(0);
    }
  });
});

describe("missingFactsDetector — ramas deny-by-default (scope sintético)", () => {
  const base: Omit<ScopeResult, "area" | "topic"> = {
    subtopics: [],
    out_of_scope: false,
    confidence: "medium",
    reason: "scope sintético de test",
  };

  it("tema sin checklist (futura ampliación del léxico) → repregunta de fallback del área", () => {
    const r = detectMissingFacts("consulta de prueba", {
      ...base,
      area: "Marcas",
      topic: "tema nuevo sin checklist",
    });
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toEqual(["tema concreto de la consulta"]);
    expect(r.clarifying_questions[0]).toMatch(/concretar qué aspecto de su marca/);
  });

  it("área sin plantilla de fallback → repregunta genérica, nunca silencio", () => {
    const r = detectMissingFacts("consulta de prueba", {
      ...base,
      area: "Área inventada" as ScopeResult["area"],
      topic: null,
    });
    expect(r.needs_clarification).toBe(true);
    expect(r.clarifying_questions).toEqual(["¿Podría concretar el tema de su consulta?"]);
  });

  it("pregunta vacía con scope en alcance → todos los hechos faltan", () => {
    const r = detectMissingFacts("", {
      ...base,
      area: "Procesal",
      topic: "medidas cautelares",
    });
    expect(r.needs_clarification).toBe(true);
    expect(r.missing_facts).toHaveLength(5);
  });
});
