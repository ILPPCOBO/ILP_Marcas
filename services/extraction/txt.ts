/**
 * extraction/txt — Extractor de TXT REAL (sin dependencias). Importa el texto
 * completo y lo trocea en fragmentos con sus rangos de caracteres, de modo que un
 * hecho pueda trazarse a su fragmento (source_locations).
 */
import type { SourceLocation } from "../models";
import type { ExtractionInput, ExtractionOutput, TextExtractor } from "./types";

/** Tamaño de fragmento (caracteres). Trocear permite citar de qué tramo sale un hecho. */
export const FRAGMENT_SIZE = 1200;

/** Trocea un texto en fragmentos numerados con su rango [char_start, char_end). */
export function chunkText(text: string, prefix = "frag"): SourceLocation[] {
  const out: SourceLocation[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const end = Math.min(i + FRAGMENT_SIZE, text.length);
    n += 1;
    out.push({
      fragment_id: `${prefix}-${String(n).padStart(3, "0")}`,
      page: null,
      section: null,
      char_start: i,
      char_end: end,
    });
    i = end;
  }
  if (out.length === 0) {
    out.push({ fragment_id: `${prefix}-001`, page: null, section: null, char_start: 0, char_end: 0 });
  }
  return out;
}

export const txtExtractor: TextExtractor = {
  name: "txt",
  handles: ["txt"],
  extract(input: ExtractionInput): ExtractionOutput {
    const text = (input.text ?? "").replace(/\r\n/g, "\n");
    const empty = text.trim() === "";
    return {
      status: empty ? "failed" : "completed",
      text,
      warnings: empty ? ["El archivo de texto está vacío o no contiene texto legible."] : [],
      source_locations: chunkText(text),
      extraction_method: empty ? "manual_description_needed" : "native_text",
      page_texts: empty ? [] : [text],
      confidence: empty ? "low" : "high",
    };
  },
};
