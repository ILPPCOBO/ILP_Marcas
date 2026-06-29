/**
 * uploads/types — Rutas y contexto del almacén de subidas. Las dos clases de
 * archivo viven en raíces SEPARADAS (separación estructural, no por convención):
 * un case_material no puede escribirse jamás en la carpeta del corpus.
 */
export interface UploadPaths {
  /** Materiales del caso del usuario (evidencia factual; nunca fuente jurídica). */
  case_materials: string;
  /** Documentos del corpus (sentencias/resoluciones; fuente jurídica POTENCIAL). */
  corpus_documents: string;
}

export const DEFAULT_UPLOAD_PATHS: UploadPaths = {
  // Materiales del caso → carpeta de primer nivel (datos personales, en .gitignore).
  case_materials: "data/case_materials",
  corpus_documents: "data/uploads/corpus_documents",
};

export interface UploadContext {
  now: string; // ISO 8601
  /** Quién sube: id de admin (corpus) o session_id (case_material). */
  actor: string;
}
