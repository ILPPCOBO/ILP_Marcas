/**
 * server.ts — Backend mínimo para PROBAR el cerebro cerrado (F2/F6 inicial).
 *
 * Servidor HTTP sin dependencias (node:http) que:
 *   - sirve el frontend estático de ../frontend
 *   - expone POST /api/consulta → engine.runQuery(consulta) → JSON
 *
 * Reglas de CLAUDE.md respetadas en esta capa:
 *   - El backend NO contiene lógica jurídica: solo orquesta `engine.runQuery`.
 *   - Genera aquí los ids/timestamps reales (el motor no los inventa).
 *   - Deny-by-default: cualquier error se convierte en un rechazo seguro y
 *     honesto; nunca se filtra una traza ni se improvisa una respuesta de fondo
 *     (Regla 17).
 *   - Solo se exponen al cliente los campos necesarios; el contenido de fondo
 *     ya viene gobernado por la decisión (answerComposer).
 *
 * Ejecutar (requiere Node ≥ 22):  npm install && npm run serve
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runQuery } from "../services/engine";
import { createInMemoryAuditLogger } from "../services/auditLogger";
import {
  getApprovedQuestion,
  getCatalogTree,
  listApprovedQuestions,
} from "../services/catalog";
import {
  BANNER_DISCLAIMER,
  DISCLAIMER_VERSION,
  getDisclaimerConfig,
  recordAcceptance,
} from "../services/legal";
import { areaLabel, topicLabel } from "../services/i18n";
import { FILE_TYPES } from "../services/models";
import type { FileType, UploadedFile } from "../services/models";
import { extractText, fileTypeFromName } from "../services/extraction";
import { writeUploadedFile, listUploadedFiles } from "../services/uploads";
import { extractCaseFacts } from "../services/caseFactsExtractor";
import { logIngestionEvent } from "../services/uploadAudit";
import { runCaseScoreboard } from "../services/caseScoreboard";
import { runCaseEvaluation } from "../services/caseEvaluator";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_DIR = join(HERE, "..", "frontend");
const PORT = Number(process.env.PORT ?? 8787);

// Registro de auditoría compartido del proceso (Regla 16). En F6: JSONL en disco.
const auditLogger = createInMemoryAuditLogger();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

// Aviso fijo: fuente única en services/legal/disclaimer.ts (versionado).
const DISCLAIMER_FIJO = BANNER_DISCLAIMER;

function send(res: import("node:http").ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function serveStatic(res: import("node:http").ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  // Sin path traversal: solo nombres simples dentro de frontend/.
  if (rel.includes("..") || rel.includes("/")) {
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
    return;
  }
  try {
    const data = await readFile(join(FRONTEND_DIR, rel), "utf-8");
    send(res, 200, data, MIME[extname(rel)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
  }
}

/** Respuesta de rechazo seguro ante un error técnico (deny-by-default). */
function safeError(): string {
  return JSON.stringify({
    ok: true,
    decision: "insufficient_criteria",
    area: null,
    topic: null,
    answer_text:
      "No puedo procesar la consulta en este momento por un problema técnico. " +
      "Por seguridad, no ofrezco ninguna orientación de fondo. Inténtelo de nuevo más tarde.",
    criteria_used: [],
    sources_used: [],
    disclaimer: DISCLAIMER_FIJO,
  });
}

/** Traza ligera de eventos (scoreboard, denegación de acceso) — Regla 16. */
function auditEvent(
  type: "scoreboard" | "case_evaluation" | "access_denied",
  actor: string,
  produced_ids: string[],
  detail: string,
): void {
  logIngestionEvent({
    id: `evt-${randomUUID()}`,
    type,
    at: new Date().toISOString(),
    actor: actor || "anon",
    file_id: null,
    file_type: null,
    upload_type: null,
    extraction_status: null,
    warnings: [],
    produced_ids,
    detail,
  });
}

