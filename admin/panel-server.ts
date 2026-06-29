/**
 * panel-server — Servidor del PANEL INTERNO de revisión de criterios (F5).
 *
 * Sirve admin/panel/ (UI estática) y una API que delega EXCLUSIVAMENTE en
 * services/ingestion (listForReview / editCriterion / approveCriterion /
 * rejectCriterion). No contiene lógica jurídica ni de aprobación propia.
 *
 * INTERNO: corre en un puerto distinto del servidor público de consultas
 * (backend/server.ts). NO debe exponerse a usuarios finales. No hay auth: el
 * revisor escribe su nombre, que se registra como approved_by/actor (Regla 3).
 * Toda aprobación/rechazo se RE-VALIDA en services/ingestion; el cliente nunca
 * decide (deny-by-default).
 *
 * Ejecutar (Node ≥ 22):  npm run panel   → http://localhost:8788
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approveCriterion,
  editCriterion,
  listForReview,
  missingRequiredForApproval,
  registerJudgment,
  rejectCriterion,
  DEFAULT_PATHS,
  type EditableFields,
} from "../services/ingestion";
import { extractCriteriaFromDocument } from "../services/criterionExtractor";
import { extractText, fileTypeFromName } from "../services/extraction";
import { writeUploadedFile, readUploadedFile } from "../services/uploads";
import { FILE_TYPES, type FileType, type LegalArea, type UploadedFile } from "../services/models";
import { logIngestionEvent } from "../services/uploadAudit";
import { loadJudgmentRegistry } from "../services/judgmentRegistry";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PANEL_DIR = join(HERE, "panel");
const PORT = Number(process.env.PANEL_PORT ?? 8788);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function json(res: ServerResponse, status: number, obj: unknown): void {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (rel.includes("..") || rel.includes("/")) return send(res, 404, "No encontrado", "text/plain");
  try {
    const data = await readFile(join(PANEL_DIR, rel), "utf-8");
    send(res, 200, data, MIME[extname(rel)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
  }
}

/** Lista de criterios pending con su resolución y los campos que faltan para aprobar. */
function pendingPayload(): unknown {
  const registry = loadJudgmentRegistry(DEFAULT_PATHS.judgments);
  const items = listForReview({ status: "pending_review" }).map((it) => ({
    criterion: it.criterion,
    judgment: it.judgment,
    missing_for_approval: missingRequiredForApproval(it.criterion, registry),
  }));
  return { ok: true, items };
}

/** Extrae solo los campos editables permitidos del cuerpo (defensa en cliente y servidor). */
function pickEdits(b: Record<string, unknown>): Partial<EditableFields> {
  const e = (b.edits ?? {}) as Record<string, unknown>;
  const out: Partial<EditableFields> = {};
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  if (str(e.area) !== undefined) out.area = e.area as EditableFields["area"];
  if (str(e.topic) !== undefined) out.topic = str(e.topic);
  if ("subtopic" in e) out.subtopic = e.subtopic === null ? null : str(e.subtopic) ?? null;
  if (str(e.criterion_text) !== undefined) out.criterion_text = str(e.criterion_text);
  if (arr(e.conditions_for_application) !== undefined)
    out.conditions_for_application = arr(e.conditions_for_application);
  if (arr(e.does_not_answer) !== undefined) out.does_not_answer = arr(e.does_not_answer);
  if (arr(e.limits) !== undefined) out.limits = arr(e.limits);
  if (str(e.source_reference) !== undefined) out.source_reference = str(e.source_reference);
  return out;
}

/**
 * Sube una RESOLUCIÓN (corpus_document): la registra como Judgment, extrae su
 * texto (sin red), guarda el UploadedFile en corpus_documents/ y extrae criterios
 * candidatos a pending_review (si se aportan). NUNCA aprueba nada (Reglas 13-15);
 * sin candidatos => 0 criterios + nota (deny-by-default, no inventa).
 */
