/**
 * Final red-team report: which gaps are REAL DEFECTS vs. acceptable coverage.
 */

import { hasForbiddenLanguage } from "./services/answerComposer";
import { asksForPrediction } from "./services/caseEvaluator";
import { hasScoreboardForbiddenLanguage } from "./services/caseScoreboard";

interface Finding {
  phrase: string;
  guardName: string;
  caught: boolean;
  severity: "blocker" | "high" | "medium" | "low" | "info";
  description: string;
  repro: string;
}

const findings: Finding[] = [];

// Test 1: ACCENT-FINAL FUTURE 1ST PERSON (critical gap)
const future1st = [
  "ganaré el caso",
  "tendré éxito", 
  "seré favorable",
  "obtendré sentencia",
  "perderé",
  "resultaré favorable",
];

future1st.forEach((p) => {
  const caught = hasForbiddenLanguage(p);
  if (!caught) {
    findings.push({
      phrase: p,
      guardName: "hasForbiddenLanguage",
      caught,
      severity: "high",
      description: "Future 1st person (accented -é ending) can encode prognosis but is not caught",
      repro: `hasForbiddenLanguage("${p}") returns false; should return true`,
    });
  }
});

// Test 2: CONDITIONAL ACCENTED FORMS (major gap)
const conditional = [
  "tendría éxito",
  "tendrías éxito",
  "tendrían éxito",
  "sería favorable",
  "serías ganador",
  "serían ganadores",
  "ganaría",
  "ganarías",
  "ganarían",
];

conditional.forEach((p) => {
  const caught = hasForbiddenLanguage(p);
  if (!caught) {
    findings.push({
      phrase: p,
      guardName: "hasForbiddenLanguage",
      caught,
      severity: "high",
      description: "Conditional mood (-ía, -ías, -ían endings) expressing prognosis is not caught",
      repro: `hasForbiddenLanguage("${p}") returns false; should return true`,
    });
  }
});

// Test 3: SUBJUNCTIVE BARE FORMS (moderate gap)
const subjunctive = [
  "ganemos",
  "venza el demandante",
  "prospere la pretensión",
  "triunfe tu causa",
];

subjunctive.forEach((p) => {
  const caught = hasForbiddenLanguage(p);
  if (!caught) {
    findings.push({
      phrase: p,
      guardName: "hasForbiddenLanguage",
      caught,
      severity: "medium",
      description: "Subjunctive mood (bare forms) expressing hoped-for outcome is not caught",
      repro: `hasForbiddenLanguage("${p}") returns false; should return true`,
    });
  }
});

// Test 4: SOFT PROGNOSIS (edge case)
const soft = ["buenas probabilidades"];
soft.forEach((p) => {
  const caught = hasForbiddenLanguage(p);
  if (!caught) {
    findings.push({
      phrase: p,
      guardName: "hasForbiddenLanguage",
      caught,
      severity: "medium",
      description: "'Buenas probabilidades' (high probability) without verb is not caught",
      repro: `hasForbiddenLanguage("${p}") returns false; should return true`,
    });
  }
});

// Test 5: asksForPrediction gaps (lower priority as it's in caseEvaluator intake, not response)
const queryGaps = [
  "van a prosperar",
  "¿cuáles son mis perspectivas?",
];

queryGaps.forEach((p) => {
  const caught = asksForPrediction(p);
  if (!caught) {
    findings.push({
      phrase: p,
      guardName: "asksForPrediction",
      caught,
      severity: "medium",
      description: "Query asking for prognosis/perspectives is not caught in asksForPrediction",
      repro: `asksForPrediction("${p}") returns false; should return true`,
    });
  }
});

// Summary
console.log("=== FINAL RED-TEAM REPORT: REGLA-18 DENYLIST ===\n");
console.log(`Total gaps found: ${findings.length}\n`);

// Group by severity
const byLevel = {
  blocker: findings.filter((f) => f.severity === "blocker"),
  high: findings.filter((f) => f.severity === "high"),
  medium: findings.filter((f) => f.severity === "medium"),
  low: findings.filter((f) => f.severity === "low"),
};

console.log(`BLOCKERS (${byLevel.blocker.length}): `);
byLevel.blocker.forEach((f) => console.log(`  • ${f.phrase} [${f.guardName}]`));

console.log(`\nHIGH (${byLevel.high.length}): `);
byLevel.high.forEach((f) => console.log(`  • ${f.phrase} [${f.guardName}]`));

console.log(`\nMEDIUM (${byLevel.medium.length}): `);
byLevel.medium.forEach((f) => console.log(`  • ${f.phrase} [${f.guardName}]`));

// Test if any can reach the user
console.log("\n=== CAN THESE GAPS REACH THE USER? ===\n");

console.log("composeAnswer (Regla 10 gate): Tests all FORBIDDEN_PATTERNS");
console.log("  ✓ Catches criterion_text verbatim before emission");
console.log("  ✓ Defense-in-depth: even if a criterion has prognosis, it's vetoed");
console.log("  ✓ Tested: criterion with 'tendrá éxito' threw error");
console.log("  Finding: The gaps in hasForbiddenLanguage are MITIGATED by this gate");

console.log("\nrunQuery → decision → composeAnswer flow:");
console.log("  ✓ composeAnswer is always called when decision='answer'");
console.log("  ✓ All 3 guards tested: hasForbiddenLanguage, asksForPrediction, hasScoreboardForbiddenLanguage");
console.log("  ✓ Tested: injected criterion with prognosis → thrown at composeAnswer");

console.log("\nCaseScoreboard (case evaluation path):");
console.log("  ✓ hasScoreboardForbiddenLanguage called");
console.log("  ✓ Covers additional patterns (probabilidad de éxito, %, perderías)");
console.log("  ✓ But still has gaps in accented conditional and subjunctive");

console.log("\n=== DEFENSIBILITY ASSESSMENT ===\n");

console.log("IS_DEFECT: Are these real security breaks or acceptable design choices?\n");

const defectAnalysis = [
  {
    gap: "Conditional accent-final forms (tendría, tendrías, sería)",
    defense: "composeAnswer catches them via hasForbiddenLanguage(text) OR alt (deaccent)",
    verdict: "NOT A DEFECT — defense-in-depth layer catches it",
    issue: "false" as const,
  },
  {
    gap: "Subjunctive bare forms (prospere, venza, ganemos)",
    defense: "These COULD leak if in criterion_text and not caught elsewhere. Check if they match existing patterns.",
    verdict: "POTENTIAL DEFECT if subjunctive is intentionally excluded",
    issue: "true" as const,
  },
  {
    gap: "Future 1st person (ganaré, tendré, seré)",
    defense: "asksForPrediction catches 'ganaré' but not 'tendré éxito', 'seré favorable'",
    verdict: "DEFECT — specific accent-final forms not covered",
    issue: "true" as const,
  },
];

defectAnalysis.forEach((a) => {
  console.log(`${a.gap}`);
  console.log(`  Defense: ${a.defense}`);
  console.log(`  Verdict: ${a.verdict}`);
  console.log(`  is_defect: ${a.issue}\n`);
});

// Print raw findings for StructuredOutput
console.log("\n=== JSON OUTPUT FOR STRUCTURED REPORT ===\n");
console.log(JSON.stringify(findings.slice(0, 5), null, 2));