async function handleConsulta(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let question = "";
  let acceptedVersion = "";
  let locale: "es" | "en" = "es";
  try {
    const parsed = JSON.parse(raw) as { question?: unknown; accepted_version?: unknown; locale?: unknown };
    question = String(parsed.question ?? "");
    acceptedVersion = String(parsed.accepted_version ?? "");
    locale = parsed.locale === "en" ? "en" : "es";
  } catch {
    question = "";
  }

  // Acceso: sin aceptación del aviso vigente, no se atiende la consulta
  // (defensa en profundidad; el bloqueo principal es la pantalla de bienvenida).
  if (acceptedVersion !== DISCLAIMER_VERSION) {
    auditEvent("access_denied", "anon", [], "Consulta denegada: aviso informativo no aceptado (Regla 16).");
    send(
      res,
      200,
      JSON.stringify({
        ok: false,
        acceptance_required: true,
        disclaimer_version: DISCLAIMER_VERSION,
        message: "Debe aceptar el aviso informativo antes de usar la herramienta.",
      }),
      "application/json; charset=utf-8",
    );
    return;
  }

  try {
    const result = runQuery(
      question,
      {
        query_id: `qry-${randomUUID()}`,
        answer_id: `ans-${randomUUID()}`,
        audit_id: `aud-${randomUUID()}`,
        created_at: new Date().toISOString(),
      },
      { logger: auditLogger, locale },
    );
    const { scope, answer } = result;
    // Solo se exponen campos necesarios. criteria_used/sources_used ya van
    // vacíos salvo decision "answer" (gobernado por answerComposer). El panel de
    // trazabilidad (área/tema) se muestra en el idioma de la interfaz; las
    // FUENTES y resoluciones (en la respuesta) se mantienen en español.
    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        decision: answer.decision,
        area: locale === "en" ? areaLabel(scope.area, "en") : scope.area,
        topic: locale === "en" ? topicLabel(scope.topic, "en").label : scope.topic,
        answer_text: answer.answer_text,
        criteria_used: answer.criteria_used,
        sources_used: answer.sources_used,
        disclaimer: answer.disclaimer,
      }),
      "application/json; charset=utf-8",
    );
  } catch {
    // Nunca se filtra el error ni se improvisa: rechazo seguro (Regla 17).
    send(res, 200, safeError(), "application/json; charset=utf-8");
  }
}

/**
 * Trazabilidad de una respuesta del catálogo (Regla 16): toda vía de respuesta
 * al usuario se audita. Best-effort: un fallo de registro no rompe la respuesta.
 */
function auditCatalog(answer_id: string, retrieved: string[], reason: string): void {
  try {
    auditLogger.log({
      id: `aud-${randomUUID()}`,
      query_id: `qry-${randomUUID()}`,
      answer_id,
      retrieved_criteria_ids: [...new Set(retrieved)],
      rejected_criteria_ids: [],
      decision_reason: reason,
      safety_flags: [],
      created_at: new Date().toISOString(),
    });
  } catch {
    /* la auditoría es best-effort; no tumba la respuesta */
  }
}

/**
 * Catálogo (modo de preguntas estándar): SOLO LECTURA y solo preguntas
 * servibles (aprobadas + conectadas a criterios aprobados + con fuentes), que el
 * servicio ya garantiza. Toda respuesta servida se audita (Regla 16).
 */
function handleCatalog(
  res: import("node:http").ServerResponse,
  path: string,
  query: URLSearchParams,
): void {
  const locale: "es" | "en" = query.get("locale") === "en" ? "en" : "es";
  try {
    if (path === "/api/catalog/tree") {
      send(res, 200, JSON.stringify({ ok: true, tree: getCatalogTree() }), "application/json; charset=utf-8");
      return;
    }
    if (path === "/api/catalog/questions") {
      const area = query.get("area") ?? "";
      const topic = query.get("topic") ?? "";
      const items = listApprovedQuestions(area, topic, undefined, locale);
      auditCatalog(
        `catalog-list:${area}/${topic}`,
        items.flatMap((q) => q.related_criteria_ids),
        `catálogo: lista servida (${area}/${topic}); preguntas: ${items.map((q) => q.id).join(", ") || "ninguna"}.`,
      );
      send(res, 200, JSON.stringify({ ok: true, items }), "application/json; charset=utf-8");
      return;
    }
    if (path === "/api/catalog/question") {
      const id = query.get("id") ?? "";
      const q = getApprovedQuestion(id, undefined, locale);
      if (q) auditCatalog(q.id, q.related_criteria_ids, `catálogo: pregunta servida "${q.id}".`);
      send(res, 200, JSON.stringify({ ok: true, question: q }), "application/json; charset=utf-8");
      return;
    }
    send(res, 404, "No encontrado", "text/plain; charset=utf-8");
  } catch {
    send(res, 200, JSON.stringify({ ok: false, error: "catálogo no disponible" }), "application/json; charset=utf-8");
  }
}

