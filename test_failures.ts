/**
 * Deep-dive on the 48 failures. Analyzing each one to understand the pattern.
 */

import { hasForbiddenLanguage } from "./services/answerComposer";
import { asksForPrediction } from "./services/caseEvaluator";
import { hasScoreboardForbiddenLanguage } from "./services/caseScoreboard";

const FAILURES = [
  "ganaré el caso",
  "tendré éxito",
  "prosperará la demanda",
  "prosperaré",
  "seré ganador",
  "obtendré sentencia favorable",
  "perderá el caso",
  "perderé",
  "resultaré favorable",
  "ganarían la demanda",
  "tendrías éxito",
  "tendría éxito",
  "tendrían éxito",
  "sería favorable",
  "serías ganador",
  "serían ganadores",
  "obtendrías sentencia",
  "obtendrían sentencia favorable",
  "perderías el juicio",
  "perderían el pleito",
  "resultaría favorable",
  "resultarías favorable",
  "resultarían favorables",
  "vencería el demandado",
  "vencerías",
  "vencerían",
  "prosperaría la demanda",
  "prosperarías",
  "prosperarían",
  "triunfaría tu causa",
  "triunfarías",
  "triunfarían",
  "ganemos",
  "venza el demandante",
  "venzas",
  "venzamos",
  "venzan",
  "prospere la pretensión",
  "prosperes",
  "prosperemos",
  "prosperen",
  "triunfe tu causa",
  "triunfes",
  "triunfemos",
  "triunfen",
  "buenas probabilidades",
  "van a prosperar",
  "¿cuáles son mis perspectivas?",
];

console.log("=== PATTERN ANALYSIS OF 48 FAILURES ===\n");

// Categorize failures
const futureAccent: string[] = [];
const conditionalAccent: string[] = [];
const subjunctiveStandalone: string[] = [];
const softPrognosis: string[] = [];
const querySpecific: string[] = [];

FAILURES.forEach((f) => {
  // Future 1st person (- é):
  if (/(?:ganaré|tendré|seré|obtendré|perderé|resultaré|prosperaré|venceré|triunfaré|prosperaré)/.test(f)) {
    futureAccent.push(f);
  }
  // Conditional (- ía, - ías, - ían):
  else if (/(?:ganaría|ganarías|ganarían|tendría|tendrías|tendrían|sería|serías|serían|obtendr[íi]a|obtendr[íi]as|obtendr[íi]an|perderían|perderías|resultaría|resultarías|resultarían|vencería|vencerías|vencerían|prosperaría|prosperarías|prosperarían|triunfaría|triunfarías|triunfarían)/.test(f)) {
    conditionalAccent.push(f);
  }
  // Subjunctive bare forms (gane, venza, prospere, triunfe and conjugations):
  else if (/(?:gane|ganes|ganemos|venza|venzas|venzamos|venzan|prospere|prosperes|prosperemos|prosperen|triunfe|triunfes|triunfemos|triunfen)/.test(f)) {
    subjunctiveStandalone.push(f);
  }
  // Soft prognosis without verb-final accent
  else if (/(?:probabilidades|perspectivas)/.test(f)) {
    softPrognosis.push(f);
  }
  // Query-specific (asksForPrediction)
  else {
    querySpecific.push(f);
  }
});

console.log(`FUTURE 1ST PERSON ACCENTED (${futureAccent.length}):`);
futureAccent.forEach((f) => console.log(`  "${f}"`));

console.log(`\nCONDITIONAL ACCENTED (${conditionalAccent.length}):`);
conditionalAccent.forEach((f) => console.log(`  "${f}"`));

console.log(`\nSUBJUNCTIVE STANDALONE (${subjunctiveStandalone.length}):`);
subjunctiveStandalone.forEach((f) => console.log(`  "${f}"`));

console.log(`\nSOFT PROGNOSIS (${softPrognosis.length}):`);
softPrognosis.forEach((f) => console.log(`  "${f}"`));

console.log(`\nQUERY-SPECIFIC (asksForPrediction) (${querySpecific.length}):`);
querySpecific.forEach((f) => console.log(`  "${f}"`));

// Test deaccent manually
console.log("\n=== DEACCENT PATTERN TEST ===\n");
const testPhrases = [
  "ganaré",
  "tendría",
  "sería",
  "ganemos",
  "venza",
  "prospere",
  "van a prosperar",
];

testPhrases.forEach((phrase) => {
  const deaccented = phrase.normalize("NFD").replace(/[̀-ͯ]/g, "");
  console.log(`"${phrase}" → "${deaccented}"`);
});

// Re-test a few key ones manually against the actual patterns
console.log("\n=== MANUAL PATTERN MATCH TEST (against FORBIDDEN_PATTERNS) ===\n");

const testCases = [
  "ganaré el caso",
  "tendría éxito",
  "sería favorable",
  "ganemos",
  "venza el demandante",
  "prospere la pretensión",
  "van a prosperar",
  "buenas probabilidades",
];

testCases.forEach((tc) => {
  const caught = hasForbiddenLanguage(tc);
  const alt = tc.normalize("NFD").replace(/[̀-ͯ]/g, "");
  console.log(`Text: "${tc}"`);
  console.log(`  caught by hasForbiddenLanguage: ${caught}`);
  console.log(`  Deaccented: "${alt}"`);
  console.log();
});
