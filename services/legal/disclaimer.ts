/**
 * legal/disclaimer — Fuente ÚNICA de los textos de aviso y su versión.
 *
 * Centraliza (DRY):
 *   - DISCLAIMER_VERSION: permite actualizar el aviso y volver a pedir aceptación
 *     a quien aceptó una versión anterior.
 *   - ACCEPTANCE_TEXT: el aviso de la pantalla de bienvenida (aceptación expresa).
 *   - SHORT_DISCLAIMER: el aviso breve que aparece al pie de cada respuesta
 *     (Reglas 11-12). answerComposer y el catálogo lo reutilizan.
 *   - DISCLAIMER_LANGUAGE: idioma del aviso (por ahora solo español).
 *
 * Cualquier cambio de texto DEBE subir DISCLAIMER_VERSION.
 */

/** Versión del aviso. Subir al cambiar cualquier texto (re-pide aceptación). */
export const DISCLAIMER_VERSION = "1.1.0";

/** Idioma del aviso (ISO 639-1). */
export const DISCLAIMER_LANGUAGE = "es";

/**
 * Texto de aceptación EXPRESA de la pantalla de bienvenida (verbatim).
 * Si se cambia, subir DISCLAIMER_VERSION.
 */
export const ACCEPTANCE_TEXT =
  "Entiendo que esta plataforma ofrece orientación informativa basada en una selección de " +
  "resoluciones judiciales y que en ningún caso constituye asesoramiento jurídico, ni crea " +
  "relación abogado-cliente, ni sustituye la consulta con un profesional colegiado.";

/**
 * Aviso BREVE al pie de cada respuesta (Reglas 11-12). Texto idéntico al que ya
 * usaba answerComposer (se conserva para no romper su contrato).
 */
export const SHORT_DISCLAIMER =
  "Esta respuesta es únicamente orientación informativa basada en un corpus cerrado de " +
  "criterios jurídicos y no constituye asesoramiento jurídico. Para un caso concreto, " +
  "consulte a un profesional.";

/** Aviso del BANNER superior fijo de las páginas (también versionado, fuente única). */
export const BANNER_DISCLAIMER =
  "Esta herramienta ofrece orientación informativa basada en un corpus cerrado. " +
  "No constituye asesoramiento jurídico.";

// --- Versiones en INGLÉS (capa de interfaz; el razonamiento sigue en español) ---

export const ACCEPTANCE_TEXT_EN =
  "I understand that this platform offers informational guidance based on a selection of " +
  "court decisions and that it in no case constitutes legal advice, nor creates an " +
  "attorney-client relationship, nor replaces consulting a licensed professional.";

export const SHORT_DISCLAIMER_EN =
  "This response is only informational guidance based on a closed corpus of legal criteria " +
  "and does not constitute legal advice. For a specific case, consult a professional.";

export const BANNER_DISCLAIMER_EN =
  "This tool offers informational guidance based on a closed corpus. It does not constitute " +
  "legal advice.";

/**
 * Aviso VERBATIM para respuestas traducidas al inglés (Regla 3 de i18n): deja
 * claro que es una traducción informativa de criterios de origen español y que
 * las fuentes permanecen en español.
 */
export const ENGLISH_SOURCE_NOTICE =
  "This English response is an informational translation based on Spanish-source criteria. " +
  "The original source references remain in Spanish.";

/** Aviso adicional cuando la traducción de la consulta es dudosa (Regla 6). */
export const TRANSLATION_DOUBT_NOTICE_EN =
  "Note: some terms in your query could not be confidently mapped to the corpus, so the " +
  "classification may be imprecise. Please rephrase if the result seems off.";

export interface DisclaimerConfig {
  version: string;
  language: string;
  acceptance_text: string;
  short_disclaimer: string;
  banner: string;
}

/** Configuración del aviso para un idioma (por defecto español). */
export function getDisclaimerConfig(language: string = DISCLAIMER_LANGUAGE): DisclaimerConfig {
  const en = language === "en";
  return {
    version: DISCLAIMER_VERSION,
    language: en ? "en" : "es",
    acceptance_text: en ? ACCEPTANCE_TEXT_EN : ACCEPTANCE_TEXT,
    short_disclaimer: en ? SHORT_DISCLAIMER_EN : SHORT_DISCLAIMER,
    banner: en ? BANNER_DISCLAIMER_EN : BANNER_DISCLAIMER,
  };
}
