/**
 * extraction/pdf — Extractor de PDF.
 *
 * Si está el motor OCR local de macOS (`lla_ocr`: Vision + PDFKit) lo usa: extrae
 * la capa de texto nativa y hace OCR de las páginas escaneadas (native_text / ocr
 * / native_plus_ocr), 100% LOCAL (Regla 2) y solo lo reconocido (Regla 4). Si el
 * binario no está (otra máquina), degrada al stub honesto: "pending" + warning,
 * SIN inventar (deny-by-default). Construir: tools/ocr/build.sh.
 */
import type { ExtractionInput, ExtractionOutput, TextExtractor } from "./types";
import { visionAvailable, visionExtract } from "./visionOcr";

export const unconfiguredPdfExtractor: TextExtractor = {
  name: "pdf-vision",
  handles: ["pdf"],
  extract(input: ExtractionInput): ExtractionOutput {
    if (input.base64 && visionAvailable()) {
      const v = visionExtract(input.base64, "pdf");
      if (v) return v;
    }
    return {
      status: "pending",
      text: "",
      warnings: [
        // El botón «Escanear con OCR» lo pinta el frontend (uploads.js) bajo este aviso.
        // Para OCR en el servidor: compilar tools/ocr (build.sh).
        "No se pudo leer este PDF en el servidor y no se inventa contenido (Regla 4). " +
          "Puede leerlo aquí mismo con el botón «Escanear con OCR» que aparece justo debajo " +
          "(en su navegador; el documento no se sube a ningún sitio) o pegar el texto del documento.",
      ],
      source_locations: [],
      extraction_method: "manual_description_needed",
      page_texts: [],
      confidence: "low",
    };
  },
};
