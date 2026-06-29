/**
 * i18n/glossary — Traducción/normalización DETERMINISTA por glosario CERRADO.
 *
 * Dos direcciones, ambas con vocabulario cerrado (no LLM, no red, no derecho
 * anglosajón — Reglas 2, 3, 5):
 *   - EN→ES: normaliza la consulta en inglés añadiendo los términos ESPAÑOLES
 *     que el clasificador y el detector ya entienden, para que el razonamiento
 *     siga ocurriendo sobre la base española. NO traduce derecho extranjero: solo
 *     mapea términos a los conceptos del corpus español.
 *   - ES→EN: etiquetas de área/tema (vocabulario finito) para presentar la
 *     respuesta en inglés. El contenido sustantivo de los criterios y las
 *     FUENTES no se traducen aquí (se mantienen en español).
 *
 * Si la consulta en inglés no mapea ningún término del corpus, se marca
 * `uncertain` para advertir de la duda de traducción (Regla 6).
 */
import type { Locale } from "./locale";

// EN→ES: cada término inglés añade las palabras ESPAÑOLAS equivalentes que el
// léxico del clasificador y las señales del detector reconocen.
// GLOSSARY-JSON-BEGIN
const EN_TO_ES_JSON = `[
  { "en": ["trademark", "trade mark", "brand"], "es": "marca" },
  { "en": ["logo", "logotype"], "es": "logo" },
  { "en": ["sign", "device"], "es": "signo" },
  { "en": ["similar", "confusingly similar", "looks like", "resembles", "alike", "likeness", "likelihood of confusion"], "es": "parecido similar confusion" },
  { "en": ["identical", "the same"], "es": "identico" },
  { "en": ["bad faith"], "es": "mala fe" },
  { "en": ["block", "obstruct", "hijack"], "es": "bloquear obstaculizar" },
  { "en": ["priority", "earlier", "registered first", "filed first", "filing date"], "es": "prioridad anterioridad fecha de solicitud" },
  { "en": ["well-known", "well known", "famous", "reputed", "reputation", "renowned"], "es": "renombrada notoria famosa" },
  { "en": ["ownership claim", "reclaim", "registered in someone else", "registered by another"], "es": "reivindicatoria registrada por otro" },
  { "en": ["copyright", "author", "authorship"], "es": "autoria autor obra" },
  { "en": ["work", "artwork", "song", "photograph", "photo", "software", "book", "design"], "es": "obra cancion fotografia software libro diseño" },
  { "en": ["plagiarism", "plagiarize", "copied"], "es": "plagio copia" },
  { "en": ["employee", "employment", "employer", "staff", "payroll"], "es": "empleado trabajador relacion laboral contrato laboral nomina" },
  { "en": ["within his duties", "job duties", "as part of the job", "scope of employment"], "es": "funciones su puesto encargo" },
  { "en": ["communication to the public", "public communication", "made available", "broadcast", "streaming", "stream"], "es": "comunicacion publica puesta a disposicion difusion" },
  { "en": ["damages", "compensation", "harm", "loss"], "es": "indemnizacion daños perjuicios" },
  { "en": ["royalty", "royalties", "license fee", "licence fee", "licensing fee"], "es": "regalia licencia canon" },
  { "en": ["patent", "invention"], "es": "patente invencion" },
  { "en": ["infringe", "infringement", "infringing", "uses my patent"], "es": "infraccion infringe" },
  { "en": ["validity", "nullity", "invalid", "lack of novelty", "prior art"], "es": "validez nulidad novedad" },
  { "en": ["injunction", "interim measures", "preliminary injunction", "interim relief", "provisional measures"], "es": "medidas cautelares" },
  { "en": ["statute of limitations", "time-barred", "time barred", "limitation period", "out of time"], "es": "prescripcion plazo para reclamar" },
  { "en": ["costs", "legal costs"], "es": "costas" },
  { "en": ["evidence", "proof", "burden of proof", "witness", "expert report"], "es": "prueba carga de la prueba testigo pericial" },
  { "en": ["registered", "registration", "registered trademark"], "es": "registrada registro" },
  { "en": ["not registered", "unregistered"], "es": "sin registrar" },
  { "en": ["spain", "spanish"], "es": "españa" },
  { "en": ["territory", "country", "region", "europe"], "es": "territorio pais europa" },
  { "en": ["sell", "sells", "selling", "we sell", "market", "commercial"], "es": "vende empresa mercado actividad comercial" },
  { "en": ["products", "goods", "cosmetics", "product"], "es": "productos" },
  { "en": ["services", "service"], "es": "servicios" },
  { "en": ["company", "competitor", "business"], "es": "empresa competidor" },
  { "en": ["contract", "agreement", "clause"], "es": "contrato acuerdo clausula" },
  { "en": ["urgent", "imminent", "right now"], "es": "urgente inminente" },
  { "en": ["fiscal", "tax", "taxes"], "es": "fiscal impuestos" },
  { "en": ["criminal", "crime"], "es": "penal delito" },
  { "en": ["defamation", "slander", "libel"], "es": "difamacion calumnia injuria" }
]`;
// GLOSSARY-JSON-END

