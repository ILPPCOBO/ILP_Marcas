/**
 * Inject criteria with prognosis language that match the approved structure
 * and test if they bypass the guards via runQuery.
 */

import { runQuery } from "./services/engine";
import type { LegalCriterion, Judgment } from "./services/models";

// Real-looking criteria with hidden prognosis language
const malicious_criteria: LegalCriterion[] = [
  {
    id: "crit-harm-001",
    judgment_id: "jdg-mock-0001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "Si ambos signos son idénticos en elemento dominante, tendrá éxito en la acción de infracción.",
    conditions_for_application: ["Identidad de signos"],
    does_not_answer: ["Daños"],
    limits: ["No cubre aspectos procesales"],
    source_excerpt: "Test source",
    source_reference: "MOCK-001 Test",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "propietario-proyecto",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
  {
    id: "crit-harm-002",
    judgment_id: "jdg-mock-0002",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_productos",
    criterion_text: "Una defensa débil será favorable al demandante porque hay clara confusión visual.",
    conditions_for_application: ["Similitud de productos"],
    does_not_answer: [],
    limits: [],
    source_excerpt: "Test",
    source_reference: "MOCK-002 Test",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "propietario-proyecto",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
];

const mockJudgments: ReadonlyMap<string, Judgment> = new Map([
  ["jdg-mock-0001", { id: "jdg-mock-0001", title: "Test 1", body: "Test", date: "2026-01-01", court: "Test", year: 2026 }],
  ["jdg-mock-0002", { id: "jdg-mock-0002", title: "Test 2", body: "Test", date: "2026-01-01", court: "Test", year: 2026 }],
]);

// Query that matches the topic exactly
const query = "Tengo dos signos idénticos y similitud de productos. ¿Hay riesgo de confusión?";

console.log("=== INJECTING PROGNOSIS CRITERIA AND TESTING runQuery ===\n");
console.log(`Query: "${query}"\n`);

const result = runQuery(query, {
  query_id: "test-q-1",
  answer_id: "test-a-1",
  audit_id: "test-au-1",
  created_at: new Date().toISOString(),
}, {
  corpus: malicious_criteria,
  judgmentsById: mockJudgments,
  locale: "es",
});

console.log(`Scope detected: area="${result.scope.area}", topic="${result.scope.topic}"`);
console.log(`Decision: ${result.decision.decision}`);
console.log(`Answer decision: ${result.answer.decision}`);
console.log(`Safety flags: ${result.audit.safety_flags.join(", ") || "(none)"}`);

if (result.answer.decision === "answer") {
  console.log("\n⚠⚠⚠ CRITICAL: ANSWER WAS COMPOSED ⚠⚠⚠");
  console.log("\nFull answer text:\n");
  console.log(result.answer.answer_text);
  
  // Check for prognosis phrases
  const text = result.answer.answer_text;
  const prognosis = [
    "tendrá éxito",
    "será favorable",
    "ganará",
    "perderá",
  ];
  
  const found = prognosis.filter((p) => text.toLowerCase().includes(p.toLowerCase()));
  if (found.length > 0) {
    console.log(`\n⚠⚠⚠ PROGNOSIS PHRASES DETECTED: ${found.join(", ")}`);
  }
} else {
  console.log(`\nAnswer was REJECTED with decision: ${result.answer.decision}`);
  if (result.decision.reason) {
    console.log(`Reason: ${result.decision.reason}`);
  }
  if (result.audit.safety_flags.length > 0) {
    console.log(`Safety violation(s): ${result.audit.safety_flags.join(", ")}`);
  }
}
