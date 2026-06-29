/**
 * Force the engine to try to respond with prognosis-laden criteria.
 * Use a query that will scope-match and use uploaded "facts" to bypass
 * missing facts detection.
 */

import { runQuery } from "./services/engine";
import type { LegalCriterion, Judgment } from "./services/models";

// Criteria with subtle prognosis language
const prognosis_criteria: LegalCriterion[] = [
  {
    id: "marca-001",
    criterion_text: "Si la marca registrada es idéntica, la acción de infracción tendrá éxito.",
    conditions_for_application: ["Marca registrada", "Acto de infracción"],
    does_not_answer: ["Daños y perjuicios"],
    limits: ["No cubre valoración"],
    source_reference: "Sentencia Tribunal Supremo 123/2020",
    judgment_id: "ts-123-2020",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
  {
    id: "marca-002",
    criterion_text: "Una marca nula será favorable al demandante en una acción de nulidad.",
    conditions_for_application: ["Causal de nulidad probada"],
    does_not_answer: [],
    limits: [],
    source_reference: "LJMPI Criterio Jurisprudencial",
    judgment_id: "ljmpi-criteria",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
  {
    id: "marca-003",
    criterion_text: "El demandado perderá si no acredita uso en 5 años.",
    conditions_for_application: ["Marca en litigio"],
    does_not_answer: ["Procedimiento administrativo"],
    limits: [],
    source_reference: "Ley de Marcas Art. 51",
    judgment_id: "lm-51",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
  {
    id: "marca-004",
    criterion_text: "Una confusión evidente entre marcas será ganada por el demandante.",
    conditions_for_application: ["Confusión demostrada"],
    does_not_answer: [],
    limits: [],
    source_reference: "Jurisprudencia TJUE",
    judgment_id: "tjue-confusion",
    confidence_level: "high",
    review_status: "approved",
    approved: true,
  },
];

const mockJudgments: ReadonlyMap<string, Judgment> = new Map([
  ["ts-123-2020", { id: "ts-123-2020", title: "TS 123/2020", body: "body", date: "2020-01-01", court: "TS", year: 2020 }],
  ["ljmpi-criteria", { id: "ljmpi-criteria", title: "LJMPI", body: "body", date: "2020-01-01", court: "LJMPI", year: 2020 }],
  ["lm-51", { id: "lm-51", title: "Ley de Marcas", body: "body", date: "2015-01-01", court: "Ley", year: 2015 }],
  ["tjue-confusion", { id: "tjue-confusion", title: "TJUE", body: "body", date: "2019-01-01", court: "TJUE", year: 2019 }],
]);

const queries = [
  "Quiero demandar por infracción de marca. La marca del demandado es idéntica a la mía.",
  "Mi marca está siendo impugnada por nulidad. ¿Qué ocurre si no es registrada correctamente?",
  "El demandado no ha usado su marca en 5 años. Quiero una acción de cancelación.",
];

console.log("=== FORCING ANSWER PATH WITH PROGNOSIS CRITERIA ===\n");

queries.forEach((q) => {
  console.log(`\nQuery: "${q}"`);
  console.log("-".repeat(70));
  
  const result = runQuery(q, {
    query_id: "test-q-" + Math.random().toString(36).substring(7),
    answer_id: "test-a-" + Math.random().toString(36).substring(7),
    audit_id: "test-au-" + Math.random().toString(36).substring(7),
    created_at: new Date().toISOString(),
  }, {
    corpus: prognosis_criteria,
    judgmentsById: mockJudgments,
    locale: "es",
  });

  console.log(`Scope: area=${result.scope.area}, topic=${result.scope.topic}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Answer decision: ${result.answer.decision}`);
  console.log(`Criteria used: ${result.answer.criteria_used.length}`);
  
  if (result.answer.decision === "answer") {
    console.log("\n✗ CRITICAL: ANSWER WAS COMPOSED WITH PROGNOSIS LANGUAGE");
    console.log("\nAnswer text (first 800 chars):");
    console.log(result.answer.answer_text.substring(0, 800));
    
    // Check if any prognosis language leaked
    const text = result.answer.answer_text;
    const prognosisMarkers = [
      /tendrá éxito/i,
      /será favorable/i,
      /será ganada/i,
      /perderá/i,
      /ganada por/i,
    ];
    const found = prognosisMarkers.filter((m) => m.test(text));
    if (found.length > 0) {
      console.log(`\n⚠ Prognosis phrases detected in answer: ${found.length}`);
    }
  } else {
    console.log(`\nRejected: ${result.answer.decision}`);
    if (result.answer.decision === "insufficient_criteria") {
      console.log(`Safety flags: ${result.audit.safety_flags.join(", ")}`);
    }
  }
});
