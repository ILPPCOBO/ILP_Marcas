/**
 * Tests del scopeClassifier (F2). Cubren las 5 preguntas de ejemplo de la spec
 * y los casos de seguridad de tests/README.md aplicables al clasificador:
 * deny-by-default, materias ajenas, consultas vacías y determinismo.
 */
import { describe, expect, it } from "vitest";
import {
  classifyScope,
  scopeAreaToLegalArea,
  toCorpusTopicKey,
} from "../services/scopeClassifier";

describe("scopeClassifier — preguntas de ejemplo de la spec", () => {
  it("1. 'Una empresa está usando un logo parecido al mío.' → Marcas / riesgo de confusión", () => {
    const r = classifyScope("Una empresa está usando un logo parecido al mío.");
    expect(r.out_of_scope).toBe(false);
    expect(r.area).toBe("Marcas");
    expect(r.topic).toBe("riesgo de confusión");
    expect(r.subtopics).toContain("similitud de signos");
    expect(r.confidence).toBe("medium");
    expect(r.reason).toMatch(/léxico cerrado/i);
  });

  it("2. 'Mi empleado creó una obra mientras trabajaba para mí.' → PI / obra laboral", () => {
    const r = classifyScope("Mi empleado creó una obra mientras trabajaba para mí.");
    expect(r.out_of_scope).toBe(false);
    expect(r.area).toBe("Propiedad intelectual");
    expect(r.topic).toBe("obra laboral");
  });

  it("3. 'Quiero registrar una marca parecida a otra ya existente.' → Marcas / riesgo de confusión", () => {
    const r = classifyScope("Quiero registrar una marca parecida a otra ya existente.");
    expect(r.out_of_scope).toBe(false);
    expect(r.area).toBe("Marcas");
    expect(r.topic).toBe("riesgo de confusión");
  });

  it("4. 'Tengo un problema fiscal con Hacienda.' → fuera de alcance (high)", () => {
    const r = classifyScope("Tengo un problema fiscal con Hacienda.");
    expect(r.out_of_scope).toBe(true);
    expect(r.area).toBe("Fuera de alcance");
    expect(r.topic).toBeNull();
    expect(r.subtopics).toEqual([]);
    expect(r.confidence).toBe("high");
    expect(r.reason).toMatch(/materia no cubierta/i);
  });

  it("5. 'Quiero demandar por difamación.' → fuera de alcance (high)", () => {
    const r = classifyScope("Quiero demandar por difamación.");
    expect(r.out_of_scope).toBe(true);
    expect(r.area).toBe("Fuera de alcance");
    expect(r.confidence).toBe("high");
  });
});

describe("scopeClassifier — deny-by-default (Regla 17)", () => {
  it("consulta vacía → fuera de alcance", () => {
    const r = classifyScope("");
    expect(r.out_of_scope).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("consulta sin coincidencias del léxico → fuera de alcance (low)", () => {
    const r = classifyScope("Me gustaría saber cómo cocinar paella valenciana.");
    expect(r.out_of_scope).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("mezcla con materia ajena igual de fuerte → fuera de alcance", () => {
    const r = classifyScope("¿Qué impuestos paga mi marca?");
    expect(r.out_of_scope).toBe(true);
  });

  it("señal del corpus MÁS fuerte que la ajena → dentro de alcance (frontera in > out)", () => {
    const r = classifyScope("Usan un logo parecido a mi marca y me preocupa el IVA.");
    expect(r.out_of_scope).toBe(false);
    expect(r.area).toBe("Marcas");
  });

  it("entradas raras → rechazo seguro, nunca excepción (Regla 17)", () => {
    expect(classifyScope("???").out_of_scope).toBe(true);
    expect(classifyScope("😀😀😀").out_of_scope).toBe(true);
    expect(classifyScope("12345 67890").out_of_scope).toBe(true);
    expect(classifyScope("lorem ".repeat(5000)).out_of_scope).toBe(true);
    expect(classifyScope(undefined as unknown as string).out_of_scope).toBe(true);
  });

  it("área reconocida sin tema → área con topic null y confianza low (para repreguntar)", () => {
    const r = classifyScope("Tengo una duda sobre mi marca.");
    expect(r.out_of_scope).toBe(false);
    expect(r.area).toBe("Marcas");
    expect(r.topic).toBeNull();
    expect(r.confidence).toBe("low");
  });
});

describe("scopeClassifier — desempates y ambigüedad (comportamiento fijado)", () => {
  it("cautelar genérica sin contexto de patente → Procesal", () => {
    const r = classifyScope("Me denegaron la cautelar, ¿puedo recurrir?");
    expect(r.area).toBe("Procesal");
    expect(r.topic).toBe("medidas cautelares");
  });

  it("cautelares con patente nombrada → Patentes (desempate por área nombrada), confianza low", () => {
    const r = classifyScope("Solicito medidas cautelares por la infracción de mi patente.");
    expect(r.area).toBe("Patentes");
    expect(r.confidence).toBe("low");
  });

  it("indemnización + marca → áreas casi empatadas ⇒ confianza low (señal de repregunta)", () => {
    const r = classifyScope("Quiero una indemnización por los daños que causó la copia de mi marca.");
    expect(r.out_of_scope).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.reason).toMatch(/Ambigüedad/);
  });
});

describe("scopeClassifier — otras áreas y robustez", () => {
  it("patentes / infracción", () => {
    const r = classifyScope("Creo que están infringiendo mi patente.");
    expect(r.area).toBe("Patentes");
    expect(r.topic).toBe("infracción");
  });

  it("procesal / prescripción", () => {
    const r = classifyScope("¿Ha prescrito el plazo para reclamar?");
    expect(r.area).toBe("Procesal");
    expect(r.topic).toBe("prescripción");
  });

  it("insensible a mayúsculas y acentos", () => {
    const a = classifyScope("USAN UN LOGO PARECIDO AL MÍO");
    const b = classifyScope("usan un logo parecido al mio");
    expect(a).toEqual(b);
    expect(a.area).toBe("Marcas");
  });

  it("determinista: misma entrada, misma salida", () => {
    const q = "Una empresa está usando un logo parecido al mío.";
    expect(classifyScope(q)).toEqual(classifyScope(q));
  });

  it("solo clasifica: el resultado no contiene texto de respuesta", () => {
    const r = classifyScope("Una empresa está usando un logo parecido al mío.");
    expect(Object.keys(r).sort()).toEqual(
      ["area", "confidence", "out_of_scope", "reason", "subtopics", "topic"].sort(),
    );
  });
});

describe("scopeClassifier — puentes al modelo de datos", () => {
  it("ScopeArea → LegalArea", () => {
    expect(scopeAreaToLegalArea("Marcas")).toBe("marcas");
    expect(scopeAreaToLegalArea("Propiedad intelectual")).toBe("propiedad_intelectual");
    expect(scopeAreaToLegalArea("Fuera de alcance")).toBeNull();
  });

  it("tema visible → clave de topic del corpus", () => {
    expect(toCorpusTopicKey("riesgo de confusión")).toBe("riesgo_de_confusion");
    expect(toCorpusTopicKey("regalía hipotética")).toBe("regalia_hipotetica");
  });
});
