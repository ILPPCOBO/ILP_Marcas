/**
 * legal/citations — Nombre de resolución LEGIBLE para mostrar al usuario (Regla 9).
 *
 * Expande las siglas del nombre de la resolución conservando número, sala/sección y
 * fecha; NO traduce ni inventa (solo aclara abreviaturas). Lógica IDÉNTICA a la del
 * motor servido (demo/serve_demo.py: readable_citation) y el offline
 * (demo/standalone_brain.js: readableCitation). FUENTE ÚNICA en el lado TS: la usan
 * answerComposer, caseScoreboard y caseEvaluator.
 */
const ECLI_COURT: Record<string, string> = {
  TS: "del Tribunal Supremo",
  AN: "de la Audiencia Nacional",
  APB: "de la Audiencia Provincial de Barcelona",
  APM: "de la Audiencia Provincial de Madrid",
  APA: "de la Audiencia Provincial de Alicante",
  AP: "de la Audiencia Provincial",
  TSJ: "del Tribunal Superior de Justicia",
};

function cleanSr(sr: string): string {
  let s = (sr || "").trim();
  s = s.replace(/\s*Fecha:\s*/g, ", ").replace(/\s*(Materia|Sentencia|Auto):\s*$/, "");
  const parts = s.split(",").map((p) => p.trim()).filter((p) => p !== "");
  const out: string[] = [];
  for (const p of parts) {
    const last = out.length ? out[out.length - 1] : undefined;
    if (last !== undefined && last.toLowerCase() === p.toLowerCase()) continue;
    out.push(p);
  }
  return out.join(", ");
}

function resolutionName(raw: string): string {
  raw = (raw || "").trim();
  const sr = cleanSr(raw);
  const ci = sr.indexOf(",");
  const head = ci >= 0 ? sr.slice(0, ci).trim() : sr;
  let fecha = ci >= 0 ? sr.slice(ci + 1).trim() : "";
  let m = head.match(/^STJUE\s+(.*)$/);
  if (m) {
    const n = "Sentencia del Tribunal de Justicia de la UE, asunto " + (m[1] ?? "").trim();
    return n + (fecha ? ", de " + fecha : "");
  }
  m = head.match(/^(?:([SA])\s*)?JM\s*(?:n[ºo°]\s*)?(\d+)\s+([A-ZÁÉÍÓÚ][\wÁÉÍÓÚáéíóúñ]+)\s*(.*)$/);
  if (m) {
    const njz = m[2] ?? "", city = m[3] ?? "", inline = (m[4] ?? "").trim();
    const org = "del Juzgado de lo Mercantil nº " + njz + " de " + city;
    let tipo = (m[1] ?? "S") === "S" ? "Sentencia" : "Auto";
    let num = "";
    const mb = fecha.match(/^(Sentencia|Auto)\s+(\d+\/\d+)/);
    if (mb) {
      tipo = mb[1] ?? tipo;
      num = mb[2] ?? "";
      fecha = fecha.slice((mb[0] ?? "").length).replace(/^[,\s]+/, "").trim();
    } else if (inline) {
      const mi = inline.match(/^(\d+\/\d+)/);
      if (mi) num = mi[1] ?? "";
    }
    let name = tipo + " " + org;
    if (num) name += ", nº " + num;
    if (fecha) name += ", de " + fecha;
    return name;
  }
  m = head.match(/^([SA])\s+(.*)$/);
  if (!m) return raw;
  const tipo = (m[1] ?? "") === "S" ? "Sentencia" : "Auto";
  const rest = (m[2] ?? "").trim();
  let org: string | null = null;
  let rest2 = "";
  let mm = rest.match(/^TS(?![A-Z])\s*(.*)$/); // TS pero NO TSJ (Tribunal Superior de Justicia)
  if (mm) {
    org = "del Tribunal Supremo";
    rest2 = (mm[1] ?? "").trim();
  } else {
    mm = rest.match(/^AP\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+(?:\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚñáéíóú]+)?)\s*(.*)$/);
    if (mm) {
      org = "de la Audiencia Provincial de " + (mm[1] ?? "").trim();
      rest2 = (mm[2] ?? "").trim();
    } else {
      mm = rest.match(/^TSJ\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚñáéíóú]+)\s*(.*)$/);
      if (mm) {
        org = "del Tribunal Superior de Justicia de " + (mm[1] ?? "").trim();
        rest2 = (mm[2] ?? "").trim();
      }
    }
  }
  if (org === null) return raw;
  const num = rest2.trim();
  let name = tipo + " " + org;
  if (num) name += /^\d/.test(num) ? ", nº " + num : " " + num;
  if (fecha) name += ", de " + fecha;
  return name;
}

function readableJudgmentId(jid: string): string {
  jid = (jid || "").trim();
  const m = jid.match(/^ECLI[-:]ES[-:]([A-Z]+)[-:](\d{4})[-:](.+)$/);
  if (m) {
    const code = m[1] ?? "", year = m[2] ?? "", num = m[3] ?? "";
    const court = ECLI_COURT[code] || "";
    const tipo = /A$/i.test(num.trim()) ? "Auto" : "Sentencia";
    const ecli = "ECLI:ES:" + code + ":" + year + ":" + num;
    return court ? tipo + " " + court + " (" + ecli + ")" : "Resolución (" + ecli + ")";
  }
  return "";
}

/**
 * Cita LEGIBLE de la fuente (Regla 9): nombre de resolución con siglas expandidas;
 * si es un pinpoint sobre una resolución ECLI, antepone la resolución decodificada;
 * en otro caso conserva el formato verbatim «source_reference (resolución id)».
 * Acepta cualquier objeto con source_reference + judgment_id (criterio o factor).
 */
export function readableCitation(c: { source_reference: string; judgment_id: string }): string {
  const sr = (c.source_reference || "").trim();
  const jid = (c.judgment_id || "").trim();
  const name = resolutionName(sr);
  if (name && name !== sr) return name;
  const j = readableJudgmentId(jid);
  if (j) return sr ? j + ", " + sr : j;
  if (sr && jid) return sr + " (resolución " + jid + ")";
  return sr || jid;
}
