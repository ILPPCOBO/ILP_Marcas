/**
 * missingFactsDetector — Paso 3 del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Tras la clasificación de scopeClassifier, detecta si faltan DATOS ESENCIALES
 * para poder buscar criterios o responder de forma prudente. Si faltan, el
 * sistema debe repreguntar antes de responder (Regla 7).
 *
 * Reglas de CLAUDE.md que aplica:
 *   - Regla 7: consulta ambigua/incompleta => preguntas de aclaración.
 *   - Regla 3 / §6 "El LLM nunca decide": detección determinista con LISTAS
 *     CERRADAS de hechos esenciales por tema; las preguntas salen de PLANTILLAS
 *     FIJAS revisadas, jamás de generación libre.
 *   - Regla 17 (deny-by-default): un hecho cuenta como presente SOLO si el
 *     usuario lo menciona (señales del léxico). No se asume que exista marca
 *     registrada, ni relación laboral, ni infracción: lo no dicho, se pregunta.
 *   - Regla 16: missing_facts deja traza auditable de qué faltó.
 *
 * Decisiones de diseño:
 *   - Un hecho esencial se considera MENCIONADO si alguna de sus señales
 *     (misma convención del léxico cerrado: token exacto, "prefij*", frases)
 *     aparece en la consulta. Mencionado ≠ verificado: la veracidad no se
 *     comprueba aquí; solo se evita repreguntar lo ya dicho.
 *   - Consulta fuera de alcance => {needs_clarification: false, [], []}: NO
 *     significa "todo claro", sino que la respuesta correcta es el rechazo del
 *     motor (Regla 8), no una repregunta que invite a continuar.
 *   - Área sin tema concreto, o tema sin checklist definida => repregunta
 *     genérica del área (deny-by-default: sin checklist no se presume
 *     suficiencia).
 *   - Este módulo NO responde al usuario ni inventa hechos: solo devuelve
 *     hechos faltantes y sus preguntas de plantilla.
 */
import type { MissingFactsResult, ScopeResult } from "./types";
import { matchesAnyKeyword, normalize } from "./scopeClassifier";