interface GlossaryEntry {
  en: string[];
  es: string;
}
const EN_TO_ES: GlossaryEntry[] = JSON.parse(EN_TO_ES_JSON) as GlossaryEntry[];

export interface NormalizedQuery {
  /** Texto para el razonamiento español (original + términos del corpus). */
  spanish: string;
  /** true si no se reconoció ningún término del corpus (duda, Regla 6). */
  uncertain: boolean;
  /** Nº de entradas del glosario que coincidieron (para diagnóstico). */
  matched: number;
}

/**
 * Normaliza la consulta para el razonamiento español. En "es", la devuelve sin
 * cambios. En "en", añade los términos españoles del corpus que correspondan.
 */
export function normalizeQuery(text: string, locale: Locale): NormalizedQuery {
  if (locale !== "en") return { spanish: text, uncertain: false, matched: 0 };
  const low = " " + text.toLowerCase() + " ";
  const add: string[] = [];
  let matched = 0;
  for (const entry of EN_TO_ES) {
    if (entry.en.some((p) => low.includes(p.toLowerCase()))) {
      matched++;
      add.push(entry.es);
    }
  }
  return { spanish: `${text} ${add.join(" ")}`.trim(), uncertain: matched === 0, matched };
}

// ES→EN: presentación cerrada (áreas, temas y preguntas de aclaración). Vocabulario
// FINITO leído como bloque JSON: es la fuente ÚNICA que comparten el motor servido
// (demo/serve_demo.py) y el offline (demo/standalone) vía _between. Las fuentes,
// órganos, números de resolución y fechas NUNCA se traducen.
// I18N-EN-JSON-BEGIN
const I18N_EN_JSON = `{
  "areas": {
    "Marcas": "Trademarks",
    "Propiedad intelectual": "Intellectual property",
    "Patentes": "Patents",
    "Procesal": "Procedural",
    "Fuera de alcance": "Out of scope"
  },
  "topics": {
    "riesgo de confusión": "likelihood of confusion",
    "mala fe": "bad faith",
    "prioridad registral": "registration priority",
    "marca renombrada": "well-known mark",
    "acción reivindicatoria": "revendication action",
    "agotamiento": "exhaustion of rights",
    "distintividad": "distinctive character",
    "eslogan": "slogan",
    "indemnizacion": "damages",
    "ius prohibendi": "right to prohibit",
    "libre imitacion competencia": "imitation in competition",
    "prohibiciones absolutas": "absolute grounds for refusal",
    "regalia hipotetica": "hypothetical royalty",
    "transmision marca": "mark assignment",
    "uso efectivo": "genuine use",
    "uso trafico economico": "use in economic traffic",
    "autoría": "authorship",
    "obra laboral": "work made in the course of employment",
    "comunicación pública": "public communication",
    "indemnización": "damages",
    "regalía hipotética": "hypothetical royalty",
    "acumulacion pi diseno": "cumulative protection design",
    "bases de datos": "databases",
    "canon copia privada": "private copying levy",
    "canon digital": "digital levy",
    "cesion multiuso pi marca": "multi-use IP and mark assignment",
    "cesion tecnologia": "technology transfer",
    "diseno industrial": "industrial design",
    "infraccion": "infringement",
    "nfts fair use": "NFTs fair use",
    "obra protegible": "protectable work",
    "plagio": "plagiarism",
    "software": "software",
    "titulo obra": "work title",
    "infracción": "infringement",
    "validez": "validity",
    "medidas cautelares": "preliminary injunctions",
    "patentabilidad": "patentability",
    "cosa juzgada": "res judicata",
    "prescripción": "limitation period",
    "costas": "costs",
    "prueba": "evidence",
    "competencia objetiva": "material jurisdiction",
    "cuestiones procesales pi": "procedural issues in IP",
    "desistimiento renuncia": "withdrawal and waiver",
    "estafa comercial": "commercial fraud"
  },
  "checklist": {
    "¿Está registrado alguno de los signos (el suyo o el del otro)? ¿O se usan sin registro?": "Is either sign (yours or the other's) registered? Or are they used without registration?",
    "¿Cuáles son los dos signos que se están comparando (palabras, logos, envases…) y en qué se parecen?": "What are the two signs being compared (words, logos, packaging…) and in what respects do they resemble each other?",
    "¿A qué productos o servicios se dedica cada parte? ¿Son los mismos o similares?": "What products or services does each party provide? Are they the same or similar?",
    "¿Ambas partes están operando comercialmente en la actualidad (venden u ofrecen algo)?": "Are both parties currently operating commercially (selling or offering goods or services)?",
    "¿En qué territorio se usa o está registrado cada signo?": "In what territory is each sign used or registered?",
    "¿Quién solicitó o registró la marca, y cuándo?": "Who applied for or registered the trade mark, and when?",
    "¿Existía alguna relación previa entre las partes (socios, distribuidor, empleado, negociaciones…)?": "Was there any prior relationship between the parties (partners, distributor, employee, negotiations…)?",
    "¿El solicitante conocía el signo o su uso antes de pedir el registro? ¿Cómo lo sabe?": "Did the applicant know of the sign or its use before filing the application? How do you know?",
    "¿Qué indicios apuntan a que el registro buscaba bloquear su actividad o aprovecharse del signo (exigencias económicas, impedimentos…)?": "What indications suggest that the registration was intended to block your activity or take unfair advantage of the sign (financial demands, obstruction…)?",
    "¿En qué fecha se solicitó o registró cada uno de los signos?": "On what date was each sign applied for or registered?",
    "¿Ambos signos están registrados, o alguno solo se usa en el mercado sin registro?": "Are both signs registered, or is one used in the market without registration?",
    "¿Qué elementos acreditan el renombre de la marca (publicidad, volumen de ventas, reconocimiento del público…)?": "What evidence establishes the reputation of the trade mark (advertising, sales volume, public recognition…)?",
    "¿Para qué productos o servicios usa cada parte su signo? ¿Coinciden o son distintos?": "For what products or services does each party use their sign? Are they the same or different?",
    "¿Quién registró el signo y a nombre de quién figura?": "Who registered the sign and in whose name is it registered?",
    "¿Qué vínculo previo tenía usted con el signo (uso anterior, creación…)? ¿Desde cuándo?": "What prior connection did you have with the sign (prior use, creation…)? Since when?",
    "¿Qué relación existía entre usted y quien registró el signo?": "What relationship existed between you and the person who registered the sign?",
    "¿Quién creó la obra y en qué circunstancias?": "Who created the work and in what circumstances?",
    "¿Qué tipo de obra es (texto, música, fotografía, software…)?": "What type of work is it (text, music, photograph, software…)?",
    "¿Quién está cuestionando o atribuyéndose la autoría, y en qué se basa?": "Who is disputing or claiming authorship of the work, and on what grounds?",
    "¿Quién creó la obra?": "Who created the work?",
    "¿Existía una relación laboral formal entre el creador y la empresa (contrato, nómina…)?": "Was there a formal employment relationship between the creator and the company (contract, payroll…)?",
    "¿Crear ese tipo de obra formaba parte de las funciones o encargos de su puesto, o fue algo al margen?": "Was creating that type of work part of your job functions or duties, or was it incidental?",
    "¿Hay algún contrato o pacto escrito que regule los derechos sobre lo creado?": "Is there a written contract or agreement governing the rights in the created work?",
    "¿Qué tipo de obra se está difundiendo?": "What type of work is being communicated to the public?",
    "¿Cómo y dónde se está difundiendo la obra (internet, un local, televisión…)?": "How and where is the work being communicated (internet, premises, television…)?",
    "¿Quién realiza la difusión y cuenta (o no) con alguna autorización o licencia?": "Who is communicating the work and do they have authorization or a licence?",
    "¿Qué hecho concreto entiende que causó el daño (copia, uso no autorizado…)?": "What specific act do you consider caused the damage (copying, unauthorized use…)?",
    "¿Qué perjuicio concreto ha sufrido (pérdida de ventas, ingresos, encargos…)?": "What specific harm have you suffered (loss of sales, revenue, commissions…)?",
    "¿Con qué referencia querría cuantificarlo (lo que habría costado una licencia, el beneficio del otro…)?": "By what reference would you quantify it (what a licence would have cost, the infringer's profit…)?",
    "¿Qué uso concreto de la obra se hizo sin autorización?": "What specific use of the work was made without authorization?",
    "¿Existen referencias de lo que se cobra por licenciar usos similares (tarifas propias o del sector)?": "Are there references to what is charged for licensing similar uses (your rates or industry rates)?",
    "¿Qué patente invoca (concedida o en trámite) y quién es su titular?": "What patent do you rely upon (granted or pending) and who is its proprietor?",
    "¿Qué producto o procedimiento del tercero entiende que infringe la patente?": "What product or process of the third party do you believe infringes the patent?",
    "¿En qué coincide ese producto o procedimiento con lo que protege su patente?": "In what respects does that product or process coincide with what your patent protects?",
    "¿Qué patente se cuestiona y quién es su titular?": "What patent is being challenged and who is its proprietor?",
    "¿Por qué motivo se cuestiona la validez (falta de novedad, divulgación previa…)?": "On what grounds is the validity challenged (lack of novelty, prior disclosure…)?",
    "¿Qué derecho concreto invoca (patente, marca, obra…) y está registrado o concedido?": "What specific right do you rely upon (patent, trade mark, copyright work…) and is it registered or granted?",
    "¿Por qué la situación es urgente y no puede esperar al procedimiento ordinario?": "Why is the situation urgent and cannot await ordinary proceedings?",
    "¿Qué daño se está produciendo o se producirá mientras tanto?": "What harm is occurring or will occur in the interim?",
    "¿Qué elementos respaldan a primera vista su derecho (títulos, registros, certificados…)?": "What evidence prima facie supports your right (titles, registrations, certificates…)?",
    "¿Qué pruebas tiene disponibles ahora mismo?": "What evidence do you have available now?",
    "¿Existió un proceso o litigio anterior YA resuelto sobre este asunto? ¿Con sentencia o auto firme?": "Was there a previous proceeding or litigation already resolved on this matter? With a judgment or final order?",
    "¿Qué se resolvió exactamente en aquel proceso anterior?": "What was the exact resolution in that previous proceeding?",
    "¿Coinciden las partes (o sus causahabientes) entre el proceso anterior y el actual?": "Are the parties (or their successors in title) the same in the previous and current proceedings?",
    "¿Coincide (total o parcialmente) el objeto o la pretensión entre ambos procesos?": "Does the subject matter or claim coincide (wholly or in part) between the two proceedings?",
    "¿Qué derecho concreto invoca y en qué se basa su titularidad?": "What specific right do you rely upon and what is your entitlement based on?",
    "¿Qué daño se está produciendo o se producirá mientras se resuelve el pleito?": "What harm is occurring or will occur whilst the case is being resolved?",
    "¿Qué elementos respaldan a primera vista su derecho (títulos, registros, documentos…)?": "What evidence prima facie supports your right (titles, registrations, documents…)?",
    "¿Cuándo ocurrió el hecho y cuándo tuvo usted conocimiento de él?": "When did the event occur and when did you become aware of it?",
    "¿Qué acción concreta quiere ejercitar (reclamación, demanda…)?": "What specific action do you wish to pursue (claim, court action…)?",
    "¿Hubo reclamaciones previas (burofax, requerimientos…) y en qué fechas?": "Were there prior claims (formal notices, demands…) and on what dates?",
    "¿Cómo terminó el procedimiento (estimación total, parcial, desestimación…)?": "How did the proceedings terminate (full grant, partial grant, dismissal…)?",
    "¿Qué se discute exactamente: a quién se imponen las costas o su importe?": "What is disputed exactly: who should bear the costs or their quantum?",
    "¿Qué hecho concreto necesita probar?": "What specific fact do you need to prove?",
    "¿De qué medios de prueba dispone (documentos, testigos, peritos…)?": "What evidence do you have available (documents, witnesses, expert reports…)?",
    "¿En qué momento procesal está (antes de demandar, en juicio, en recurso…)?": "At what stage of proceedings are you (pre-action, in suit, on appeal…)?",
    "¿Podría concretar qué aspecto de su marca le preocupa (parecido a otro signo, quién registró primero, mala fe, renombre, recuperación del registro…)?": "Could you specify which aspect of your trade mark concerns you (similarity to another sign, priority of registration, bad faith, reputation, recovery of rights…)?",
    "¿Podría concretar qué cuestión sobre la obra le preocupa (autoría, creación en el trabajo, difusión pública, indemnización…)?": "Could you specify which issue concerning the work concerns you (authorship, creation in the course of employment, public communication, damages…)?",
    "¿Podría concretar qué cuestión sobre la patente le preocupa (posible infracción, validez, medidas urgentes…)?": "Could you specify which issue concerning the patent concerns you (possible infringement, validity, urgent measures…)?",
    "¿Podría concretar la cuestión procesal (medidas cautelares, plazos, costas, prueba…)?": "Could you specify the procedural issue (provisional measures, time limits, costs, evidence…)?",
    "¿Podría concretar el tema de su consulta?": "Could you specify the subject of your query?",
    "Su consulta podría encajar en más de una materia del corpus. ¿Podría reformularla concretando el aspecto que más le interesa?": "Your query could fall under more than one subject area of the corpus. Could you rephrase it, specifying the aspect you are most interested in?"
  }
}`;
// I18N-EN-JSON-END
interface I18nEn {
  areas: Record<string, string>;
  topics: Record<string, string>;
  checklist: Record<string, string>;
}
const I18N_EN: I18nEn = JSON.parse(I18N_EN_JSON) as I18nEn;
const AREA_EN: Record<string, string> = I18N_EN.areas;
const TOPIC_EN: Record<string, string> = I18N_EN.topics;
const CHECKLIST_EN: Record<string, string> = I18N_EN.checklist;

