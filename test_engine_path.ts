/**
 * Test whether a prognosis-laden criterion_text can bypass the guards
 * and reach the user when processed via runQuery.
 */

import { runQuery } from "./services/engine";
import type { LegalCriterion, Judgment } from "./services/models";

// Inject a criterion with hidden prognosis language
const maliciousCriteria: LegalCriterion[] = [
  {
    id: "test-001",
    criterion_text: "Si el demandante prueba los hechos esenciales, tendrá éxito en su demanda.",
    conditions_for_application: ["Hechos del caso claros"],
    does_not_answer: [],
    limits: [],
    source_reference: "Test Judgment XYZ",
    judgment_id: "test-judgment-001",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
  {
    id: "test-002",
    criterion_text: "Una defensa débil significa que la sentencia será favorable al demandante.",
    conditions_for_application: [],
    does_not_answer: [],
    limits: [],
    source_reference: "Test Judgment ABC",
    judgment_id: "test-judgment-002",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
  {
    id: "test-003",
    criterion_text: "El demandante podría prosperar si cumple todos los requisitos.",
    conditions_for_application: ["Requisitos legales"],
    does_not_answer: [],
    limits: [],
    source_reference: "Test Judgment DEF",
    judgment_id: "test-judgment-003",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
];

const mockJudgments: ReadonlyMap<string, Judgment> = new Map([
  [
    "test-judgment-001",
    {
      id: "test-judgment-001",
      title: "Test Case 1",
      body: "Test judgment body",
      date: "2025-01-01",
      court: "Test Court",
      year: 2025,
    },
  ],
  [
    "test-judgment-002",
    {
      id: "test-judgment-002",
      title: "Test Case 2",
      body: "Test judgment body",
      date: "2025-01-01",
      court: "Test Court",
      year: 2025,
    },
  ],
  [
    "test-judgment-003",
    {
      id: "test-judgment-003",
      title: "Test Case 3",
      body: "Test judgment body",
      date: "2025-01-01",
      court: "Test Court",
      year: 2025,
    },
  ],
]);

const queries = [
  "¿Qué ocurre si tengo una defensa débil en marcas?",
  "¿Cuáles son mis opciones en un conflicto de marcas?",
  "¿Qué pasa si cumplo todos los requisitos?",
];

console.log("=== TESTING ENGINE WITH PROGNOSIS-LADEN CRITERIA ===\n");

queries.forEach((q) => {
  console.log(`\nQuery: "${q}"`);
  console.log("-".repeat(60));
  
  const result = runQuery(q, {
    query_id: "test-query-" + Math.random().toString(36).substring(7),
    answer_id: "test-answer-" + Math.random().toString(36).substring(7),
    audit_id: "test-audit-" + Math.random().toString(36).substring(7),
    created_at: new Date().toISOString(),
  }, {
    corpus: maliciousCriteria,
    judgmentsById: mockJudgments,
    locale: "es",
  });

  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Answer decision: ${result.answer.decision}`);
  
  if (result.answer.decision === "answer") {
    console.log("\n⚠ ANSWER WAS COMPOSED:");
    console.log(result.answer.answer_text.substring(0, 500));
    console.log("\n[... truncated ...]");
  } else {
    console.log(`\nRejected with decision: ${result.answer.decision}`);
    console.log(`Reason: ${result.decision.reason}`);
  }
});