// ---------------------------------------------------------------------------
// LISTAS CERRADAS de hechos esenciales por tema (fuente única; el espejo de
// verificación las parsea tal cual). Las preguntas son plantillas fijas,
// neutrales (no presuponen registro, infracción ni culpa) y revisables.
// CHECKLISTS-JSON-BEGIN
const CHECKLISTS_JSON = `{
  "area_fallback": {
    "Marcas": {
      "fact": "tema concreto de la consulta",
      "question": "¿Podría concretar qué aspecto de su marca le preocupa (parecido a otro signo, quién registró primero, mala fe, renombre, recuperación del registro…)?"
    },
    "Propiedad intelectual": {
      "fact": "tema concreto de la consulta",
      "question": "¿Podría concretar qué cuestión sobre la obra le preocupa (autoría, creación en el trabajo, difusión pública, indemnización…)?"
    },
    "Patentes": {
      "fact": "tema concreto de la consulta",
      "question": "¿Podría concretar qué cuestión sobre la patente le preocupa (posible infracción, validez, medidas urgentes…)?"
    },
    "Procesal": {
      "fact": "tema concreto de la consulta",
      "question": "¿Podría concretar la cuestión procesal (medidas cautelares, plazos, costas, prueba…)?"
    }
  },
  "checklists": [
    {
      "area": "Marcas",
      "topic": "riesgo de confusión",
      "essential_facts": [
        {
          "fact": "si existe marca registrada",
          "signals": ["registrad*", "registro", "sin registrar", "en tramite"],
          "question": "¿Está registrado alguno de los signos (el suyo o el del otro)? ¿O se usan sin registro?"
        },
        {
          "fact": "cuáles son los signos comparados",
          "signals": ["logo", "logotipo", "signo*", "nombre*", "denominaci*", "palabra*", "letras", "etiqueta*", "envase*"],
          "question": "¿Cuáles son los dos signos que se están comparando (palabras, logos, envases…) y en qué se parecen?"
        },
        {
          "fact": "productos o servicios afectados",
          "signals": ["producto*", "servicio*", "sector", "actividad", "clase", "ramo", "articulo*"],
          "question": "¿A qué productos o servicios se dedica cada parte? ¿Son los mismos o similares?"
        },
        {
          "fact": "si las partes actúan en el mercado",
          "signals": ["empresa*", "negocio*", "vende*", "vendo", "comercializ*", "competidor*", "tienda*", "cliente*", "ofrece*"],
          "question": "¿Ambas partes están operando comercialmente en la actualidad (venden u ofrecen algo)?"
        },
        {
          "fact": "territorio relevante",
          "signals": ["españa", "territorio", "pais*", "provincia*", "region*", "comunidad", "europa", "union europea", "internacional", "local", "ciudad"],
          "question": "¿En qué territorio se usa o está registrado cada signo?"
        }
      ]
    },
    {
      "area": "Marcas",
      "topic": "mala fe",
      "essential_facts": [
        {
          "fact": "quién solicitó la marca",
          "signals": ["solicit*", "registr*", "deposito", "pidio la marca", "a su nombre"],
          "question": "¿Quién solicitó o registró la marca, y cuándo?"
        },
        {
          "fact": "relación previa entre las partes",
          "signals": ["socio*", "exsocio*", "distribuidor*", "agente*", "emplead*", "proveedor*", "relacion", "contrato", "negociacion*", "colabora*", "lo conocia", "nos conociamos"],
          "question": "¿Existía alguna relación previa entre las partes (socios, distribuidor, empleado, negociaciones…)?"
        },
        {
          "fact": "conocimiento previo del signo",
          "signals": ["conocia", "sabia", "conocimiento", "ya usaba", "uso anterior", "usaba antes", "antes de"],
          "question": "¿El solicitante conocía el signo o su uso antes de pedir el registro? ¿Cómo lo sabe?"
        },
        {
          "fact": "indicios de aprovechamiento o bloqueo",
          "signals": ["bloquear*", "obstaculiz*", "aprovech*", "impedir*", "exig*", "revender*", "presion*", "amenaza*"],
          "question": "¿Qué indicios apuntan a que el registro buscaba bloquear su actividad o aprovecharse del signo (exigencias económicas, impedimentos…)?"
        }
      ]
    },
    {
      "area": "Marcas",
      "topic": "prioridad registral",
      "essential_facts": [
        {
          "fact": "fechas de solicitud o registro de cada signo",
          "signals": ["fecha*", "año*", "en 20*", "primero en", "fue posterior", "fue anterior", "registro antes", "solicito antes"],
          "question": "¿En qué fecha se solicitó o registró cada uno de los signos?"
        },
        {
          "fact": "si ambos signos están registrados o solo se usan",
          "signals": ["registrad*", "sin registrar", "solo lo usa", "solo uso", "usaba", "en tramite"],
          "question": "¿Ambos signos están registrados, o alguno solo se usa en el mercado sin registro?"
        }
      ]
    },
    {
      "area": "Marcas",
      "topic": "marca renombrada",
      "essential_facts": [
        {
          "fact": "elementos que acreditan el renombre",
          "signals": ["publicidad", "campaña*", "ventas", "cuota", "encuesta*", "premio*", "prensa", "medios", "decadas", "años en el mercado"],
          "question": "¿Qué elementos acreditan el renombre de la marca (publicidad, volumen de ventas, reconocimiento del público…)?"
        },
        {
          "fact": "productos o servicios de cada parte",
          "signals": ["producto*", "servicio*", "sector", "actividad", "clase", "articulo*"],
          "question": "¿Para qué productos o servicios usa cada parte su signo? ¿Coinciden o son distintos?"
        }
      ]
    },
    {
      "area": "Marcas",
      "topic": "acción reivindicatoria",
      "essential_facts": [
        {
          "fact": "quién registró el signo y a nombre de quién",
          "signals": ["registr*", "a su nombre", "titular*", "solicit*"],
          "question": "¿Quién registró el signo y a nombre de quién figura?"
        },
        {
          "fact": "derecho previo del reclamante sobre el signo",
          "signals": ["usaba", "venia usando", "lo cree", "lo diseñe", "mi marca", "uso anterior", "ya lo usaba"],
          "question": "¿Qué vínculo previo tenía usted con el signo (uso anterior, creación…)? ¿Desde cuándo?"
        },
        {
          "fact": "relación entre las partes",
          "signals": ["socio*", "exsocio*", "distribuidor*", "agente*", "emplead*", "relacion", "contrato", "negociacion*"],
          "question": "¿Qué relación existía entre usted y quien registró el signo?"
        }
      ]
    },
    {
      "area": "Propiedad intelectual",
      "topic": "autoría",
      "essential_facts": [
        {
          "fact": "quién creó la obra",
          "signals": ["cree", "creo", "hice", "hizo", "compuse", "escribi*", "diseñe", "diseño", "fotografi*", "pinte", "desarroll*", "autor*"],
          "question": "¿Quién creó la obra y en qué circunstancias?"
        },
        {
          "fact": "tipo de obra",
          "signals": ["cancion*", "musica", "foto*", "imagen*", "libro*", "texto*", "articulo*", "software", "codigo", "diseño*", "ilustracion*", "video*"],
          "question": "¿Qué tipo de obra es (texto, música, fotografía, software…)?"
        },
        {
          "fact": "quién discute la autoría y por qué",
          "signals": ["dice que", "reclama*", "atribuye*", "niega*", "disputa*", "se la apropi*", "firmo como"],
          "question": "¿Quién está cuestionando o atribuyéndose la autoría, y en qué se basa?"
        }
      ]
    },
    {
      "area": "Propiedad intelectual",
      "topic": "obra laboral",
      "essential_facts": [
        {
          "fact": "quién creó la obra",
          "signals": ["cree", "creo", "hice", "hizo", "diseñe", "diseño", "desarroll*", "escribi*", "compuso", "autor*"],
          "question": "¿Quién creó la obra?"
        },
        {
          "fact": "si existía relación laboral",
          "signals": ["emplead*", "trabajador*", "asalariad*", "contrato laboral", "relacion laboral", "nomina", "plantilla", "mi jefe", "mi empresa"],
          "question": "¿Existía una relación laboral formal entre el creador y la empresa (contrato, nómina…)?"
        },
        {
          "fact": "si la creación estaba dentro de funciones laborales",
          "signals": ["funciones", "encargo*", "su puesto", "su trabajo", "horario", "tareas", "proyecto de la empresa", "para la empresa", "le pedi", "instrucciones"],
          "question": "¿Crear ese tipo de obra formaba parte de las funciones o encargos de su puesto, o fue algo al margen?"
        },
        {
          "fact": "si hay contrato o cesión de derechos",
          "signals": ["contrato", "cesion*", "clausula*", "acuerdo*", "firmado", "firmo", "pacto*", "por escrito"],
          "question": "¿Hay algún contrato o pacto escrito que regule los derechos sobre lo creado?"
        }
      ]
    },
    {
      "area": "Propiedad intelectual",
      "topic": "comunicación pública",
      "essential_facts": [
        {
          "fact": "tipo de obra difundida",
          "signals": ["cancion*", "musica", "foto*", "imagen*", "video*", "pelicula*", "libro*", "texto*", "software"],
          "question": "¿Qué tipo de obra se está difundiendo?"
        },
        {
          "fact": "cómo se difunde o pone a disposición",
          "signals": ["internet", "web", "online", "streaming", "television", "radio", "local", "bar", "tienda", "plataforma*", "redes", "emite*", "difund*", "publica*", "reproduce*"],
          "question": "¿Cómo y dónde se está difundiendo la obra (internet, un local, televisión…)?"
        },
        {
          "fact": "quién realiza el acto y con qué autorización",
          "signals": ["sin permiso", "sin autorizacion", "sin mi consentimiento", "autoriza*", "licencia*", "permiso", "consentimiento"],
          "question": "¿Quién realiza la difusión y cuenta (o no) con alguna autorización o licencia?"
        }
      ]
    },
    {
      "area": "Propiedad intelectual",
      "topic": "indemnización",
      "essential_facts": [
        {
          "fact": "hecho que causa el daño",
          "signals": ["copia*", "plagio", "uso sin", "sin permiso", "sin autorizacion", "infraccion", "vulnera*", "uso no autorizado"],
          "question": "¿Qué hecho concreto entiende que causó el daño (copia, uso no autorizado…)?"
        },
        {
          "fact": "daño o perjuicio concreto",
          "signals": ["daño*", "perjuicio*", "perdida*", "deje de ganar", "dejado de ganar", "ventas", "ingresos"],
          "question": "¿Qué perjuicio concreto ha sufrido (pérdida de ventas, ingresos, encargos…)?"
        },
        {
          "fact": "criterio de cálculo pretendido",
          "signals": ["regalia*", "licencia*", "beneficio*", "precio*", "canon", "tarifa*", "calculo", "cuantia", "importe"],
          "question": "¿Con qué referencia querría cuantificarlo (lo que habría costado una licencia, el beneficio del otro…)?"
        }
      ]
    },
    {
      "area": "Propiedad intelectual",
      "topic": "regalía hipotética",
      "essential_facts": [
        {
          "fact": "uso que se habría licenciado",
          "signals": ["usado", "usaron", "explota*", "reproduc*", "distribuy*", "infraccion", "sin permiso", "sin autorizacion"],
          "question": "¿Qué uso concreto de la obra se hizo sin autorización?"
        },
        {
          "fact": "referencias de precio de licencia",
          "signals": ["licencia*", "tarifa*", "precio*", "canon", "royalty", "royalties", "mercado", "suelo cobrar", "cobro por"],
          "question": "¿Existen referencias de lo que se cobra por licenciar usos similares (tarifas propias o del sector)?"
        }
      ]
    },
    {
      "area": "Patentes",
      "topic": "infracción",
      "essential_facts": [
        {
          "fact": "patente invocada y su titular",
          "signals": ["mi patente", "patente registrada", "patente concedida", "titular*", "numero de patente", "solicitud de patente"],
          "question": "¿Qué patente invoca (concedida o en trámite) y quién es su titular?"
        },
        {
          "fact": "producto o procedimiento supuestamente infractor",
          "signals": ["producto*", "dispositivo*", "aparato*", "procedimiento*", "fabrica*", "vende*", "comercializ*", "importa*"],
          "question": "¿Qué producto o procedimiento del tercero entiende que infringe la patente?"
        },
        {
          "fact": "en qué coincide con lo protegido",
          "signals": ["reivindicacion*", "caracteristica*", "identic*", "igual*", "copia*", "mismo*", "funciona igual"],
          "question": "¿En qué coincide ese producto o procedimiento con lo que protege su patente?"
        }
      ]
    },
    {
      "area": "Patentes",
      "topic": "validez",
      "essential_facts": [
        {
          "fact": "qué patente se cuestiona y de quién",
          "signals": ["mi patente", "su patente", "numero", "titular*", "concedida", "registrada"],
          "question": "¿Qué patente se cuestiona y quién es su titular?"
        },
        {
          "fact": "motivo de invalidez alegado",
          "signals": ["novedad", "actividad inventiva", "divulgacion", "estado de la tecnica", "publicado antes", "ya existia", "evidente", "obvio"],
          "question": "¿Por qué motivo se cuestiona la validez (falta de novedad, divulgación previa…)?"
        }
      ]
    },
    {
      "area": "Patentes",
      "topic": "medidas cautelares",
      "essential_facts": [
        {
          "fact": "derecho invocado",
          "signals": ["patente*", "marca*", "obra*", "titular*", "registrad*", "concedida"],
          "question": "¿Qué derecho concreto invoca (patente, marca, obra…) y está registrado o concedido?"
        },
        {
          "fact": "urgencia",
          "signals": ["urgen*", "inminente*", "inmediat*", "ya esta", "ahora mismo", "cuanto antes", "cada dia"],
          "question": "¿Por qué la situación es urgente y no puede esperar al procedimiento ordinario?"
        },
        {
          "fact": "daño alegado",
          "signals": ["daño*", "perjuicio*", "perdida*", "irreparable*", "ventas", "clientes"],
          "question": "¿Qué daño se está produciendo o se producirá mientras tanto?"
        },
        {
          "fact": "apariencia de buen derecho",
          "signals": ["titulo*", "registro*", "certificado*", "concedida", "indicios"],
          "question": "¿Qué elementos respaldan a primera vista su derecho (títulos, registros, certificados…)?"
        },
        {
          "fact": "pruebas disponibles",
          "signals": ["prueba*", "documento*", "testigo*", "factura*", "fotos", "capturas", "pericial*", "correo*"],
          "question": "¿Qué pruebas tiene disponibles ahora mismo?"
        }
      ]
    },
    {
      "area": "Procesal",
      "topic": "cosa juzgada",
      "essential_facts": [
        {
          "fact": "si hubo un proceso anterior ya resuelto",
          "signals": ["cosa juzgada", "litigio anterior", "proceso anterior", "pleito anterior", "sentencia firme", "ya juzgado", "ya resuelto", "auto anterior", "resuelto antes"],
          "question": "¿Existió un proceso o litigio anterior YA resuelto sobre este asunto? ¿Con sentencia o auto firme?"
        },
        {
          "fact": "qué se resolvió en aquel proceso",
          "signals": ["se resolvio", "se decidio", "se declaro", "fallo", "lo resuelto", "desestim*", "estim*", "absolv*", "conden*"],
          "question": "¿Qué se resolvió exactamente en aquel proceso anterior?"
        },
        {
          "fact": "identidad de partes (elemento subjetivo)",
          "signals": ["mismas partes", "las partes", "identidad de partes", "mismo demandado", "mismo demandante", "causahabiente*", "mismo titular", "mismas personas"],
          "question": "¿Coinciden las partes (o sus causahabientes) entre el proceso anterior y el actual?"
        },
        {
          "fact": "identidad de objeto (elemento objetivo)",
          "signals": ["mismo objeto", "misma pretension", "identidad de objeto", "mismo asunto", "misma cuestion", "mismo pleito", "misma reclamacion"],
          "question": "¿Coincide (total o parcialmente) el objeto o la pretensión entre ambos procesos?"
        }
      ]
    },
    {
      "area": "Procesal",
      "topic": "medidas cautelares",
      "essential_facts": [
        {
          "fact": "derecho invocado",
          "signals": ["patente*", "marca*", "obra*", "titular*", "registrad*", "contrato*"],
          "question": "¿Qué derecho concreto invoca y en qué se basa su titularidad?"
        },
        {
          "fact": "urgencia",
          "signals": ["urgen*", "inminente*", "inmediat*", "ya esta", "ahora mismo", "cuanto antes", "cada dia"],
          "question": "¿Por qué la situación es urgente y no puede esperar al procedimiento ordinario?"
        },
        {
          "fact": "daño alegado",
          "signals": ["daño*", "perjuicio*", "perdida*", "irreparable*", "ventas", "clientes"],
          "question": "¿Qué daño se está produciendo o se producirá mientras se resuelve el pleito?"
        },
        {
          "fact": "apariencia de buen derecho",
          "signals": ["titulo*", "registro*", "certificado*", "concedida", "indicios"],
          "question": "¿Qué elementos respaldan a primera vista su derecho (títulos, registros, documentos…)?"
        },
        {
          "fact": "pruebas disponibles",
          "signals": ["prueba*", "documento*", "testigo*", "factura*", "fotos", "capturas", "pericial*", "correo*"],
          "question": "¿Qué pruebas tiene disponibles ahora mismo?"
        }
      ]
    },
    {
      "area": "Procesal",
      "topic": "prescripción",
      "essential_facts": [
        {
          "fact": "fecha del hecho o de su conocimiento",
          "signals": ["fecha*", "año*", "en 20*", "ocurrio", "sucedio", "me entere"],
          "question": "¿Cuándo ocurrió el hecho y cuándo tuvo usted conocimiento de él?"
        },
        {
          "fact": "acción que se quiere ejercitar",
          "signals": ["reclamar*", "demanda*", "accion", "indemnizacion", "nulidad", "cesacion"],
          "question": "¿Qué acción concreta quiere ejercitar (reclamación, demanda…)?"
        },
        {
          "fact": "reclamaciones previas que interrumpan plazos",
          "signals": ["burofax", "requerimiento*", "reclame", "reclamacion*", "carta*", "interrumpi*", "ya pedi"],
          "question": "¿Hubo reclamaciones previas (burofax, requerimientos…) y en qué fechas?"
        }
      ]
    },
    {
      "area": "Procesal",
      "topic": "costas",
      "essential_facts": [
        {
          "fact": "resultado del procedimiento",
          "signals": ["gane", "perdi", "estimad*", "desestimad*", "sentencia*", "condena*", "absuelt*", "parcial*"],
          "question": "¿Cómo terminó el procedimiento (estimación total, parcial, desestimación…)?"
        },
        {
          "fact": "qué se discute sobre las costas",
          "signals": ["importe*", "cuantia*", "tasacion*", "impugna*", "minuta*", "honorarios", "quien paga", "me condenaron"],
          "question": "¿Qué se discute exactamente: a quién se imponen las costas o su importe?"
        }
      ]
    },
    {
      "area": "Procesal",
      "topic": "prueba",
      "essential_facts": [
        {
          "fact": "hecho que se quiere probar",
          "signals": ["demostrar*", "probar*", "acreditar*", "hecho*", "que paso"],
          "question": "¿Qué hecho concreto necesita probar?"
        },
        {
          "fact": "medios de prueba disponibles",
          "signals": ["documento*", "testigo*", "pericial*", "perito*", "factura*", "correo*", "capturas", "fotos", "contrato*", "whatsapp*"],
          "question": "¿De qué medios de prueba dispone (documentos, testigos, peritos…)?"
        },
        {
          "fact": "fase del procedimiento",
          "signals": ["demanda*", "juicio", "audiencia", "vista", "recurso*", "antes de demandar", "todavia no"],
          "question": "¿En qué momento procesal está (antes de demandar, en juicio, en recurso…)?"
        }
      ]
    }
  ]
}`;
// CHECKLISTS-JSON-END

