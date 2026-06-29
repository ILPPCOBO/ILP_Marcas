/**
 * extraction/docx — Extractor de DOCX ENCHUFABLE.
 *
 * Por defecto NO está configurado: extraer texto de un DOCX requiere Node y una
 * librería local (p. ej. mammoth). Deny-by-default + Regla 4: status "pending" +
 * warning, sin inventar.
 *
 * Para activarlo, sustituya este adaptador por uno que lea el DOCX LOCALMENTE
 * (sin red), conserve la estructura básica (títulos/párrafos) y devuelva
 * source_locations con `section` por fragmento.
 */
import type { ExtractionInput, ExtractionOutput, TextExtractor } from "./types";

export const unconfiguredDocxExtractor: TextExtractor = {
  name: "docx-unconfigured",
  handles: ["docx"],
  extract(_input: ExtractionInput): ExtractionOutput {
    return {
      status: "pending",
      text: "",
      warnings: [
        "Extractor de DOCX no configurado: la extracción de texto de DOCX requiere instalar Node y una " +
          "librería local (p. ej. mammoth). No se ha extraído ni inventado contenido (Regla 4).",
      ],
      source_locations: [],
      extraction_method: "manual_description_needed",
      page_texts: [],
      confidence: "low",
    };
  },
};
