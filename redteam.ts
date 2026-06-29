/**
 * Red-team Regla-18 denylist — comprehensive testing of outcome-prognosis guards.
 * Tests all three guard functions post-deaccent with high-diversity Spanish phrasing.
 */

import { hasForbiddenLanguage } from "./services/answerComposer";
import { asksForPrediction } from "./services/caseEvaluator";
import { hasScoreboardForbiddenLanguage } from "./services/caseScoreboard";

interface TestCase {
  text: string;
  guardName: string;
  isPrognosis: boolean;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // ====== ACCENT-FINAL FUTURE/CONDITIONAL (Regla 18 core threat) ======
  
  // Future 1st/3rd person (ganará, tendrá éxito, prosperará, obtendrá)
  { text: "ganará el pleito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: ganará" },
  { text: "ganaré el caso", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: ganaré" },
  { text: "tendrá éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: tendrá éxito" },
  { text: "tendré éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: tendré" },
  { text: "prosperará la demanda", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: prosperará" },
  { text: "prosperaré", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: prosperaré" },
  { text: "será favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: será favorable" },
  { text: "seré ganador", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: seré" },
  { text: "obtendrá sentencia favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: obtendrá" },
  { text: "obtendré sentencia favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: obtendré" },
  { text: "perderá el caso", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: perderá" },
  { text: "perderé", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: perderé" },
  { text: "resultará favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future: resultará" },
  { text: "resultaré favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Future 1st: resultaré" },
  
  // Conditional (ganaría, tendría, sería, obtendrías, perderías)
  { text: "ganaría el pleito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: ganaría" },
  { text: "ganarías el caso", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: ganarías" },
  { text: "ganarían la demanda", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: ganarían" },
  { text: "tendrías éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: tendrías" },
  { text: "tendría éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: tendría" },
  { text: "tendrían éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: tendrían" },
  { text: "sería favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: sería" },
  { text: "serías ganador", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: serías" },
  { text: "serían ganadores", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: serían" },
  { text: "obtendrías sentencia", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: obtendrías" },
  { text: "obtendrían sentencia favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: obtendrían" },
  { text: "perderías el juicio", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: perderías" },
  { text: "perderían el pleito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: perderían" },
  { text: "resultaría favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: resultaría" },
  { text: "resultarías favorable", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: resultarías" },
  { text: "resultarían favorables", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional: resultarían" },
  
  // Conditional with vencer, prosperar, triunfar
  { text: "vencería el demandado", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional vencer: vencería" },
  { text: "vencerías", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional vencer 2nd: vencerías" },
  { text: "vencerían", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional vencer 3rd pl: vencerían" },
  { text: "prosperaría la demanda", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional prosperar: prosperaría" },
  { text: "prosperarías", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional prosperar 2nd: prosperarías" },
  { text: "prosperarían", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional prosperar 3rd pl: prosperarían" },
  { text: "triunfaría tu causa", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional triunfar: triunfaría" },
  { text: "triunfarías", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional triunfar 2nd: triunfarías" },
  { text: "triunfarían", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Conditional triunfar 3rd pl: triunfarían" },
  
  // Present subjunctive (gane, ganes, ganemos, ganen)
  { text: "gane el caso", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive: gane" },
  { text: "ganes el pleito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive 2nd: ganes" },
  { text: "ganemos", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive 1st pl: ganemos" },
  { text: "ganen la demanda", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive 3rd pl: ganen" },
  { text: "venza el demandante", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive venza: venza" },
  { text: "venzas", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive venzas" },
  { text: "venzamos", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive venzamos" },
  { text: "venzan", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive venzan" },
  { text: "prospere la pretensión", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive prospere" },
  { text: "prosperes", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive prosperes" },
  { text: "prosperemos", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive prosperemos" },
  { text: "prosperen", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive prosperen" },
  { text: "triunfe tu causa", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive triunfe" },
  { text: "triunfes", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive triunfes" },
  { text: "triunfemos", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive triunfemos" },
  { text: "triunfen", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Subjunctive triunfen" },
  
  // High-likelihood "soft" prognosis with adjectives
  { text: "buenas perspectivas de ganar", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: perspectivas ganar" },
  { text: "excelentes perspectivas", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: excelentes perspectivas" },
  { text: "magníficas oportunidades de éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: oportunidades éxito" },
  { text: "pocas posibilidades de éxito", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: posibilidades éxito" },
  { text: "muchas opciones de ganar", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: opciones ganar" },
  { text: "buenas probabilidades", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: probabilidades" },
  { text: "bastantes chances de prosperar", guardName: "hasForbiddenLanguage", isPrognosis: true, description: "Soft: chances prosperar" },
  
  // asksForPrediction-specific tests (caseEvaluator.ts)
  { text: "¿cuál es mi probabilidad de ganar?", guardName: "asksForPrediction", isPrognosis: true, description: "Query: probabilidad ganar" },
  { text: "¿tengo posibilidades de éxito?", guardName: "asksForPrediction", isPrognosis: true, description: "Query: posibilidades éxito" },
  { text: "voy a ganar el caso", guardName: "asksForPrediction", isPrognosis: true, description: "Query: voy a ganar" },
  { text: "vas a perder", guardName: "asksForPrediction", isPrognosis: true, description: "Query: vas a perder" },
  { text: "vamos a vencer", guardName: "asksForPrediction", isPrognosis: true, description: "Query: vamos vencer" },
  { text: "van a prosperar", guardName: "asksForPrediction", isPrognosis: true, description: "Query: van prosperar" },
  { text: "¿cuáles son mis perspectivas?", guardName: "asksForPrediction", isPrognosis: true, description: "Query: perspectivas" },
  { text: "ganaré el pleito", guardName: "asksForPrediction", isPrognosis: true, description: "Query future: ganaré" },
  { text: "perderá la demanda", guardName: "asksForPrediction", isPrognosis: true, description: "Query future: perderá" },
  { text: "vencerá el litigio", guardName: "asksForPrediction", isPrognosis: true, description: "Query future: vencerá" },
  
  // hasScoreboardForbiddenLanguage-specific tests
  { text: "éxito garantizado", guardName: "hasScoreboardForbiddenLanguage", isPrognosis: true, description: "Scoreboard: éxito garantizado" },
  { text: "exito asegurado", guardName: "hasScoreboardForbiddenLanguage", isPrognosis: true, description: "Scoreboard: exito asegurado (no accents)" },
  { text: "50% de éxito", guardName: "hasScoreboardForbiddenLanguage", isPrognosis: true, description: "Scoreboard: 50% éxito" },
  { text: "perderías el juicio", guardName: "hasScoreboardForbiddenLanguage", isPrognosis: true, description: "Scoreboard: perderías" },
];

console.log("=== RED-TEAM REGLA-18 DENYLIST ===\n");

interface Result {
  testNum: number;
  text: string;
  guard: string;
  caught: boolean;
  expected: boolean;
  status: "PASS" | "FAIL";
  description: string;
}

const results: Result[] = [];

for (let i = 0; i < TEST_CASES.length; i++) {
  const tc = TEST_CASES[i];
  let caught = false;

  if (tc.guardName === "hasForbiddenLanguage") {
    caught = hasForbiddenLanguage(tc.text);
  } else if (tc.guardName === "asksForPrediction") {
    caught = asksForPrediction(tc.text);
  } else if (tc.guardName === "hasScoreboardForbiddenLanguage") {
    caught = hasScoreboardForbiddenLanguage(tc.text);
  }

  const status = caught === tc.isPrognosis ? "PASS" : "FAIL";
  results.push({
    testNum: i + 1,
    text: tc.text,
    guard: tc.guardName,
    caught,
    expected: tc.isPrognosis,
    status,
    description: tc.description,
  });
}

// Print summary
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;

console.log(`Total tests: ${results.length} | Passed: ${passed} | FAILED: ${failed}\n`);

if (failed > 0) {
  console.log("=== FAILURES ===\n");
  results.filter((r) => r.status === "FAIL").forEach((r) => {
    console.log(`Test ${r.testNum}: [${r.guard}]`);
    console.log(`  Description: ${r.description}`);
    console.log(`  Text: "${r.text}"`);
    console.log(`  Expected caught: ${r.expected}, Got caught: ${r.caught}`);
    console.log();
  });
}

// Print details for all prognosis phrases that were caught
const successfulCatches = results.filter((r) => r.expected === true && r.caught === true);
console.log(`\n=== CONFIRMED DETECTIONS (${successfulCatches.length}) ===\n`);
successfulCatches.slice(0, 20).forEach((r) => {
  console.log(`✓ [${r.guard}] ${r.description}`);
  console.log(`  "${r.text}"`);
});
if (successfulCatches.length > 20) {
  console.log(`  ... and ${successfulCatches.length - 20} more`);
}

process.exit(failed > 0 ? 1 : 0);