export interface EssentialFact {
  fact: string;
  signals: string[];
  question: string;
}
interface Checklist {
  area: string;
  topic: string;
  essential_facts: EssentialFact[];
}
interface ChecklistsConfig {
  area_fallback: Record<string, { fact: string; question: string }>;
  checklists: Checklist[];
}

const CONFIG: ChecklistsConfig = JSON.parse(CHECKLISTS_JSON) as ChecklistsConfig;

const NO_CLARIFICATION: MissingFactsResult = {
  needs_clarification: false,
  missing_facts: [],
  clarifying_questions: [],
};

/** ¿Existe checklist de hechos esenciales para este área/tema? (para tests de cobertura). */
export function hasChecklistFor(area: string, topic: string): boolean {
  return CONFIG.checklists.some((c) => c.area === area && c.topic === topic);
}

/**
 * Hechos esenciales (cerrados) de un área/tema. Fuente única reutilizada por
 * caseFactsExtractor para detectar, por SEÑAL, qué hechos aparecen en los
 * materiales del caso (sin inventar). [] si no hay checklist.
 */
export function getChecklist(area: string, topic: string): EssentialFact[] {
  const c = CONFIG.checklists.find((x) => x.area === area && x.topic === topic);
  return c ? c.essential_facts : [];
}

