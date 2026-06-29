/**
 * Verify whether the deaccent fix actually catches the missing phrases.
 * The guards use: deaccent(text) which is NFD + strip diacritics.
 */

import { hasForbiddenLanguage } from "./services/answerComposer";

// Deaccent function (copied from the source)
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const gapPhrases = [
  "ganaré el caso",
  "tendré éxito",
  "seré favorable",
  "tendría éxito",
  "sería favorable",
  "ganemos",
];

console.log("=== VERIFYING DEACCENT BEHAVIOR ===\n");

gapPhrases.forEach((phrase) => {
  const deaccented = deaccent(phrase);
  const caught = hasForbiddenLanguage(phrase);
  
  console.log(`Original: "${phrase}"`);
  console.log(`Deaccented: "${deaccented}"`);
  console.log(`Caught: ${caught}`);
  
  // Check if deaccented version would match certain patterns
  if (/(?:ganare|tendria|seria|ganemos)/.test(deaccented)) {
    console.log(`  → Contains ganar/tener/ser/prosperar stem in deaccented form`);
  }
  
  console.log();
});

// The key question: does "ganare" (deaccented "ganaré") match the pattern /\bganar(?:as|ás|...)/?
const testPattern = /\bganar(?:as|ás|a|á|ias|ías|ia|ía|emos|eis|éis|an|amos|ais|lo|la|los|las)\b/i;
const testPhrase = "ganare";

console.log(`\nPattern test:`);
console.log(`Pattern: /\\bganar(?:as|ás|a|á|ias|ías|ia|ía|emos|eis|éis|an|amos|ais|lo|la|los|las)\\b/i`);
console.log(`Testing against: "${testPhrase}"`);
console.log(`Match: ${testPattern.test(testPhrase)}`);
console.log(`\nThe pattern has accented forms (ás, á, ías, ía, éis, éis) but NOT the first-person future forms (aré, aremos, etc.)`);
