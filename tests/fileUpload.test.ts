/**
 * Tests de SUBIDA DE ARCHIVOS + separación Corpus Documents / Case Materials.
 *
 * Verifican los 10 invariantes del spec: un Corpus Document nunca responde
 * directo (solo crea pending_review); un Case Material nunca es fuente jurídica
 * ni crea criterios; los hechos del usuario quedan trazados; las imágenes
 * ilegibles avisan sin inventar; y no se aprueba sin metadatos de fuente.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractText, fileTypeFromName } from "../services/extraction";
import { validateUploadedFile } from "../services/models";
import type { UploadedFile } from "../services/models";
import { listUploadedFiles, rootFor, writeUploadedFile } from "../services/uploads";
import type { UploadPaths } from "../services/uploads";
import { extractCaseFacts } from "../services/caseFactsExtractor";
import { extractCriteriaFromDocument } from "../services/criterionExtractor";
import { registerJudgment, missingRequiredForApproval } from "../services/ingestion";
import type { CandidateCriterion, IngestionPaths } from "../services/ingestion";
import { loadJudgmentRegistry } from "../services/judgmentRegistry";
import { retrieveApprovedCriteria } from "../services/criteriaRetriever";
import { hasForbiddenLanguage } from "../services/answerComposer";

let base: string;
let uploadPaths: UploadPaths;
let ingestPaths: IngestionPaths;
const CTX = { now: "2026-06-13T10:00:00Z", actor: "Admin" };

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "lla-upload-"));
  uploadPaths = {
    case_materials: join(base, "uploads", "case_materials"),
    corpus_documents: join(base, "uploads", "corpus_documents"),
  };
  ingestPaths = {
    judgments: join(base, "source_judgments"),
    processed: join(base, "processed_criteria"),
    approved: join(base, "approved_criteria"),
    manifest: join(base, "source_judgments", "manifest.json"),
    reviewLog: join(base, "review_log.jsonl"),
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function caseFile(text: string, status?: UploadedFile["extraction_status"]): UploadedFile {
  const ex = extractText({ file_type: "txt", filename: "reporte.txt", text });
  return {
    id: "upl-1",
    original_filename: "reporte.txt",
    file_type: "txt",
    upload_type: "case_material",
    uploaded_at: CTX.now,
    uploaded_by: null,
    session_id: "sess-1",
    extraction_status: status ?? ex.status,
    extracted_text: ex.text,
    summary: "",
    detected_entities: [],
    detected_legal_topics: [],
    warnings: ex.warnings,
    source_locations: ex.source_locations,
    created_at: CTX.now,
    updated_at: CTX.now,
  };
}

describe("extracción de texto (TXT real; PDF/DOCX/OCR honestos)", () => {
  it("TXT se extrae con fragmentos trazables", () => {
    const ex = extractText({ file_type: "txt", filename: "a.txt", text: "Hola mundo del caso." });
    expect(ex.status).toBe("completed");
    expect(ex.text).toContain("Hola mundo");
    expect(ex.source_locations.length).toBeGreaterThan(0);
  });
  it("PDF ilegible (o sin motor OCR) => pending + warning, sin inventar", () => {
    // "AAA" no es un PDF válido: el motor OCR falla y se degrada al stub honesto
    // (deny-by-default), sin inventar contenido (Regla 4).
    const ex = extractText({ file_type: "pdf", filename: "s.pdf", base64: "AAA" });
    expect(ex.status).toBe("pending");
    expect(ex.text).toBe("");
    expect(ex.warnings.length).toBeGreaterThan(0);
    expect(ex.extraction_method).toBe("manual_description_needed");
  });
  it("imagen ilegible => failed + warning, sin texto (Regla 4)", () => {
    const ex = extractText({ file_type: "png", filename: "logo.png", base64: "AAA" });
    expect(ex.status).toBe("failed");
    expect(ex.text).toBe("");
    expect(ex.warnings.length).toBeGreaterThan(0);
  });
  it("fileTypeFromName reconoce las extensiones soportadas", () => {
    expect(fileTypeFromName("x.PDF")).toBe("pdf");
    expect(fileTypeFromName("x.jpeg")).toBe("jpeg");
    expect(fileTypeFromName("x.exe")).toBeNull();
  });
});

describe("campos de honestidad de extracción + deny-by-default (auditoría)", () => {
  it("TXT legible => native_text, confidence high, page_texts con el texto", () => {
    const ex = extractText({ file_type: "txt", filename: "a.txt", text: "Hechos del caso de marcas." });
    expect(ex.extraction_method).toBe("native_text");
    expect(ex.confidence).toBe("high");
    expect(ex.page_texts).toEqual([ex.text]);
  });
  it("PDF sin adaptador => manual_description_needed + confidence low + page_texts vacío", () => {
    const ex = extractText({ file_type: "pdf", filename: "s.pdf", base64: "AAA" });
    expect(ex.extraction_method).toBe("manual_description_needed");
    expect(ex.confidence).toBe("low");
    expect(ex.page_texts).toEqual([]);
  });
  it("un extractor que LANZA => failed + warning, sin texto inventado (Regla 17)", () => {
    const throwing = {
      name: "boom",
      handles: ["txt"],
      extract() {
        throw new Error("fallo simulado del extractor");
      },
    };
    const ex = extractText({ file_type: "txt", filename: "a.txt", text: "x" }, [throwing as never]);
    expect(ex.status).toBe("failed");
    expect(ex.text).toBe("");
    expect(ex.warnings.length).toBeGreaterThan(0);
  });
  it("UploadedFile con extraction_method/page_texts/confidence valida", () => {
    const f = caseFile("texto del caso");
    f.extraction_method = "native_text";
    f.page_texts = [f.extracted_text];
    f.confidence = "high";
    expect(validateUploadedFile(f).valid).toBe(true);
  });
  it("UploadedFile con extraction_method inválido NO valida", () => {
    const f = caseFile("texto del caso") as UploadedFile & { extraction_method: string };
    f.extraction_method = "telepatia" as never;
    expect(validateUploadedFile(f as UploadedFile).valid).toBe(false);
  });
  it("un extractor CONFIGURADO puede poblar page/section y se preservan (trazabilidad)", () => {
    const configured = {
      name: "pdf-configurado-mock",
      handles: ["pdf"],
      extract() {
        return {
          status: "completed" as const,
          text: "Fundamento jurídico segundo: riesgo de confusión.",
          warnings: [],
          source_locations: [
            { fragment_id: "frag-001", page: 3, section: "FJ 2.º", char_start: 0, char_end: 48 },
          ],
          extraction_method: "native_text" as const,
          page_texts: ["Fundamento jurídico segundo: riesgo de confusión."],
          confidence: "high" as const,
        };
      },
    };
    const ex = extractText({ file_type: "pdf", filename: "sent.pdf", base64: "AAA" }, [configured as never]);
    expect(ex.source_locations[0]!.page).toBe(3);
    expect(ex.source_locations[0]!.section).toBe("FJ 2.º");
    // el registro resultante con esas localizaciones valida
    const f = caseFile("x");
    f.source_locations = ex.source_locations;
    expect(validateUploadedFile(f).valid).toBe(true);
  });
});

describe("modelo + almacén con separación estructural", () => {
  it("un UploadedFile válido pasa la validación", () => {
    expect(validateUploadedFile(caseFile("texto del caso")).valid).toBe(true);
  });
  it("rootFor separa físicamente case_material y corpus_document", () => {
    expect(rootFor("case_material", uploadPaths)).toBe(uploadPaths.case_materials);
    expect(rootFor("corpus_document", uploadPaths)).toBe(uploadPaths.corpus_documents);
  });
  it("un case_material se escribe SOLO en case_materials/", () => {
    writeUploadedFile(caseFile("texto"), uploadPaths);
    expect(listUploadedFiles("case_material", uploadPaths)).toHaveLength(1);
    expect(listUploadedFiles("corpus_document", uploadPaths)).toHaveLength(0);
  });
});

describe("caseFactsExtractor — solo hechos, nunca fuente jurídica", () => {
  const TXT =
    "Mi marca está registrada en España, vendo productos de cosmética; un competidor usa un logo muy parecido en el mercado español.";

  it("detecta hechos trazados al documento (Regla 9 del módulo)", () => {
    const r = extractCaseFacts({ question: "riesgo de confusión", files: [caseFile(TXT)] });
    expect(r.relevant_facts.length).toBeGreaterThan(0);
    for (const f of r.relevant_facts) {
      expect(f.source_document_id).toBeTruthy();
      expect(f.source_filename).toBeTruthy();
      expect(f.page_or_location).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(f.confidence);
    }
  });
  it("no pronostica ni recomienda (Regla 18)", () => {
    const r = extractCaseFacts({ question: "¿gano?", files: [caseFile(TXT)] });
    expect(hasForbiddenLanguage(r.case_summary)).toBe(false);
  });
  it("ignora archivos que no son case_material (separación A/B)", () => {
    const corpus = { ...caseFile(TXT), upload_type: "corpus_document" as const };
    const r = extractCaseFacts({ question: "x", files: [corpus] });
    expect(r.relevant_facts).toHaveLength(0);
    expect(r.extraction_warnings.join(" ")).toMatch(/ignor/i);
  });
});

describe("criterionExtractor — Corpus Document => pending_review", () => {
  function register(): void {
    registerJudgment(
      {
        id: "jdg-test",
        title: "FICTICIA",
        court: "Tribunal de Prueba",
        date: "2021-05-10",
        resolution_number: "T-1/2021",
        legal_area: "marcas",
        topics: ["riesgo_de_confusion"],
        file_path: "data/source_judgments/FICTICIA.pdf",
        notes: "test",
        jurisdiction: "ZZ",
      },
      CTX,
      ingestPaths,
    );
  }
  const candidate: CandidateCriterion = {
    judgment_id: "jdg-test",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: null,
    criterion_text: "FICTICIO — criterio extraído de prueba.",
    conditions_for_application: ["FICTICIO — c."],
    does_not_answer: ["FICTICIO — n."],
    limits: ["FICTICIO — l."],
    source_excerpt: "FICTICIO — extracto verbatim.",
    source_reference: "FJ 2º",
    confidence_level: "low",
  };

  it("todo criterio extraído queda pending_review/approved:false (Reglas 14-15)", () => {
    register();
    const r = extractCriteriaFromDocument(
      { judgment_id: "jdg-test", candidates: [candidate] },
      CTX,
      { paths: ingestPaths },
    );
    expect(r.written).toHaveLength(1);
    expect(r.written[0]!.review_status).toBe("pending_review");
    expect(r.written[0]!.approved).toBe(false);
    expect(r.written[0]!.approved_by).toBeNull();
  });

  it("sin candidatos => 0 criterios + nota (deny-by-default, no inventa)", () => {
    register();
    const r = extractCriteriaFromDocument({ judgment_id: "jdg-test", candidates: [] }, CTX, { paths: ingestPaths });
    expect(r.written).toHaveLength(0);
    expect(r.note).toBeTruthy();
  });

  it("no se puede aprobar sin source_reference / source_excerpt / limits", () => {
    register();
    const judgments = loadJudgmentRegistry(ingestPaths.judgments);
    const sealed = extractCriteriaFromDocument(
      { judgment_id: "jdg-test", candidates: [candidate] },
      CTX,
      { paths: ingestPaths },
    ).written[0]!;
    expect(missingRequiredForApproval(sealed, judgments)).toEqual([]); // completo => aprobable
    expect(missingRequiredForApproval({ ...sealed, source_reference: "" }, judgments).length).toBeGreaterThan(0);
    expect(missingRequiredForApproval({ ...sealed, source_excerpt: "" }, judgments).length).toBeGreaterThan(0);
    expect(missingRequiredForApproval({ ...sealed, limits: [] }, judgments).length).toBeGreaterThan(0);
  });

  it("Regla 18 (defensa en profundidad): no se aprueba un criterio con lenguaje de pronóstico", () => {
    register();
    const bad = { ...candidate, criterion_text: "FICTICIO — con estos hechos la demanda tendrá éxito." };
    const sealed = extractCriteriaFromDocument({ judgment_id: "jdg-test", candidates: [bad] }, CTX, { paths: ingestPaths }).written[0]!;
    const judgments = loadJudgmentRegistry(ingestPaths.judgments);
    expect(missingRequiredForApproval(sealed, judgments)).toContain("lenguaje vetado (Regla 18)");
  });
});

describe("el motor nunca usa un criterio pending (Reglas 5, 13)", () => {
  it("un criterio pending en el corpus NO se recupera", () => {
    const pending = {
      id: "crit-pending",
      judgment_id: "jdg-test",
      area: "marcas" as const,
      topic: "riesgo_de_confusion",
      subtopic: null,
      criterion_text: "FICTICIO.",
      conditions_for_application: ["c"],
      does_not_answer: ["n"],
      limits: ["l"],
      source_excerpt: "ex",
      source_reference: "FJ 1º",
      confidence_level: "low" as const,
      review_status: "pending_review" as const,
      approved: false,
      approved_by: null,
      approved_at: null,
      created_at: CTX.now,
      updated_at: CTX.now,
    };
    const r = retrieveApprovedCriteria(
      { area: "Marcas", topic: "riesgo de confusión", subtopics: [] },
      [pending],
    );
    expect(r.criteria).toHaveLength(0);
    expect(r.insufficient_criteria).toBe(true);
  });
});
