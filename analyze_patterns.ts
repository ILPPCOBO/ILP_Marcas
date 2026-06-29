/**
 * Print all FORBIDDEN_PATTERNS and PREDICTION_REQUEST patterns to see what's covered.
 * Then test a few gaps against each pattern.
 */

import { hasForbiddenLanguage } from "./services/answerComposer";
import { asksForPrediction } from "./services/caseEvaluator";
import { hasScoreboardForbiddenLanguage } from "./services/caseScoreboard";

// Test which specific patterns are missing
const gapTests = [
  // FUTURE 1ST (future: ganaré, tendré, etc.)
  { phrase: "ganaré", label: "future 1st ganaré" },
  { phrase: "tendré éxito", label: "future 1st tendré" },
  { phrase: "seré favorable", label: "future 1st seré" },
  
  // CONDITIONAL forms with accent (ganaría, tendrías, sería, etc.)
  { phrase: "ganaría", label: "cond 1st/3rd ganaría" },
  { phrase: "tendrías éxito", label: "cond 2nd tendrías" },
  { phrase: "sería favorable", label: "cond 1st/3rd sería" },
  
  // SUBJUNCTIVE bare forms (gane, venza, prospere)
  { phrase: "ganemos", label: "subj 1st pl ganemos" },
  { phrase: "venza el demandante", label: "subj 3rd venza" },
  { phrase: "prospere la pretensión", label: "subj 3rd prospere" },
  
  // Query-specific
  { phrase: "van a prosperar", label: "query va/van + prosperar" },
];

console.log("=== TESTING GAPS ===\n");

gapTests.forEach(({ phrase, label }) => {
  const caughtByForbidden = hasForbiddenLanguage(phrase);
  const caughtByPrediction = asksForPrediction(phrase);
  const caughtByScoreboard = hasScoreboardForbiddenLanguage(phrase);
  
  const status = (caughtByForbidden || caughtByPrediction || caughtByScoreboard) ? "✓ CAUGHT" : "✗ MISSED";
  console.log(`${status} | ${label}`);
  console.log(`   Text: "${phrase}"`);
  console.log(`   hasForbiddenLanguage: ${caughtByForbidden}, asksForPrediction: ${caughtByPrediction}, hasScoreboardForbiddenLanguage: ${caughtByScoreboard}`);
});