export function detectMissingFacts(question: string, scope: ScopeResult): MissingFactsResult {
  // Fuera de alcance: la respuesta correcta es el rechazo del motor (Regla 8),
  // no una repregunta que invite a continuar. needs_clarification=false NO
  // significa "todo claro": el decisionEngine evalúa out_of_scope ANTES.
  if (scope.out_of_scope) return { ...NO_CLARIFICATION };

  const tokens = normalize(question ?? "");

  // Área reconocida sin tema concreto => consulta ambigua => repreguntar el
  // tema con la plantilla del área (Regla 7).
  const fallback = CONFIG.area_fallback[scope.area];
  if (scope.topic === null) {
    if (fallback) {
      return {
        needs_clarification: true,
        missing_facts: [fallback.fact],
        clarifying_questions: [fallback.question],
      };
    }
    // Área desconocida sin plantilla: deny-by-default, repregunta genérica.
    return {
      needs_clarification: true,
      missing_facts: ["tema concreto de la consulta"],
      clarifying_questions: ["¿Podría concretar el tema de su consulta?"],
    };
  }

  const checklist = CONFIG.checklists.find(
    (c) => c.area === scope.area && c.topic === scope.topic,
  );

  // Tema sin checklist definida => deny-by-default: no se presume suficiencia.
  if (!checklist) {
    return {
      needs_clarification: true,
      missing_facts: [fallback?.fact ?? "tema concreto de la consulta"],
      clarifying_questions: [
        fallback?.question ?? "¿Podría concretar el tema de su consulta?",
      ],
    };
  }

  // Un hecho está MENCIONADO solo si alguna señal aparece en la consulta;
  // lo no dicho, se pregunta (nunca se asume, Regla 17).
  const missing = checklist.essential_facts.filter(
    (f) => !matchesAnyKeyword(f.signals, tokens),
  );

  return {
    needs_clarification: missing.length > 0,
    missing_facts: missing.map((f) => f.fact),
    clarifying_questions: missing.map((f) => f.question),
  };
}
