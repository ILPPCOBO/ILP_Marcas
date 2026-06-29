/**
 * Test runCaseScoreboard (more exposed API) with prognosis-laden criteria.
 * This is the user-facing "case evaluation" path.
 */

import { runCaseScoreboard } from "./services/caseScoreboard";
import type { LegalCriterion, Judgment } from "./services/models";

const malicious_criteria: LegalCriterion[] = [
  {
    id: "crit-test-001",
    judgment_id: "jdg-test-001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "Si los signos son idénticos, tendrá éxito en su demanda de infracción.",
    conditions_for_application: ["Signos idénticos"],
    does_not_answer: [],
    limits: [],
    source_excerpt: "Test",
    source_reference: "TEST-001",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "test",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
  {
    id: "crit-test-002",
    judgment_id: "jdg-test-002",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_productos",
    criterion_text: "Una defensa débil será favorable al demandante en materia de signos similares.",
    conditions_for_application: [],
    does_not_answer: [],
    limits: [],
    source_excerpt: "Test",
    source_reference: "TEST-002",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "test",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
];

const mockJudgments: ReadonlyMap<string, Judgment> = new Map([
  ["jdg-test-001", { id: "jdg-test-001", title: "Test 1", body: "Test", date: "2026-01-01", court: "Test", year: 2026 }],
  ["jdg-test-002", { id: "jdg-test-002", title: "Test 2", body: "Test", date: "2026-01-01", court: "Test", year: 2026 }],
]);

const queries = [
  "Mis dos signos son idénticos en los elementos dominantes. El demandado tiene una defensa débil.",
  "¿Cuál es la alineación de mi caso con los criterios del corpus de marcas?",
];

console.log("=== TESTING runCaseScoreboard WITH PROGNOSIS CRITERIA ===\n");

queries.forEach((q) => {
  console.log(`\nQuery: "${q}"`);
  console.log("-".repeat(70));
  
  const result = runCaseScoreboard(q, {
    corpus: malicious_criteria,
    judgmentsById: mockJudgments,
    locale: "es",
  });

  console.log(`Computable: ${result.computable}`);
  console.log(`Decision: ${result.reason ? "FAILED - " + result.reason : "SUCCESS"}`);
  
  if (result.computable) {
    console.log(`Score: ${result.case_fit_score}`);
    console.log(`Grade: ${result.case_fit_grade}`);
    console.log(`Confidence: ${result.confidence_level}`);
    
    // Check factors for prognosis language
    const allFactors = [
      ...result.favorable_factors.map((f) => f.factor),
      ...result.unfavorable_factors.map((f) => f.factor),
    ];
    
    const hasPrognosis = allFactors.some((f) => 
      /tendrá éxito|será favorable|ganará|perderá/.test(f)
    );
    
    if (hasPrognosis) {
      console.log("\n⚠⚠⚠ PROGNOSIS LANGUAGE DETECTED IN FACTORS ⚠⚠⚠");
      allFactors
        .filter((f) => /tendrá éxito|será favorable|ganará|perderá/.test(f))
        .forEach((f) => console.log(`  • ${f}`));
    }
    
    console.log(`\nFavorable factors (${result.favorable_factors.length}):`);
    result.favorable_factors.slice(0, 3).forEach((f) => console.log(`  • ${f.factor}`));
    
    console.log(`\nUnfavorable factors (${result.unfavorable_factors.length}):`);
    result.unfavorable_factors.slice(0, 3).forEach((f) => console.log(`  • ${f.factor}`));
  }
});
