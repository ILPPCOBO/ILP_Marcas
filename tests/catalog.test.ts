/**
 * Tests del catálogo (modo de preguntas estándar). Verifican las puertas
 * (Reglas 1-4): solo aprobadas, conectadas a criterios APROBADOS, con fuentes y
 * límites; navegación por área/tema; y el flujo de aprobación humana (Regla 5).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveCatalogQuestion,
  createDraftQuestion,
  getApprovedQuestion,
  getCatalogTree,
  listApprovedQuestions,
} from "../services/catalog";
import type { CatalogPaths } from "../services/catalog";
import type { CatalogQuestion, LegalCriterion } from "../services/models";

let base: string;
let paths: CatalogPaths;
const CTX = { now: "2026-06-13T10:00:00Z", actor: "Revisor Humano" };

function approvedCriterion(id: string): LegalCriterion {
  return {
    id,
    judgment_id: "jdg-fix",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: null,
    criterion_text: "FICTICIO — criterio aprobado de prueba.",
    conditions_for_application: ["FICTICIO — c."],
    does_not_answer: ["FICTICIO — n."],
    limits: ["FICTICIO — l."],
    source_excerpt: "FICTICIO — ex.",
    source_reference: "FJ 2º",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "fixture",
    approved_at: "2026-06-13T00:00:00Z",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
  };
}

function writeCategories(): void {
  writeFileSync(
    join(paths.dir, "categories.json"),
    JSON.stringify({ areas: [{ area: "Marcas", topics: ["riesgo de confusión", "mala fe"] }] }),
  );
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "lla-catalog-"));
  paths = {
    dir: join(base, "catalog"),
    approved: join(base, "approved"),
    judgments: join(base, "judgments"),
  };
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.approved, { recursive: true });
  mkdirSync(paths.judgments, { recursive: true });
  writeCategories();
  // un criterio aprobado en el corpus de prueba
  writeFileSync(join(paths.approved, "c.json"), JSON.stringify({ criteria: [approvedCriterion("crit-ok")] }));
  // la resolución que cita ese criterio debe existir en el registro (Regla 9)
  writeFileSync(
    join(paths.judgments, "j.json"),
    JSON.stringify({
      judgments: [
        {
          id: "jdg-fix",
          title: "FICTICIA",
          court: "Tribunal de Prueba",
          date: "2021-05-10",
          resolution_number: "T-1/2021",
          jurisdiction: "ZZ",
          legal_area: "marcas",
          topics: ["riesgo_de_confusion"],
          original_language: "es",
          file_path: "data/source_judgments/FICTICIA.pdf",
          summary_internal: "fixture",
          created_at: "2026-06-13T00:00:00Z",
          updated_at: "2026-06-13T00:00:00Z",
        },
      ],
    }),
  );
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function writeQuestion(q: CatalogQuestion): void {
  writeFileSync(join(paths.dir, `${q.id}.json`), JSON.stringify({ questions: [q] }));
}

const APPROVED_Q: CatalogQuestion = {
  id: "cat-1",
  area: "Marcas",
  topic: "riesgo de confusión",
  question: "¿…?",
  short_answer: "FICTICIO — respuesta breve.",
  full_answer: "FICTICIO — respuesta completa.",
  related_criteria_ids: ["crit-ok"],
  source_references: ["Resolución FICTICIA, FJ 2º"],
  limits: ["FICTICIO — límite."],
  approved: true,
  version: "1.0.0",
  last_reviewed_at: "2026-06-13T09:00:00Z",
  last_reviewed_by: "revisor",
};

describe("catálogo — puertas de servibilidad (Reglas 1-4)", () => {
  it("solo muestra aprobadas conectadas a criterios aprobados con fuentes y límites", () => {
    writeQuestion(APPROVED_Q);
    expect(listApprovedQuestions("Marcas", "riesgo de confusión", paths).map((q) => q.id)).toEqual(["cat-1"]);
  });

  it("Regla 1: una pregunta approved:false NUNCA se muestra", () => {
    writeQuestion({ ...APPROVED_Q, id: "cat-draft", approved: false, last_reviewed_at: null, last_reviewed_by: null });
    expect(listApprovedQuestions("Marcas", "riesgo de confusión", paths)).toEqual([]);
  });

  it("Regla 2: si referencia un criterio NO aprobado, no se muestra", () => {
    writeQuestion({ ...APPROVED_Q, id: "cat-badref", related_criteria_ids: ["crit-INEXISTENTE"] });
    expect(listApprovedQuestions("Marcas", "riesgo de confusión", paths)).toEqual([]);
  });

  it("Regla 3: una aprobada sin source_references es inválida y no se sirve", () => {
    writeQuestion({ ...APPROVED_Q, id: "cat-nosrc", source_references: [] });
    expect(getApprovedQuestion("cat-nosrc", paths)).toBeNull();
  });

  it("Regla 4: el servicio añade el aviso de no asesoramiento", () => {
    writeQuestion(APPROVED_Q);
    const q = getApprovedQuestion("cat-1", paths)!;
    expect(q.disclaimer.toLowerCase()).toContain("no constituye asesoramiento jurídico");
    expect(q.limits.length).toBeGreaterThan(0);
  });
});

describe("catálogo — navegación", () => {
  it("el árbol cuenta solo las preguntas servibles por área/tema", () => {
    writeQuestion(APPROVED_Q);
    writeQuestion({ ...APPROVED_Q, id: "cat-draft", topic: "mala fe", approved: false, last_reviewed_at: null, last_reviewed_by: null });
    const tree = getCatalogTree(paths);
    const marcas = tree.areas.find((a) => a.area === "Marcas")!;
    expect(marcas.topics.find((t) => t.topic === "riesgo de confusión")!.approved_count).toBe(1);
    expect(marcas.topics.find((t) => t.topic === "mala fe")!.approved_count).toBe(0);
  });
});

describe("catálogo — aprobación humana (Regla 5)", () => {
  it("aprobar un borrador exige criterios aprobados + fuentes + límites", () => {
    const draft = createDraftQuestion(
      {
        id: "cat-new",
        area: "Marcas",
        topic: "mala fe",
        question: "¿…?",
        short_answer: "",
        full_answer: "",
        related_criteria_ids: [],
        source_references: [],
        limits: [],
        version: "0.1.0",
      },
      CTX,
      paths,
    );
    expect(draft.ok).toBe(true);
    // vacío → no se puede aprobar
    expect(approveCatalogQuestion("cat-new", CTX, { paths }).ok).toBe(false);
    // con respaldo válido → aprueba y queda servible
    const r = approveCatalogQuestion("cat-new", CTX, {
      edits: {
        short_answer: "FICTICIO — breve.",
        full_answer: "FICTICIO — completa.",
        related_criteria_ids: ["crit-ok"],
        source_references: ["Resolución FICTICIA, FJ 1º"],
        limits: ["FICTICIO — límite."],
      },
      paths,
    });
    expect(r.ok).toBe(true);
    expect(r.question!.approved).toBe(true);
    expect(r.question!.last_reviewed_by).toBe("Revisor Humano");
    expect(getApprovedQuestion("cat-new", paths)).not.toBeNull();
  });
});

describe("catálogo — endurecimiento de la auditoría (Reglas 4, 9, 10)", () => {
  it("Regla 4: las citas servidas se DERIVAN de los metadatos del criterio, no del texto libre", () => {
    writeQuestion({ ...APPROVED_Q, source_references: ["STS 999/2020 INVENTADA, FJ 7º"] });
    const q = getApprovedQuestion("cat-1", paths)!;
    // la cita inventada NO se sirve; se sirve la derivada del criterio (FJ 2º / jdg-fix)
    expect(q.source_references.join(" ")).not.toContain("999/2020");
    expect(q.source_references.join(" ")).toContain("jdg-fix");
  });

  it("Regla 9: si la resolución del criterio enlazado no existe en el registro, no se sirve", () => {
    rmSync(join(paths.judgments, "j.json"), { force: true });
    expect(getApprovedQuestion("cat-1", paths)).toBeNull();
    expect(listApprovedQuestions("Marcas", "riesgo de confusión", paths)).toEqual([]);
  });

  it("Regla 10: una pregunta aprobada con lenguaje vetado NO se sirve", () => {
    writeQuestion({
      ...APPROVED_Q,
      id: "cat-bad",
      full_answer: "Conforme al corpus, usted debe demandar y ganará el juicio sin duda.",
    });
    expect(getApprovedQuestion("cat-bad", paths)).toBeNull();
  });

  it("Regla 10: no se puede APROBAR una pregunta con lenguaje vetado", () => {
    createDraftQuestion(
      {
        id: "cat-bad2",
        area: "Marcas",
        topic: "mala fe",
        question: "¿…?",
        short_answer: "Usted ganará el caso seguro.",
        full_answer: "FICTICIO.",
        related_criteria_ids: ["crit-ok"],
        source_references: ["Resolución FICTICIA"],
        limits: ["FICTICIO."],
        version: "0.1.0",
      },
      CTX,
      paths,
    );
    expect(approveCatalogQuestion("cat-bad2", CTX, { paths }).ok).toBe(false);
  });

  it("disclaimer del catálogo respeta el idioma (en)", () => {
    writeQuestion(APPROVED_Q);
    const q = getApprovedQuestion("cat-1", paths, "en")!;
    expect(q.disclaimer.toLowerCase()).toContain("does not constitute legal advice");
  });
});
