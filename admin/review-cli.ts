/**
 * admin/review-cli — Herramienta de línea de comandos para la REVISIÓN HUMANA.
 *
 * Es la materialización del cuello de botella humano (CLAUDE.md Reglas 14-15):
 * lista los criterios pendientes y permite aprobar / rechazar / editar. Ninguna
 * acción aquí puede aprobar en masa ni saltarse las puertas de servicio.
 *
 * Uso (requiere Node ≥ 22; usa tsx):
 *   npm run review -- list [--status pending_review|rejected]
 *   npm run review -- show <criterion_id>
 *   npm run review -- approve <criterion_id> --by "Nombre Revisor"
 *   npm run review -- reject  <criterion_id> --by "Nombre Revisor" --reason "..."
 *   npm run review -- edit    <criterion_id> --by "Nombre Revisor" --criterion_text "..."
 *   npm run review -- log
 *
 * NOTA: edit por CLI solo admite campos de texto simples; para editar listas
 * (conditions_for_application, etc.) edite el archivo del criterio en
 * data/processed_criteria/ y vuelva a validarlo.
 */
import {
  approveCriterion,
  editCriterion,
  listForReview,
  readReviewLog,
  rejectCriterion,
  type EditableFields,
} from "../services/ingestion";

function parseFlags(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== undefined && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key.includes("=")) {
        const [k, ...v] = key.split("=");
        flags[k ?? ""] = v.join("=");
      } else if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (a !== undefined) {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Valor de una bandera tratando como AUSENTE el "true" sintético que pone
 * parseFlags cuando la bandera va sin valor. Evita aprobadores falsos como
 * `approved_by: "true"` si se olvida el nombre tras --by (Regla 3).
 */
function flagValue(flags: Record<string, string>, key: string): string {
  const v = flags[key];
  return v === undefined || v === "true" ? "" : v;
}

function printItem(item: ReturnType<typeof listForReview>[number]): void {
  const c = item.criterion;
  // eslint-disable-next-line no-console
  console.log(
    `\n[${c.id}]  ${c.review_status}  (${c.area} / ${c.topic}${c.subtopic ? " / " + c.subtopic : ""})\n` +
      `  Resolución: ${c.judgment_id}` +
      (item.judgment ? ` — ${item.judgment.court}, ${item.judgment.date} (${item.judgment.resolution_number})` : " — ⚠️ NO registrada") +
      `\n  Criterio: ${c.criterion_text}\n` +
      `  Fuente: ${c.source_reference} | Extracto: ${c.source_excerpt.slice(0, 120)}…`,
  );
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);
  const log = (m: string): void => {
    // eslint-disable-next-line no-console
    console.log(m);
  };

  if (cmd === "list") {
    // listForReview lee processed_criteria/, donde solo viven pending y rejected
    // (los aprobados se mueven a approved_criteria/). Por eso 'approved' no es un
    // estado listable aquí.
    const raw = flags.status ?? "pending_review";
    if (raw !== "pending_review" && raw !== "rejected") {
      return log('--status admite "pending_review" o "rejected" (los aprobados están en approved_criteria/).');
    }
    const items = listForReview({ status: raw });
    log(`${items.length} criterio(s) en estado "${raw}":`);
    items.forEach(printItem);
    return;
  }

  if (cmd === "show") {
    const id = positionals[0];
    const item = listForReview({}).find((i) => i.criterion.id === id) ??
      listForReview({ status: "rejected" }).find((i) => i.criterion.id === id);
    if (!item) return log(`No encontrado en processed_criteria: ${id}`);
    printItem(item);
    return;
  }

  if (cmd === "approve") {
    const id = positionals[0] ?? "";
    const by = flagValue(flags, "by");
    const r = approveCriterion(id, { now: nowIso(), actor: by });
    log(r.ok ? `✓ Aprobado ${id} por "${by}" y movido a approved_criteria.` : `✗ No aprobado: ${r.errors.join("; ")}`);
    return;
  }

  if (cmd === "reject") {
    const id = positionals[0] ?? "";
    const reason = flagValue(flags, "reason") || "(sin motivo)";
    const r = rejectCriterion(id, { now: nowIso(), actor: flagValue(flags, "by") }, { reason });
    log(r.ok ? `✓ Rechazado ${id}.` : `✗ No rechazado: ${r.errors.join("; ")}`);
    return;
  }

  if (cmd === "edit") {
    const id = positionals[0] ?? "";
    const edits: Partial<EditableFields> = {};
    const textFields: (keyof EditableFields)[] = [
      "topic",
      "subtopic",
      "criterion_text",
      "source_excerpt",
      "source_reference",
    ];
    for (const f of textFields) {
      const v = flagValue(flags, f as string);
      if (v) (edits as Record<string, string>)[f] = v;
    }
    if (Object.keys(edits).length === 0)
      return log('Nada que editar: use --criterion_text "…", --topic "…", --source_reference "…", etc.');
    const r = editCriterion(id, { now: nowIso(), actor: flagValue(flags, "by") }, { edits });
    log(r.ok ? `✓ Editado ${id}; permanece en pending_review.` : `✗ No editado: ${r.errors.join("; ")}`);
    return;
  }

  if (cmd === "log") {
    for (const e of readReviewLog("data/review_log.jsonl")) {
      log(`${e.at}  ${e.action.toUpperCase()}  ${e.criterion_id}  por ${e.actor}  — ${e.detail}`);
    }
    return;
  }

  log(
    'Comandos: list [--status pending_review|rejected] | show <id> | approve <id> --by X | ' +
      'reject <id> --by X --reason Y | edit <id> --by X --criterion_text "…" | log',
  );
}

main();
