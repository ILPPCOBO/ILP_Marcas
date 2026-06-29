/**
 * extraction — Despacho de extractores por tipo de archivo. Nunca lanza: un
 * formato no soportado o un fallo técnico => status "failed" + warning (deny-by-
 * default). Sin red (Regla 2); sin invención (Regla 4).
 */
import type { FileType } from "../models";
import type { ExtractionInput, ExtractionOutput, TextExtractor } from "./types";
import { txtExtractor } from "./txt";
import { unconfiguredPdfExtractor } from "./pdf";
import { unconfiguredDocxExtractor } from "./docx";
import { unconfiguredOcrExtractor } from "./image";

export * from "./types";
export { chunkText, FRAGMENT_SIZE } from "./txt";
export { txtExtractor } from "./txt";
export { unconfiguredPdfExtractor } from "./pdf";
export { unconfiguredDocxExtractor } from "./docx";
export { unconfiguredOcrExtractor } from "./image";

/** Registro por defecto: TXT real + adaptadores no configurados para el resto. */
export const DEFAULT_EXTRACTORS: TextExtractor[] = [
  txtExtractor,
  unconfiguredPdfExtractor,
  unconfiguredDocxExtractor,
  unconfiguredOcrExtractor,
];

export function extractText(
  input: ExtractionInput,
  extractors: TextExtractor[] = DEFAULT_EXTRACTORS,
): ExtractionOutput {
  const ex = extractors.find((e) => e.handles.includes(input.file_type));
  if (!ex) {
    return {
      status: "failed",
      text: "",
      warnings: [`Tipo de archivo no soportado: "${input.file_type}".`],
      source_locations: [],
    };
  }
  try {
    return ex.extract(input);
  } catch {
    return {
      status: "failed",
      text: "",
      warnings: ["Fallo técnico durante la extracción; no se ha extraído contenido (deny-by-default)."],
      source_locations: [],
    };
  }
}

const EXT_TO_TYPE: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
  png: "png",
  jpg: "jpg",
  jpeg: "jpeg",
};

/** Deriva el FileType desde la extensión del nombre; null si no está soportado. */
export function fileTypeFromName(filename: string): FileType | null {
  const m = /\.([a-z0-9]+)$/i.exec((filename ?? "").trim());
  const ext = m?.[1]?.toLowerCase() ?? "";
  return EXT_TO_TYPE[ext] ?? null;
}
