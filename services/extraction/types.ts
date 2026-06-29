/**
 * extraction/types — Capa de extracción de texto ENCHUFABLE (sin red, Regla 2).
 *
 * Cada formato (TXT/PDF/DOCX/imagen) tiene su TextExtractor. El contrato es
 * honesto: si un extractor no puede extraer de forma fiable, devuelve status
 * "pending"/"failed" + warnings y NO inventa contenido (Regla 4 + "no inventes
 * contenido visual").
 */
import type {
  ExtractionConfidence,
  ExtractionMethod,
  ExtractionStatus,
  FileType,
  SourceLocation,
} from "../models";

export interface ExtractionInput {
  file_type: FileType;
  filename: string;
  /** Texto ya decodificado (TXT). Vacío si el archivo es binario sin extraer. */
  text?: string;
  /** Bytes en base64 (PDF/DOCX/imagen), si los hubiera. */
  base64?: string;
}

export interface ExtractionOutput {
  status: ExtractionStatus;
  /** Texto extraído; "" si no se pudo extraer (nunca inventado). */
  text: string;
  warnings: string[];
  source_locations: SourceLocation[];
  /** Cómo se obtuvo el texto (honestidad sobre el origen, Regla 4). */
  extraction_method?: ExtractionMethod;
  /** Texto por página/fragmento, en orden. */
  page_texts?: string[];
  /** Confianza del texto extraído. */
  confidence?: ExtractionConfidence;
}

export interface TextExtractor {
  readonly name: string;
  readonly handles: FileType[];
  extract(input: ExtractionInput): ExtractionOutput;
}
