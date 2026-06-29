/**
 * services/catalog — Modo de PREGUNTAS ESTÁNDAR (catálogo).
 *
 * Respuestas PREAPROBADAS, sin generación libre. El servicio:
 *   - carga categorías (vocabulario cerrado) y preguntas,
 *   - aplica las puertas (Reglas 1-4): solo aprobadas, conectadas a criterios
 *     APROBADOS del corpus, con fuentes y límites,
 *   - permite navegar por área y tema.
 *
 * El admin (futuro) crea/edita/aprueba preguntas en ./admin (única vía a
 * approved: true).
 */
export * from "./loader";
export * from "./service";
export * from "./admin";
