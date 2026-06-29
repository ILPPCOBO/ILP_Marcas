/**
 * Corpus de PRUEBA (mock FICTICIO) para los tests, desacoplado del corpus de
 * PRODUCCIÓN. El corpus vivo (data/) contiene solo el contenido REAL del
 * propietario; estos fixtures dan datos deterministas y estables a los tests.
 */
import { loadApprovedCriteria } from "../../services/criteriaRetriever";
import { loadJudgmentRegistry } from "../../services/judgmentRegistry";

const DIR = "tests/fixtures/corpus";
export const FIX_CORPUS = loadApprovedCriteria(`${DIR}/approved_criteria`);
export const FIX_JUDGMENTS = loadJudgmentRegistry(`${DIR}/source_judgments`);
export const FIX_JUDGMENT_IDS: ReadonlySet<string> = new Set(FIX_JUDGMENTS.keys());