/** Registra la aceptación expresa del aviso (consentimiento). */
async function handleAcceptance(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body: { session_id?: unknown; language?: unknown; user_id?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const r = recordAcceptance(
    {
      session_id: String(body.session_id ?? ""),
      language: typeof body.language === "string" ? body.language : "es",
      user_id: typeof body.user_id === "string" ? body.user_id : null,
    },
    { id: `acc-${randomUUID()}`, now: new Date().toISOString() },
  );
  send(res, 200, JSON.stringify(r.ok ? { ok: true, record: r.record } : { ok: false, errors: r.errors }), "application/json; charset=utf-8");
}

/**
 * Subida de CASE MATERIAL (documento del caso del usuario). Se procesa el texto
 * LOCALMENTE (sin red, Regla 2), se persiste el registro en case_materials/ y se
 * preparan HECHOS (caseFactsExtractor) — nunca fuente jurídica, nunca pronóstico.
 * Se RECHAZA cualquier intento de subir corpus_document por esta vía pública: los
 * usuarios no amplían el corpus (eso es exclusivo del panel interno).
 */
async function handleUpload(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body: {
    filename?: unknown;
    file_type?: unknown;
    text?: unknown;
    base64?: unknown;
    session_id?: unknown;
    question?: unknown;
    upload_type?: unknown;
  } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }

  if (body.upload_type === "corpus_document") {
    send(
      res,
      200,
      JSON.stringify({
        ok: false,
        error:
          "Los usuarios no pueden ampliar el corpus. Los documentos del corpus (sentencias) se cargan " +
          "desde el panel interno de revisión, donde pasan por aprobación humana.",
      }),
      "application/json; charset=utf-8",
    );
    return;
  }

  const filename = String(body.filename ?? "").trim();
  const session_id = typeof body.session_id === "string" && body.session_id ? body.session_id : null;
  const question = String(body.question ?? "");
  const file_type = (typeof body.file_type === "string" ? body.file_type : null) ?? fileTypeFromName(filename);

  if (!filename || !file_type || !FILE_TYPES.includes(file_type as FileType)) {
    send(
      res,
      200,
      JSON.stringify({ ok: false, error: "Tipo de archivo no soportado. Use PDF, DOCX, TXT, PNG, JPG o JPEG." }),
      "application/json; charset=utf-8",
    );
    return;
  }
  if (!session_id) {
    send(res, 200, JSON.stringify({ ok: false, error: "Falta session_id." }), "application/json; charset=utf-8");
    return;
  }

  try {
    const now = new Date().toISOString();
    const ex = extractText({
      file_type: file_type as FileType,
      filename,
      text: typeof body.text === "string" ? body.text : undefined,
      base64: typeof body.base64 === "string" ? body.base64 : undefined,
    });
    const file: UploadedFile = {
      id: `upl-${randomUUID()}`,
      original_filename: filename,
      file_type: file_type as FileType,
      upload_type: "case_material",
      uploaded_at: now,
      uploaded_by: null,
      session_id,
      extraction_status: ex.status,
      extraction_method: ex.extraction_method ?? null,
      page_texts: ex.page_texts ?? [],
      confidence: ex.confidence ?? null,
      extracted_text: ex.text,
      summary: "",
      detected_entities: [],
      detected_legal_topics: [],
      warnings: ex.warnings,
      source_locations: ex.source_locations,
      created_at: now,
      updated_at: now,
    };
    const facts = extractCaseFacts({ question, files: [file] });
    file.summary = facts.case_summary;
    file.detected_legal_topics = facts.possible_topics;
    writeUploadedFile(file); // persiste en data/case_materials/

    logIngestionEvent({
      id: `evt-${randomUUID()}`,
      type: "upload",
      at: now,
      actor: session_id,
      file_id: file.id,
      file_type: file.file_type,
      upload_type: "case_material",
      extraction_status: file.extraction_status,
      warnings: file.warnings,
      produced_ids: [],
      detail: `Subida de material del caso "${filename}".`,
    });
    logIngestionEvent({
      id: `evt-${randomUUID()}`,
      type: "facts_extracted",
      at: now,
      actor: session_id,
      file_id: file.id,
      file_type: file.file_type,
      upload_type: "case_material",
      extraction_status: file.extraction_status,
      warnings: facts.extraction_warnings,
      produced_ids: facts.relevant_facts.map((f) => f.fact_id),
      detail: "Hechos del caso preparados (evidencia, no fuente jurídica; no anticipa resultado).",
    });

    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        file: {
          id: file.id,
          file_type: file.file_type,
          extraction_status: file.extraction_status,
          warnings: file.warnings,
        },
        facts,
      }),
      "application/json; charset=utf-8",
    );
  } catch {
    send(res, 200, JSON.stringify({ ok: false, error: "No se pudo procesar el archivo." }), "application/json; charset=utf-8");
  }
}

/**
 * Score de alineación con criterios del corpus (Case Fit Score). NO es una
 * probabilidad de ganar: mide la alineación de los hechos del caso del usuario
 * con los criterios APROBADOS. Carga los case_materials de la sesión y delega en
 * runCaseScoreboard (deny-by-default si no hay criterios/hechos suficientes).
 */
