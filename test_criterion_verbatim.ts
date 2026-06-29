/**
 * Test if criterion_text with prognosis language is emitted verbatim.
 * According to CLAUDE.md Regla 4, criterion_text is VERBATIM from the corpus.
 * But Regla 18 should veto prognosis language even in approved criteria.
 */

import { composeAnswer } from "./services/answerComposer";
import type { LegalCriterion, DecisionResult, ScopeResult } from "./services/models";

const criteria_with_prognosis: LegalCriterion[] = [
  {
    id: "crit-prog-001",
    judgment_id: "jdg-prog-001",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_signos",
    criterion_text: "Si ambos signos son idénticos, tendrá éxito en la acción de infracción.",
    conditions_for_application: ["Identidad de signos"],
    does_not_answer: [],
    limits: [],
    source_excerpt: "Test",
    source_reference: "PROG-001",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "test",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
  {
    id: "crit-prog-002",
    judgment_id: "jdg-prog-002",
    area: "marcas",
    topic: "riesgo_de_confusion",
    subtopic: "similitud_de_productos",
    criterion_text: "Cuando el demandado no tiene defensa, la sentencia será favorable al demandante.",
    conditions_for_application: [],
    does_not_answer: ["Causal de nulidad"],
    limits: ["No aplicable a renovaciones"],
    source_excerpt: "Test",
    source_reference: "PROG-002",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
    approved_by: "test",
    approved_at: "2026-06-11T12:00:00Z",
    created_at: "2026-06-11T12:00:00Z",
    updated_at: "2026-06-11T12:00:00Z",
  },
];

const scope: ScopeResult = {
  area: "Marcas",
  topic: "riesgo de confusión",
  subtopics: [],
  out_of_scope: false,
  confidence: "high",
  reason: "Matched",
};

const decision: DecisionResult = {
  decision: "answer",
  reason: "Test",
  clarifying_questions: [],
};

console.log("=== TESTING CRITERION_TEXT VERBATIM WITH PROGNOSIS ===\n");

try {
  const answer = composeAnswer(
    {
      question: "¿Hay riesgo de confusión?",
      scope,
      decision,
      criteria: criteria_with_prognosis,
      locale: "es",
      translation_uncertain: false,
    },
    {
      id: "ans-test-001",
      query_id: "q-test-001",
      created_at: new Date().toISOString(),
    }
  );

  console.log("✗ CRITICAL: composeAnswer DID NOT THROW");
  console.log("\nAnswer text emitted:\n");
  console.log(answer.answer_text);
  
  // Check if prognosis leaked
  if (/tendrá éxito|será favorable/.test(answer.answer_text)) {
    console.log("\n⚠⚠⚠ PROGNOSIS LANGUAGE REACHED THE USER ⚠⚠⚠");
  }
} catch (err: any) {
  console.log("✓ GOOD: composeAnswer THREW an error");
  console.log(`\nError: ${err.message}`);
}
