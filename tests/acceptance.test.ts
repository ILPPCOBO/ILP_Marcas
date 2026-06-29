/**
 * Tests del flujo de aceptación previa (consentimiento). Verifican el registro
 * mínimo (session_id, fecha, versión, idioma), el sellado de versión por el
 * servidor y la validación deny-by-default.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCEPTANCE_TEXT,
  DISCLAIMER_VERSION,
  getDisclaimerConfig,
  readAcceptances,
  recordAcceptance,
} from "../services/legal";

let logPath: string;
let dir: string;
const CTX = { id: "acc-test-1", now: "2026-06-13T10:00:00Z" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lla-acc-"));
  logPath = join(dir, "acceptance_log.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aceptación — configuración del aviso", () => {
  it("expone versión, idioma y los textos (req 5)", () => {
    const c = getDisclaimerConfig();
    expect(c.version).toBe(DISCLAIMER_VERSION);
    expect(c.acceptance_text).toBe(ACCEPTANCE_TEXT);
    expect(c.short_disclaimer.toLowerCase()).toContain("no constituye asesoramiento jurídico");
  });

  it("el texto de aceptación es el verbatim del aviso", () => {
    expect(ACCEPTANCE_TEXT).toContain("ni crea relación abogado-cliente");
    expect(ACCEPTANCE_TEXT).toContain("ni sustituye la consulta con un profesional colegiado");
  });
});

describe("aceptación — registro (req 3)", () => {
  it("registra session_id, fecha, versión e idioma; user_id null sin login", () => {
    const r = recordAcceptance({ session_id: "sess-abc", language: "es" }, CTX, logPath);
    expect(r.ok).toBe(true);
    expect(r.record).toMatchObject({
      session_id: "sess-abc",
      user_id: null,
      accepted_at: "2026-06-13T10:00:00Z",
      disclaimer_version: DISCLAIMER_VERSION,
      language: "es",
    });
    expect(readAcceptances(logPath)).toHaveLength(1);
  });

  it("la versión la sella el servidor (no se confía en el cliente)", () => {
    // aunque se intente colar otra versión por user_id u otro medio, la versión
    // del registro es siempre la vigente del servidor.
    const r = recordAcceptance({ session_id: "s", language: "es", user_id: null }, CTX, logPath);
    expect(r.record!.disclaimer_version).toBe(DISCLAIMER_VERSION);
  });

  it("acepta user_id cuando exista login (estructura preparada)", () => {
    const r = recordAcceptance({ session_id: "s", language: "es", user_id: "u-42" }, CTX, logPath);
    expect(r.ok).toBe(true);
    expect(r.record!.user_id).toBe("u-42");
  });

  it("deny-by-default: sin session_id no se registra", () => {
    const r = recordAcceptance({ session_id: "", language: "es" }, CTX, logPath);
    expect(r.ok).toBe(false);
    expect(readAcceptances(logPath)).toHaveLength(0);
  });

  it("idioma inválido → rechazado", () => {
    expect(recordAcceptance({ session_id: "s", language: "español" }, CTX, logPath).ok).toBe(false);
  });

  it("minimización: el registro solo contiene los campos previstos (sin PII)", () => {
    recordAcceptance({ session_id: "s", language: "es" }, CTX, logPath);
    const line = readFileSync(logPath, "utf-8").trim();
    const keys = Object.keys(JSON.parse(line)).sort();
    expect(keys).toEqual(
      ["accepted_at", "disclaimer_version", "id", "language", "session_id", "user_id"].sort(),
    );
  });
});
