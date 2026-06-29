/**
 * Tests del flujo de ingesta y revisión (F4/F5). Verifican las reglas
 * innegociables del pipeline editorial sobre un directorio temporal:
 * extracción → pending (nunca approved), aprobación humana con fuente, y que
 * editar nunca aprueba (CLAUDE.md Reglas 1-5, 13-15).
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveCriterion,
  editCriterion,
  extractPendingCriteria,
  listForReview,
  missingRequiredForApproval,
  registerJudgment,
  rejectCriterion,
} from "../services/ingestion";
import { loadJudgmentRegistry } from "../services/judgmentRegistry";
import type {
  CandidateCriterion,
  IngestionPaths,
  JudgmentRegistration,
} from "../services/ingestion";
import { isServable } from "../services/models";

let base: string;
let paths: IngestionPaths;
const CTX = { now: "2026-06-13T10:00:00Z", actor: "Revisor Humano" };

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "lla-ingest-"));
  paths = {
    judgments: join(base, "source_judgments"),
    processed: join(base, "processed_criteria"),
    approved: join(base, "approved_criteria"),
    manifest: join(base, "source_judgments", "manifest.json"),
    reviewLog: join(base, "review_log.jsonl"),
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const REG: JudgmentRegistration = {
  id: "jdg-test-1",
  title: "FICTICIA — sentencia de prueba",
  court: "Tribunal de Prueba",
  date: "2021-05-10",
  resolution_number: "T-1/2021",
  legal_area: "marcas",
  topics: ["riesgo_de_confusion"],
  file_path: "data/source_judgments/FICTICIA.pdf",
  notes: "nota de administración",
  jurisdiction: "ZZ",
};

const CAND: CandidateCriterion = {
  judgment_id: "jdg-test-1",
  area: "marcas",
  topic: "riesgo_de_confusion",
  subtopic: "similitud_de_signos",
  criterion_text: "FICTICIO — criterio extraído de prueba.",
  conditions_for_application: ["FICTICIO — condición."],
  does_not_answer: ["FICTICIO — exclusión."],
  limits: ["FICTICIO — límite."],
  source_excerpt: "FICTICIO — extracto verbatim de prueba.",
  source_reference: "Fundamento de prueba 2.º",
  confidence_level: "medium",
};

function register(): void {
  const r = registerJudgment(REG, CTX, paths);
  expect(r.ok).toBe(true);
}

describe("ingesta — extracción siempre pending, nunca approved (Reglas 1, 14)", () => {
  it("un criterio extraído nace pending_review/approved:false en processed_criteria", () => {
    register();
    const r = extractPendingCriteria("jdg-test-1", [CAND], CTX, { paths });
    expect(r.written).toHaveLength(1);
    const c = r.written[0]!;
    expect(c.review_status).toBe("pending_review");
    expect(c.approved).toBe(false);
    expect(c.approved_by).toBeNull();
    expect(c.judgment_id).toBe("jdg-test-1");
    // nada en approved_criteria
    expect(() => readdirSync(paths.approved)).toThrow(); // dir aún no existe
  });

  it("defensa en profundidad: un candidato con approved:true se sella a pending", () => {
    register();
    const tampered = { ...CAND, id: "crit-trap", approved: true, review_status: "approved" } as CandidateCriterion;
    const r = extractPendingCriteria("jdg-test-1", [tampered], CTX, { paths });
    expect(r.written[0]!.approved).toBe(false);
    expect(r.written[0]!.review_status).toBe("pending_review");
  });

  it("no se extrae nada si la resolución no está registrada (Regla 4)", () => {
    const r = extractPendingCriteria("jdg-inexistente", [CAND], CTX, { paths });
    expect(r.written).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it("rechaza una colisión de id (no deja copias incoherentes)", () => {
    register();
    expect(extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-dup" }], CTX, { paths }).written).toHaveLength(1);
    const second = extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-dup" }], CTX, { paths });
    expect(second.written).toHaveLength(0);
    expect(second.rejected[0]!.errors.join(" ")).toMatch(/colisión/i);
  });
});

describe("revisión humana — aprobar/rechazar/editar (Reglas 2, 3, 5, 15)", () => {
  it("aprobar exige usuario (Regla 3)", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-a" }], CTX, { paths });
    const r = approveCriterion("crit-a", { now: CTX.now, actor: "" }, { paths });
    expect(r.ok).toBe(false);
  });

  it("aprobar DENIEGA si la resolución de origen no existe (Regla 5)", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-b" }], CTX, { paths });
    // La resolución de origen desaparece del registro (p. ej. retirada): la
    // fuente deja de ser verificable y la aprobación debe bloquearse.
    rmSync(join(paths.judgments, "jdg-test-1.judgment.json"), { force: true });
    const r = approveCriterion("crit-b", CTX, { paths });
    expect(r.ok).toBe(false);
    // La denegación es por la fuente: la resolución de origen ya no está registrada
    // (el gate lo expresa como "resolución fuente registrada" entre los requisitos).
    expect(r.errors.join(" ")).toMatch(/resoluci[óo]n fuente|fuente registrada|no existe/i);
  });

  it("aprobar con fuente válida y ediciones → aprueba y queda servible", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-b2" }], CTX, { paths });
    const r = approveCriterion("crit-b2", CTX, { edits: { source_reference: "FJ 3º" }, paths });
    expect(r.ok).toBe(true);
    expect(isServable(r.criterion!)).toBe(true);
    expect(r.criterion!.source_reference).toBe("FJ 3º");
  });

  it("aprobar correctamente mueve a approved con sello humano + fecha", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-c" }], CTX, { paths });
    const r = approveCriterion("crit-c", CTX, { paths });
    expect(r.ok).toBe(true);
    expect(r.criterion!.approved).toBe(true);
    expect(r.criterion!.approved_by).toBe("Revisor Humano");
    expect(r.criterion!.approved_at).toBe(CTX.now);
    // movido: ya no aparece como pendiente
    expect(listForReview({ paths }).some((i) => i.criterion.id === "crit-c")).toBe(false);
    // y está en approved_criteria
    expect(readdirSync(paths.approved)).toContain("crit-c.json");
  });

  it("ediciones maliciosas (estado/clave desconocida) se ignoran; el sello humano manda", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-mal" }], CTX, { paths });
    const r = approveCriterion("crit-mal", CTX, {
      // intento de forzar estado y falsear el aprobador vía edits no tipados
      edits: {
        approved: true,
        review_status: "approved",
        approved_by: "FALSO",
        source_reference: "FJ 9º",
      } as never,
      paths,
    });
    expect(r.ok).toBe(true);
    expect(r.criterion!.approved_by).toBe("Revisor Humano"); // no "FALSO"
    expect(r.criterion!.source_reference).toBe("FJ 9º"); // campo editable sí aplica
    expect(Object.keys(r.criterion!)).not.toContain("approved_by_FALSO");
  });

  it("editar nunca aprueba: el criterio permanece en pending_review (Regla 15)", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-d" }], CTX, { paths });
    const r = editCriterion("crit-d", CTX, {
      edits: { criterion_text: "FICTICIO — texto editado por el revisor." },
      paths,
    });
    expect(r.ok).toBe(true);
    expect(r.criterion!.review_status).toBe("pending_review");
    expect(r.criterion!.approved).toBe(false);
  });

  it("missingRequiredForApproval coincide con lo que approveCriterion acepta (contrato del panel)", () => {
    register();
    // 'limits' vacío: el modelo lo permitiría, pero la aprobación lo exige no vacío.
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-lim" }], CTX, { paths });
    const reg = loadJudgmentRegistry(paths.judgments);
    const item = listForReview({ paths }).find((i) => i.criterion.id === "crit-lim")!;

    // criterio válido → sin faltantes → aprobable
    expect(missingRequiredForApproval(item.criterion, reg)).toEqual([]);
    expect(approveCriterion("crit-lim", CTX, { paths }).ok).toBe(true);

    // topic vacío y limits vacío → faltantes → approve también rechaza
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-bad" }], CTX, { paths });
    const reg2 = loadJudgmentRegistry(paths.judgments);
    const bad = listForReview({ paths }).find((i) => i.criterion.id === "crit-bad")!.criterion;
    expect(missingRequiredForApproval({ ...bad, topic: "", limits: [] }, reg2).sort()).toEqual(
      ["limits", "topic"],
    );
    const r = approveCriterion("crit-bad", CTX, { edits: { topic: "", limits: [] }, paths });
    expect(r.ok).toBe(false);
  });

  it("rechazar marca rejected/approved:false y lo deja fuera de los pendientes", () => {
    register();
    extractPendingCriteria("jdg-test-1", [{ ...CAND, id: "crit-e" }], CTX, { paths });
    const r = rejectCriterion("crit-e", CTX, { reason: "no aporta", paths });
    expect(r.ok).toBe(true);
    expect(r.criterion!.review_status).toBe("rejected");
    expect(listForReview({ paths }).some((i) => i.criterion.id === "crit-e")).toBe(false);
    expect(listForReview({ status: "rejected", paths }).some((i) => i.criterion.id === "crit-e")).toBe(true);
  });
});
