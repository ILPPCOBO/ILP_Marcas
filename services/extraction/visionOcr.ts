/**
 * visionOcr — Puente al motor OCR LOCAL de macOS (`lla_ocr`, Vision + PDFKit).
 *
 * Extrae la capa de texto nativa del PDF y hace OCR de las páginas escaneadas, en
 * español+inglés, 100% LOCAL/offline (Regla 2). Solo devuelve lo realmente
 * reconocido, con su confianza (Regla 4): si no reconoce nada, devuelve null y el
 * extractor degrada al stub honesto (deny-by-default, nunca inventa).
 *
 * Se invoca de forma SÍNCRONA (execFileSync) para encajar en la interfaz
 * TextExtractor.extract(): ExtractionOutput sin volverla asíncrona. Si el binario
 * no está (otra máquina), visionAvailable() es false y el extractor usa el stub.
 *
 * Ruta del binario: env LLA_OCR_BIN, o ~/.local/bin/lla_ocr, o "lla_ocr" en PATH.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtractionConfidence,
  ExtractionMethod,
  SourceLocation,
} from "../models";
import type { ExtractionOutput } from "./types";

function homeBin(): string {
  return join(homedir(), ".local", "bin", "lla_ocr");
}

function resolveBin(): string {
  const env = process.env.LLA_OCR_BIN;
  if (env && existsSync(env)) return env;
  if (existsSync(homeBin())) return homeBin();
  return "lla_ocr"; // se resuelve por PATH; si no existe, execFileSync lanza y devolvemos null
}

/** ¿Hay un binario de OCR local disponible? (env o ~/.local/bin). */
export function visionAvailable(): boolean {
  const env = process.env.LLA_OCR_BIN;
  if (env && existsSync(env)) return true;
  return existsSync(homeBin());
}

const VALID_METHODS = new Set<ExtractionMethod>([
  "native_text",
  "ocr",
  "native_plus_ocr",
  "manual_description_needed",
]);
const VALID_CONF = new Set<ExtractionConfidence>(["low", "medium", "high"]);

/**
 * Extrae texto de un PDF/imagen (base64) con el motor nativo. Devuelve un
 * ExtractionOutput "completed" con extraction_method/page_texts/confidence, o
 * null si no hay binario, falla, o no reconoce texto (el llamante usa el stub).
 */
export function visionExtract(base64: string, ext: string, maxPages = 80): ExtractionOutput | null {
  const bin = resolveBin();
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "lla-ocr-"));
    const p = join(dir, `in.${ext}`);
    writeFileSync(p, Buffer.from(base64, "base64"));
    const stdout = execFileSync(bin, [p, "--max-pages", String(maxPages), "--langs", "es-ES,en-US"], {
      timeout: 1_200_000,
      maxBuffer: 128 * 1024 * 1024,
      encoding: "utf-8",
    });
    const out = JSON.parse(stdout || "{}") as {
      text?: string;
      error?: string;
      pages?: Array<{ page?: number; text?: string }>;
      extraction_method?: string;
      confidence?: string;
      page_count?: number;
      processed_pages?: number;
    };
    if (out.error || !String(out.text ?? "").trim()) return null;

    const text = String(out.text).replace(/[ \t]+/g, " ").trim();
    const pages = Array.isArray(out.pages) ? out.pages : [];
    const page_texts: string[] = [];
    const source_locations: SourceLocation[] = [];
    let char = 0;
    for (const pg of pages) {
      const t = String(pg.text ?? "").trim();
      if (!t) continue;
      page_texts.push(t);
      const start = char;
      char += t.length + 2;
      source_locations.push({
        fragment_id: `p${pg.page}`,
        page: typeof pg.page === "number" ? pg.page : null,
        section: null,
        char_start: start,
        char_end: char,
      });
    }

    const method = (VALID_METHODS.has(out.extraction_method as ExtractionMethod)
      ? (out.extraction_method as ExtractionMethod)
      : "ocr") as ExtractionMethod;
    const confidence = (VALID_CONF.has(out.confidence as ExtractionConfidence)
      ? (out.confidence as ExtractionConfidence)
      : method === "native_text"
        ? "high"
        : "medium") as ExtractionConfidence;

    const warnings: string[] = [];
    if ((out.page_count ?? 0) > (out.processed_pages ?? 0)) {
      warnings.push(
        `OCR limitado a las primeras ${out.processed_pages} de ${out.page_count} páginas (documento grande).`,
      );
    }

    return {
      status: "completed",
      text,
      warnings,
      source_locations:
        source_locations.length > 0
          ? source_locations
          : [{ fragment_id: "p1", page: 1, section: null, char_start: 0, char_end: text.length }],
      extraction_method: method,
      page_texts: page_texts.length > 0 ? page_texts : [text],
      confidence,
    };
  } catch {
    return null; // sin binario / fallo / PDF ilegible → deny-by-default, el extractor usa el stub
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* limpieza best-effort */
      }
    }
  }
}