async function handleUploadCorpus(b: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const by = typeof b.by === "string" ? b.by : "";
  const filename = String(b.filename ?? "").trim();
  const file_type = (typeof b.file_type === "string" ? b.file_type : null) ?? fileTypeFromName(filename);
  if (!by.trim()) return json(res, 200, { ok: false, errors: ["Falta el nombre del revisor (by)."] });
  if (!filename || !file_type || !FILE_TYPES.includes(file_type as FileType))
    return json(res, 200, { ok: false, errors: ["Tipo de archivo no soportado (PDF/DOCX/TXT/PNG/JPG/JPEG)."] });

  const meta = (b.judgment ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const ctx = { now, actor: by };
  const judgment_id =
    typeof meta.id === "string" && meta.id.trim() ? meta.id.trim() : `jdg-${randomUUID()}`;

  const reg = registerJudgment(
    {
      id: judgment_id,
      title: String(meta.title ?? filename),
      court: String(meta.court ?? ""),
      date: String(meta.date ?? ""),
      resolution_number: String(meta.resolution_number ?? ""),
      legal_area: String(meta.legal_area ?? "marcas") as LegalArea,
      topics: Array.isArray(meta.topics) ? (meta.topics as string[]) : [],
      file_path: `data/source_judgments/${filename}`,
      notes: String(meta.notes ?? "Subido desde el panel interno."),
      jurisdiction: String(meta.jurisdiction ?? ""),
    },
    ctx,
  );
  if (!reg.ok) return json(res, 200, { ok: false, errors: reg.errors });

  const ex = extractText({
    file_type: file_type as FileType,
    filename,
    text: typeof b.text === "string" ? b.text : undefined,
    base64: typeof b.base64 === "string" ? b.base64 : undefined,
  });
  const uploaded: UploadedFile = {
    id: `upl-${randomUUID()}`,
    original_filename: filename,
    file_type: file_type as FileType,
    upload_type: "corpus_document",
    uploaded_at: now,
    uploaded_by: by,
    session_id: null,
    extraction_status: ex.status,
    extraction_method: ex.extraction_method ?? null,
    page_texts: ex.page_texts ?? [],
    confidence: ex.confidence ?? null,
    extracted_text: ex.text,
    summary: `Resolución ${judgment_id}`,
    detected_entities: [],
    detected_legal_topics: Array.isArray(meta.topics) ? (meta.topics as string[]) : [],
    warnings: ex.warnings,
    source_locations: ex.source_locations,
    created_at: now,
    updated_at: now,
  };
  writeUploadedFile(uploaded);

  const candidates = Array.isArray(b.candidates) ? (b.candidates as never[]) : [];
  const extracted = extractCriteriaFromDocument({ judgment_id, sourceText: ex.text, candidates }, ctx);

  logIngestionEvent({
    id: `evt-${randomUUID()}`,
    type: "upload",
    at: now,
    actor: by,
    file_id: uploaded.id,
    file_type: file_type as FileType,
    upload_type: "corpus_document",
    extraction_status: ex.status,
    warnings: ex.warnings,
    produced_ids: [],
    detail: `Resolución "${judgment_id}" subida y registrada.`,
  });
  logIngestionEvent({
    id: `evt-${randomUUID()}`,
    type: "criteria_extracted",
    at: now,
    actor: by,
    file_id: uploaded.id,
    file_type: file_type as FileType,
    upload_type: "corpus_document",
    extraction_status: ex.status,
    warnings: [],
    produced_ids: extracted.written.map((c) => c.id),
    detail: "Criterios candidatos sellados a pending_review.",
  });

  return json(res, 200, {
    ok: true,
    judgment: reg.judgment,
    uploaded: { id: uploaded.id, extraction_status: ex.status, warnings: ex.warnings },
    extracted: {
      written: extracted.written.map((c) => c.id),
      rejected: extracted.rejected.length,
      note: extracted.note,
    },
    source_text: ex.text,
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method === "GET" && path === "/api/pending") return json(res, 200, pendingPayload());
  if (req.method === "GET" && path === "/api/source-text") {
    const q = new URL(req.url ?? "/", "http://localhost").searchParams;
    const f = readUploadedFile(q.get("file_id") ?? "", "corpus_document");
    return json(res, 200, { ok: !!f, text: f ? f.extracted_text : "", warnings: f ? f.warnings : [] });
  }

  const b = await body(req);
  if (req.method === "POST" && path === "/api/upload") return handleUploadCorpus(b, res);
  const id = typeof b.id === "string" ? b.id : "";
  const by = typeof b.by === "string" ? b.by : "";
  const now = new Date().toISOString();
  const ctx = { now, actor: by };

  if (req.method === "POST" && path === "/api/save") {
    const r = editCriterion(id, ctx, { edits: pickEdits(b) });
    return json(res, 200, r);
  }
  if (req.method === "POST" && path === "/api/approve") {
    const r = approveCriterion(id, ctx, { edits: pickEdits(b) });
    return json(res, 200, r);
  }
  if (req.method === "POST" && path === "/api/reject") {
    const reason = typeof b.reason === "string" ? b.reason : "";
    if (!reason.trim()) return json(res, 200, { ok: false, errors: ["Falta el motivo de rechazo (rejected_reason)."] });
    const r = rejectCriterion(id, ctx, { reason });
    return json(res, 200, r);
  }
  send(res, 404, "No encontrado", "text/plain; charset=utf-8");
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  if (path.startsWith("/api/")) {
    void handleApi(req, res, path);
    return;
  }
  if (req.method === "GET") {
    void serveStatic(res, path);
    return;
  }
  send(res, 405, "Método no permitido", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Panel interno de revisión en http://localhost:${PORT} (NO exponer públicamente)`);
});