async function handleScoreboard(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body: { question?: unknown; locale?: unknown; session_id?: unknown; accepted_version?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const session_id = typeof body.session_id === "string" ? body.session_id : "";
  if (String(body.accepted_version ?? "") !== DISCLAIMER_VERSION) {
    auditEvent("access_denied", session_id, [], "Scoreboard denegado: aviso no aceptado.");
    send(
      res,
      200,
      JSON.stringify({ ok: false, acceptance_required: true, disclaimer_version: DISCLAIMER_VERSION }),
      "application/json; charset=utf-8",
    );
    return;
  }
  const locale: "es" | "en" = body.locale === "en" ? "en" : "es";
  try {
    const files = listUploadedFiles("case_material").filter((f) => f.session_id === session_id);
    const scoreboard = runCaseScoreboard(String(body.question ?? ""), { files, locale });
    // Regla 16 (hallazgo de auditoría): el scoreboard es una salida al usuario; se traza.
    auditEvent(
      "scoreboard",
      session_id,
      scoreboard.criteria_used.map((c) => c.criterion_id),
      `Scoreboard de alineación servido (computable=${scoreboard.computable}, score=${scoreboard.case_fit_score}, ` +
        `label=${scoreboard.score_label}).`,
    );
    send(res, 200, JSON.stringify({ ok: true, scoreboard }), "application/json; charset=utf-8");
  } catch {
    send(res, 200, JSON.stringify({ ok: false, error: "No se pudo generar el scoreboard." }), "application/json; charset=utf-8");
  }
}

/**
 * Evaluador de Caso (Case Fit Grade A–D). NO predice el resultado: califica la
 * ALINEACIÓN de los hechos del caso con los criterios APROBADOS (Regla 18).
 * Espeja handleScoreboard: exige aceptación del aviso, carga los case_materials
 * de la sesión y delega en runCaseEvaluation (deny-by-default + guardarraíl de
 * pronósticos). La decisión (evaluate_case | cannot_evaluate_case) se traza.
 */
async function handleEvaluate(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body: {
    description?: unknown;
    asunto_hint?: unknown;
    case_id?: unknown;
    locale?: unknown;
    session_id?: unknown;
    accepted_version?: unknown;
  } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const session_id = typeof body.session_id === "string" ? body.session_id : "";
  if (String(body.accepted_version ?? "") !== DISCLAIMER_VERSION) {
    auditEvent("access_denied", session_id, [], "Evaluación denegada: aviso no aceptado.");
    send(
      res,
      200,
      JSON.stringify({ ok: false, acceptance_required: true, disclaimer_version: DISCLAIMER_VERSION }),
      "application/json; charset=utf-8",
    );
    return;
  }
  const locale: "es" | "en" = body.locale === "en" ? "en" : "es";
  const case_id = typeof body.case_id === "string" && body.case_id ? body.case_id : undefined;
  try {
    const files = listUploadedFiles("case_material").filter(
      (f) => f.session_id === session_id && (case_id === undefined || f.case_id === case_id),
    );
    const evaluation = runCaseEvaluation(
      {
        description: String(body.description ?? ""),
        asunto_hint: typeof body.asunto_hint === "string" ? body.asunto_hint : undefined,
        files,
      },
      { locale },
    );
    // Regla 16: salida al usuario; se traza la decisión (evaluate_case | cannot_evaluate_case).
    auditEvent(
      "case_evaluation",
      session_id,
      evaluation.criteria_used.map((c) => c.criterion_id),
      `Evaluación de caso servida (decision=${evaluation.decision}, grade=${evaluation.case_fit_grade}, ` +
        `score=${evaluation.case_fit_score}).`,
    );
    send(res, 200, JSON.stringify({ ok: true, evaluation }), "application/json; charset=utf-8");
  } catch {
    send(res, 200, JSON.stringify({ ok: false, error: "No se pudo evaluar el caso." }), "application/json; charset=utf-8");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/disclaimer") {
    const lang = url.searchParams.get("locale") === "en" ? "en" : "es";
    send(res, 200, JSON.stringify({ ok: true, ...getDisclaimerConfig(lang) }), "application/json; charset=utf-8");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/acceptance") {
    void handleAcceptance(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/consulta") {
    void handleConsulta(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/upload") {
    void handleUpload(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/scoreboard") {
    void handleScoreboard(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/evaluate") {
    void handleEvaluate(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/catalog/")) {
    handleCatalog(res, url.pathname, url.searchParams);
    return;
  }
  if (req.method === "GET") {
    void serveStatic(res, url.pathname);
    return;
  }
  send(res, 405, "Método no permitido", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Locked Legal Advisor — interfaz de prueba en http://localhost:${PORT}`);
});