/** Etiqueta de área en el idioma dado (es: tal cual; en: traducción cerrada). */
export function areaLabel(area: string, locale: Locale): string {
  if (locale !== "en") return area;
  return AREA_EN[area] ?? area;
}

/** ¿El área tiene traducción inglesa conocida? (si no, hay duda — Regla 6). */
export function areaKnown(area: string): boolean {
  return Object.prototype.hasOwnProperty.call(AREA_EN, area);
}

/**
 * Etiqueta de tema en el idioma dado. Devuelve también si la traducción es
 * conocida (si no lo es en inglés, hay duda de traducción — Regla 6).
 */
export function topicLabel(topic: string | null, locale: Locale): { label: string | null; known: boolean } {
  if (topic === null) return { label: null, known: true };
  if (locale !== "en") return { label: topic, known: true };
  const en = TOPIC_EN[topic];
  return { label: en ?? topic, known: en !== undefined };
}

/**
 * Traduce una pregunta de aclaración del corpus (vocabulario cerrado). En 'es' la
 * devuelve igual; en 'en' usa el mapa cerrado y, si no la conoce, la deja en
 * español (no inventa traducción — Regla 4).
 */
export function clarifyingQuestionLabel(question: string, locale: Locale): string {
  if (locale !== "en") return question;
  return CHECKLIST_EN[question] ?? question;
}
