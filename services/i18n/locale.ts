/**
 * i18n/locale — Idioma de la INTERFAZ (es | en). El razonamiento jurídico
 * interno SIEMPRE ocurre en español (CLAUDE.md): el inglés es solo capa de
 * presentación y traducción. No se admite chino (decisión del propietario).
 */
export type Locale = "es" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"] as const;

/** Resuelve un valor cualquiera a un Locale soportado; por defecto español. */
export function resolveLocale(value: unknown): Locale {
  return value === "en" ? "en" : "es";
}

const ES_WORD_MARKERS = [
  " que ", " de ", " la ", " el ", " mi ", " una ", " con ", " por ", " los ",
  " se ", " es ", " está ", " usa ", " marca ", " empresa ",
];
const EN_WORD_MARKERS = [
  " the ", " is ", " my ", " a ", " to ", " of ", " and ", " using ", " company ",
  " trademark ", " patent ", " evidence ", " can ", " i ", " similar ", " registered ",
];

/**
 * Detección de idioma DETERMINISTA (sin red, sin modelo). Acentos o signos de
 * apertura (¿¡) implican español. Si no, se cuentan marcadores; empate o duda
 * => español (deny-by-default hacia la lengua del corpus).
 */
export function detectLocale(text: string): Locale {
  if (/[¿¡áéíóúñ]/i.test(text)) return "es";
  const t = " " + text.toLowerCase() + " ";
  let es = 0;
  let en = 0;
  for (const m of ES_WORD_MARKERS) if (t.includes(m)) es++;
  for (const m of EN_WORD_MARKERS) if (t.includes(m)) en++;
  return en > es ? "en" : "es";
}
