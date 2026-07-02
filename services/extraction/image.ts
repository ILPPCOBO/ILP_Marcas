/**
 * extraction/image — Extractor de imágenes (OCR) con motor LOCAL de macOS.
 *
 * Si está `lla_ocr` (Vision) hace OCR local de la imagen (es+en), 100% offline
 * (Regla 2), devolviendo solo lo reconocido con su confianza (Regla 4). Si el
 * binario no está, degrada al stub honesto: status "failed" + warning que PIDE
 * describir la imagen o subir una versión más clara. NUNCA fabrica texto.
 */
import type { ExtractionInput, ExtractionOutput, TextExtractor } from "./types";
import { visionAvailable, visionExtract } from "./visionOcr";

export const unconfiguredOcrExtractor: TextExtractor = {
  name: "ocr-vision",
  handles: ["png", "jpg", "jpeg"],
  extract(input: ExtractionInput): ExtractionOutput {
    if (input.base64 && visionAvailable()) {
      const v = visionExtract(input.base64, input.file_type);
      if (v) return v;
    }
    return {
      status: "failed",
      text: "",
      warnings: [
        // El botón «Escanear con OCR» lo pinta el frontend (uploads.js) bajo este aviso.
        "No se pudo leer la imagen en el servidor y no se inventa contenido visual (Regla 4). " +
          "Puede escanearla aquí mismo con el botón «Escanear con OCR» que aparece justo debajo " +
          "(en su navegador; no se sube a ningún sitio) o describir por escrito lo que muestra.",
      ],
      source_locations: [],
      extraction_method: "manual_description_needed",
      page_texts: [],
      confidence: "low",
    };
  },
};
