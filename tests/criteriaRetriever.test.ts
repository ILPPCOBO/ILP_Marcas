/**
 * Tests del criteriaRetriever (F2). Cubren las filas innegociables de
 * tests/README.md: "Exclusión de no aprobados" (un pending_review NUNCA se
 * devuelve aunque coincida), "Corpus vacío" y "Deny-by-default" en la carga.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadApprovedCriteria,
  retrieveApprovedCriteria,
} from "../services/criteriaRetriever";
import { isServable } from "../services/models";
import type { LegalCriterion, RetrievalQuery } from "../services/types";
import { FIX_CORPUS, FIX_JUDGMENT_IDS } from "./fixtures/corpus";

/** Criterio FICTICIO de test, aprobado y coherente; se ajusta con overrides. */
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

/** El mismo criterio pero degradado a pending_review (estado coherente). */
function makePending(over: Partial<LegalCriterion>): LegalCriterion {
  return makeCriterion({
    review_status: "pending_review",
    approved: false,
    approved_by: null,
    approved_at: null,
    ...over,
  });
}

const QUERY: RetrievalQuery = {
  area: "Marcas",
  topic: "riesgo de confusión",
  subtopics: ["similitud de signos", "similitud de productos"],
};

describe("criteriaRetriever — exclusión de no aprobados (Regla 5)", () => {
  it("REQUERIDO: un criterio pending_review NUNCA se devuelve, aunque coincida con la consulta", () => {
    const pending = makePending({ id: "crit-pending-match" });
    const r = retrieveApprovedCriteria(QUERY, [pending]);
    expect(r).toEqual({ criteria: [], insufficient_criteria: true });
  });

  it("en un corpus mixto solo se devuelve el aprobado, jamás el pendiente", () => {
    const approved = makeCriterion({ id: "crit-ok" });
    const pending = makePending({ id: "crit-pending" });
    const r = retrieveApprovedCriteria(QUERY, [pending, approved]);
    expect(r.criteria.map((c) => c.id)).toEqual(["crit-ok"]);
    expect(r.insufficient_criteria).toBe(false);
  });

  it("rejected y approved:false quedan excluidos", () => {
    const rejected = makeCriterion({
      id: "crit-rejected",
      review_status: "rejected",
      approved: false,
      approved_by: null,
      approved_at: null,
    });
    const r = retrieveApprovedCriteria(QUERY, [rejected]);
    expect(r).toEqual({ criteria: [], insufficient_criteria: true });
  });

  it("estado incoherente (approved:true + pending_review) queda excluido (defensa en profundidad)", () => {
    const tampered = makeCriterion({
      id: "crit-tampered",
      review_status: "pending_review",
      // approved sigue true y con metadatos: incoherencia deliberada
    });
    expect(isServable(tampered)).toBe(false);
    const r = retrieveApprovedCriteria(QUERY, [tampered]);
    expect(r).toEqual({ criteria: [], insufficient_criteria: true });
  });
});

describe("criteriaRetriever — coincidencia por área/tema/subtemas", () => {
  it("devuelve solo los criterios del área y tema consultados", () => {
    const match = makeCriterion({ id: "crit-match" });
    const otherTopic = makeCriterion({ id: "crit-otro-tema", topic: "mala_fe", subtopic: null });
    const otherArea = makeCriterion({
      id: "crit-otra-area",
      area: "procesal",
      topic: "prueba",
      subtopic: null,
    });
    const r = retrieveApprovedCriteria(QUERY, [otherTopic, otherArea, match]);
    expect(r.criteria.map((c) => c.id)).toEqual(["crit-match"]);
  });

  it("prioriza los criterios cuyo subtopic coincide; desempata por id (determinista)", () => {
    const noSub = makeCriterion({ id: "crit-a-sin-subtema", subtopic: null });
    const subMatch = makeCriterion({ id: "crit-z-con-subtema", subtopic: "similitud_de_productos" });
    const r = retrieveApprovedCriteria(QUERY, [noSub, subMatch]);
    expect(r.criteria.map((c) => c.id)).toEqual(["crit-z-con-subtema", "crit-a-sin-subtema"]);
    const r2 = retrieveApprovedCriteria(QUERY, [subMatch, noSub]);
    expect(r2.criteria.map((c) => c.id)).toEqual(r.criteria.map((c) => c.id));
  });

  it("sin coincidencias → lista vacía e insufficient_criteria: true (Regla 6)", () => {
    const r = retrieveApprovedCriteria(
      { area: "Patentes", topic: "validez", subtopics: [] },
      [makeCriterion({})],
    );
    expect(r).toEqual({ criteria: [], insufficient_criteria: true });
  });

  it("área 'Fuera de alcance' o tema null → insufficient, sin buscar nada", () => {
    const corpus = [makeCriterion({})];
    expect(
      retrieveApprovedCriteria({ area: "Fuera de alcance", topic: null, subtopics: [] }, corpus),
    ).toEqual({ criteria: [], insufficient_criteria: true });
    expect(
      retrieveApprovedCriteria({ area: "Marcas", topic: null, subtopics: [] }, corpus),
    ).toEqual({ criteria: [], insufficient_criteria: true });
  });
});

describe("criteriaRetriever — integración con el corpus mock real", () => {
  it("Marcas/riesgo de confusión → los dos criterios mock aprobados, todos servibles", () => {
    const r = retrieveApprovedCriteria(QUERY, FIX_CORPUS, FIX_JUDGMENT_IDS);
    expect(r.insufficient_criteria).toBe(false);
    expect(r.criteria.map((c) => c.id)).toEqual(["crit-mock-0001", "crit-mock-0002"]);
    expect(r.criteria.every(isServable)).toBe(true);
  });

  it("marca renombrada solo existe como pending en processed_criteria → insufficient", () => {
    const r = retrieveApprovedCriteria({
      area: "Marcas",
      topic: "marca renombrada",
      subtopics: [],
    }, FIX_CORPUS, FIX_JUDGMENT_IDS);
    expect(r).toEqual({ criteria: [], insufficient_criteria: true });
  });

  it("los criterios devueltos incluyen los campos del contrato", () => {
    const r = retrieveApprovedCriteria(QUERY, FIX_CORPUS, FIX_JUDGMENT_IDS);
    for (const c of r.criteria) {
      expect(c.id).toBeTruthy();
      expect(c.criterion_text).toBeTruthy();
      expect(c.source_reference).toBeTruthy();
      expect(c.limits.length).toBeGreaterThan(0);
    }
  });
});

describe("criteriaRetriever — carga deny-by-default", () => {
  it("carpeta inexistente → corpus vacío, sin excepción", () => {
    expect(loadApprovedCriteria("data/carpeta-que-no-existe")).toEqual([]);
  });

  it("archivo malformado o criterio inválido → se descartan, sin excepción", () => {
    const dir = mkdtempSync(join(tmpdir(), "lla-retriever-"));
    writeFileSync(join(dir, "roto.json"), "{esto no es json");
    writeFileSync(
      join(dir, "invalido.json"),
      JSON.stringify({ criteria: [{ id: "sin-campos" }] }),
    );
    writeFileSync(
      join(dir, "valido.json"),
      JSON.stringify({ criteria: [makeCriterion({ id: "crit-valido" })] }),
    );
    const corpus = loadApprovedCriteria(dir);
    expect(corpus.map((c) => c.id)).toEqual(["crit-valido"]);
  });

  it("forma exacta del resultado", () => {
    const r = retrieveApprovedCriteria(QUERY, []);
    expect(Object.keys(r).sort()).toEqual(["criteria", "insufficient_criteria"]);
  });
});
