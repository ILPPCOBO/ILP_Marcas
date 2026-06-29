/**
 * scopeClassifier — Pasos 1–2 del flujo cerrado (IMPLEMENTADO, F2).
 *
 * Clasifica la consulta del usuario dentro de las áreas/temas que el corpus
 * puede tratar, o la declara fuera de alcance. SOLO clasifica: nunca responde
 * al usuario (la respuesta es competencia del resto del pipeline).
 *
 * Reglas de CLAUDE.md que aplica:
 *   - Regla 3 / §6 "El LLM nunca decide": lógica 100% determinista sobre un
 *     LÉXICO CERRADO. Sin modelo, sin heurísticas opacas.
 *   - Regla 2: sin red.
 *   - Regla 8: fuera de alcance => declararlo con razón honesta.
 *   - Regla 17 (deny-by-default): lo no reconocido por el léxico es fuera de
 *     alcance; la mezcla con materias ajenas resuelve hacia fuera de alcance.
 *   - Regla 16: `reason` documenta las coincidencias exactas (auditable).
 *
 * Algoritmo (determinista):
 *   1. Normalizar (minúsculas, sin acentos, tokens alfanuméricos).
 *   2. Buscar coincidencias del léxico cerrado. Convención de keywords:
 *      "palabra" = token exacto; "prefij*" = prefijo de token; las frases son
 *      secuencias de tokens (cada uno exacto o con *). Peso: frase=2, token=1.
 *   3. Puntuación por lista de keywords = suma de pesos de coincidencias que NO
 *      comparten tokens (los solapes no cuentan doble: se eligen los tramos de
 *      mayor peso, luego posición, luego orden de declaración). Puntuación de
 *      área = mejor tema + 1 si alguna keyword de área coincide.
 *   4. Empates entre áreas: (1) mayor puntuación; (2) el área cuyas keywords de
 *      ÁREA coincidieron (el usuario la nombró explícitamente); (3) orden de
 *      declaración del léxico (documentado y estable).
 *   5. Materias ajenas (out_of_domain): si su puntuación es > 0 y >= que la
 *      mejor puntuación dentro del corpus => fuera de alcance (Regla 17).
 *   6. Confianza: >=4 high, >=2 medium, ==1 low. Si otra área queda a <=1 punto
 *      de la ganadora, la confianza baja a low (ambigüedad => señal de
 *      repregunta aguas abajo, Reglas 7 y 17). Fuera de alcance por materia
 *      ajena o consulta vacía => high; por silencio del léxico => low.
 *
 * NOTA scope ≠ cobertura: este módulo dice si la consulta ENCAJA TEMÁTICAMENTE
 * en el corpus; si existen criterios aprobados que la cubran lo decide el
 * retriever + decisionEngine (Reglas 5 y 6).
 */
import type { ScopeArea, ScopeResult } from "./types";
import type { ConfidenceLevel, LegalArea } from "./models";

// ---------------------------------------------------------------------------
// LÉXICO CERRADO (fuente única; el espejo de verificación lo parsea tal cual).
// Ampliarlo es una decisión explícita de mantenimiento, nunca del modelo.
// LEXICON-JSON-BEGIN
const LEXICON_JSON = `{
  "areas": [
    {
      "name": "Marcas",
      "corpus_area": "marcas",
      "area_keywords": [
        "marca",
        "marcas",
        "logo",
        "logotipo",
        "signo",
        "nombre comercial",
        "denominacion comercial"
      ],
      "topics": [
        {
          "name": "riesgo de confusión",
          "keywords": [
            "confusion",
            "confund*",
            "parecid*",
            "similar*",
            "semejan*",
            "imita*",
            "se parece",
            "identic*",
            "ambito competitivo",
            "comparacion de productos",
            "cotejo de marcas",
            "desestimacion",
            "distincion visual",
            "dominio internet",
            "elementos graficos",
            "infraccion",
            "ius prohibendi",
            "marca anterior",
            "nombre dominio",
            "nulidad relativa",
            "origen empresarial",
            "redireccionamiento trafico",
            "riesgo de asociacion",
            "riesgo de confusion",
            "servicios asimilados",
            "similitud fonetica",
            "similitud visual",
            "vocablo generico"
          ],
          "subtopics": [
            {
              "name": "similitud de signos",
              "keywords": [
                "logo",
                "logotipo",
                "signo",
                "parecid*",
                "similar*",
                "semejan*",
                "identic*",
                "nombre"
              ]
            },
            {
              "name": "similitud de productos",
              "keywords": [
                "producto*",
                "servicio*",
                "sector",
                "misma clase",
                "mismo mercado",
                "actividad comercial"
              ]
            }
          ]
        },
        {
          "name": "mala fe",
          "keywords": [
            "mala fe",
            "bloquear*",
            "obstaculiz*",
            "aprovech*",
            "sin intencion de usar",
            "abuso de confianza",
            "abuso dependencia economica",
            "arrendatario",
            "ausencia dolo",
            "coincidencia temporal",
            "conocimiento uso tercero",
            "convenios internacionales",
            "exempleador",
            "festival cultural",
            "fraude registral",
            "impedir irrupcion",
            "inmunidad registral",
            "intencion de impedir",
            "lindt",
            "mala fe evidente",
            "mala fe publica",
            "mala fe registral",
            "momento de la solicitud",
            "nulidad",
            "obra extranjera",
            "obstaculizar competencia",
            "pacto de socios",
            "proteccion internacional",
            "redito economico",
            "registro a sabiendas",
            "registro marca ente publico",
            "registro nacional",
            "registro preventivo",
            "registro sorpresivo",
            "signo exacto",
            "signo identico similar",
            "solicitud de marca",
            "titular extraregistral",
            "transferencia de derechos",
            "uso en el mercado"
          ],
          "subtopics": [
            {
              "name": "registro obstaculizador",
              "keywords": [
                "bloquear*",
                "obstaculiz*"
              ]
            },
            {
              "name": "aprovechamiento de reputación ajena",
              "keywords": [
                "aprovech*"
              ]
            }
          ]
        },
        {
          "name": "prioridad registral",
          "keywords": [
            "prioridad",
            "anterioridad",
            "primero en registrar",
            "fecha de solicitud",
            "registro anterior",
            "quien registro primero",
            "desobedecer derecho exclusivo",
            "distintividad",
            "ius prohibendi",
            "ius prohibendi marcario",
            "nombre dominio marca",
            "nulidad",
            "plena proteccion",
            "presuncion validez registral",
            "prioridad registral",
            "proteccion cautelar dominio",
            "titular registral"
          ],
          "subtopics": [
            {
              "name": "fecha de solicitud",
              "keywords": [
                "fecha de solicitud",
                "primero"
              ]
            }
          ]
        },
        {
          "name": "marca renombrada",
          "keywords": [
            "renombr*",
            "notori*",
            "famosa",
            "famoso",
            "acto desleal",
            "apreciacion global",
            "aprovechamiento infractor",
            "calvin klein",
            "consumidor medio informado",
            "danos morales patrimoniales",
            "desprestigio signo distintivo",
            "letras dominantes",
            "mala fe art 51",
            "marca alto renombre",
            "marca renombrada",
            "marca renombrada dilucio",
            "notoriedad previa",
            "notoriedad signo",
            "nulidad relativa",
            "parasitismo marca",
            "poder atraccion",
            "reconocimiento territorio",
            "riesgo confusion fonetica",
            "riesgo confusion visual",
            "riesgo de asociacion",
            "riesgo dilucio",
            "siglas",
            "signo no registrado",
            "signo similar",
            "tutela cautelar marcas",
            "vinculo evocativo"
          ],
          "subtopics": [
            {
              "name": "protección reforzada",
              "keywords": [
                "proteccion reforzada",
                "renombr*"
              ]
            }
          ]
        },
        {
          "name": "acción reivindicatoria",
          "keywords": [
            "reivindicat*",
            "recuperar la marca",
            "registrada por otro",
            "registro a su nombre",
            "me quitaron la marca",
            "abuso de confianza",
            "accion reivindicatoria",
            "administrador",
            "antiguo colaborador",
            "apropiacion signo",
            "art 2.2 lm",
            "bloqueo de marca",
            "bloqueo mercado",
            "encargo de diseno",
            "exceso mandato",
            "fraude derechos",
            "fraude registral",
            "fraude sociedad",
            "interposicion societaria",
            "mejor derecho",
            "proyecto comun",
            "registro de mala fe",
            "registro fraudulento",
            "reivindicatoria",
            "reivindicatoria impropia",
            "reivindicatoria marca",
            "represalia",
            "signo distintivo",
            "sociedad inactiva",
            "titular preexistente",
            "titular registral",
            "titularidad",
            "uso mercantil",
            "usuario mero",
            "violacion obligacion"
          ],
          "subtopics": [
            {
              "name": "registro por tercero",
              "keywords": [
                "por otro",
                "a su nombre"
              ]
            }
          ]
        },
        {
          "name": "agotamiento",
          "keywords": [
            "agotamiento marca",
            "antiguo licenciatario",
            "aura lujo prestigio",
            "contrato resuelto",
            "distribucion selectiva",
            "infraccion signo",
            "ius prohibendi",
            "licencia resolucion",
            "motivo legitimo",
            "regalia hipotetica",
            "reventa",
            "venta online"
          ],
          "subtopics": []
        },
        {
          "name": "distintividad",
          "keywords": [
            "caracter distintivo",
            "confusion",
            "curso mir",
            "dilucion marca",
            "distintividad debil",
            "distintividad sobrevenida",
            "elemento verbal dominante",
            "envases",
            "marca generica",
            "monopolio absoluto",
            "monopolio vocablo",
            "parasitismo",
            "proteccion ampliada",
            "sectores dispares",
            "sectores distintos",
            "sufijos diferenciadores",
            "tupper",
            "vinculo evocativo",
            "vocablos comunes",
            "vulgarizacion"
          ],
          "subtopics": []
        },
        {
          "name": "eslogan",
          "keywords": [
            "aptitud distintiva",
            "campana promocional",
            "caracter descriptivo",
            "distintividad",
            "eslogan",
            "eslogan publicitario",
            "indemnizacion",
            "plagio catalogo",
            "promocional",
            "riesgo de confusion",
            "sectores dispares"
          ],
          "subtopics": []
        },
        {
          "name": "indemnizacion",
          "keywords": [
            "beneficios infractor",
            "dano ex re ipsa",
            "enriquecimiento injusto",
            "indemnizacion infraccion",
            "porcentaje cifra negocios",
            "subsector"
          ],
          "subtopics": []
        },
        {
          "name": "ius prohibendi",
          "keywords": [
            "art 34 lm",
            "ius prohibendi",
            "signos confundibles",
            "uso exclusivo",
            "vertiente negativa",
            "vertiente positiva"
          ],
          "subtopics": []
        },
        {
          "name": "libre imitacion competencia",
          "keywords": [
            "asociacion marca",
            "competencia desleal",
            "empresa concursada",
            "extratrabajadores",
            "libre imitacion",
            "singularidad competitiva"
          ],
          "subtopics": []
        },
        {
          "name": "prohibiciones absolutas",
          "keywords": [
            "autoria artista",
            "firma artistica",
            "fraude consumidor",
            "personalidad",
            "prohibiciones absolutas"
          ],
          "subtopics": []
        },
        {
          "name": "regalia hipotetica",
          "keywords": [
            "dano ex re ipsa",
            "indemnizacion marca",
            "intromision exclusiva",
            "perjuicio deducido",
            "regalia hipotetica"
          ],
          "subtopics": []
        },
        {
          "name": "transmision marca",
          "keywords": [
            "compraventa de marca",
            "condicion suspensiva",
            "convalidacion",
            "licencias previas",
            "plan de liquidacion concursal",
            "transmision de marca"
          ],
          "subtopics": []
        },
        {
          "name": "uso efectivo",
          "keywords": [
            "caducidad",
            "caducidad marca",
            "caducidad parcial",
            "confusion mercado",
            "cuasi-copia",
            "falta de uso",
            "franquicias",
            "hotel establecimiento",
            "indemnizacion uno por ciento",
            "laser diodo",
            "nombre geografico",
            "nomenclator",
            "riesgo de asociacion",
            "servicios clase",
            "servicios in situ",
            "subcategorias independientes",
            "uso efectivo",
            "uso efectivo marca"
          ],
          "subtopics": []
        },
        {
          "name": "uso trafico economico",
          "keywords": [
            "animo de lucro",
            "animo lucro",
            "asociaciones civiles",
            "concurrencial",
            "contexto comercial",
            "dano emergente",
            "empresa",
            "fines comerciales",
            "investigacion de infraccion",
            "ius prohibendi marcario",
            "oferta comercial",
            "operacion en mercado",
            "redes sociales",
            "trafico comercial",
            "trafico economico",
            "uso en trafico economico",
            "uso infractor"
          ],
          "subtopics": []
        }
      ]
    },
    {
      "name": "Propiedad intelectual",
      "corpus_area": "propiedad_intelectual",
      "area_keywords": [
        "obra",
        "obras",
        "derechos de autor",
        "propiedad intelectual",
        "copyright",
        "cancion",
        "fotografia",
        "libro",
        "software"
      ],
      "topics": [
        {
          "name": "autoría",
          "keywords": [
            "autor",
            "autores",
            "autoria",
            "plagio",
            "plagi*",
            "quien creo"
          ],
          "subtopics": [
            {
              "name": "presunción de autoría",
              "keywords": [
                "presuncion",
                "registro"
              ]
            },
            {
              "name": "plagio",
              "keywords": [
                "plagio",
                "plagi*"
              ]
            }
          ]
        },
        {
          "name": "obra laboral",
          "keywords": [
            "emplead*",
            "trabaj*",
            "relacion laboral",
            "contrato de trabajo",
            "para la empresa",
            "en la empresa"
          ],
          "subtopics": [
            {
              "name": "cesión al empleador",
              "keywords": [
                "cesion",
                "empleador",
                "derechos de la empresa"
              ]
            }
          ]
        },
        {
          "name": "comunicación pública",
          "keywords": [
            "comunicacion publica",
            "difusion",
            "emision",
            "puesta a disposicion",
            "streaming",
            "emitir",
            "publico",
            "audiovisuales",
            "carga demandado",
            "clinica hospitalidad",
            "comunicacion potencial",
            "derechos audiovisuales",
            "doctrina tjce hoteles",
            "establecimiento hosteleria",
            "establecimiento publico",
            "establecimientos sanitarios",
            "fonogramas",
            "gestion colectiva",
            "gestion colectiva ex lege",
            "hosteleria",
            "intereses de mora",
            "pluralidad indeterminada",
            "presuncion",
            "presuncion iuris tantum",
            "radio",
            "remuneracion entidades gestion",
            "repertorio gestionado",
            "tarifa remuneracion",
            "television",
            "television zonas comunes",
            "zonas habitaciones indeterminadas"
          ],
          "subtopics": [
            {
              "name": "puesta a disposición",
              "keywords": [
                "puesta a disposicion",
                "internet",
                "online",
                "web"
              ]
            }
          ]
        },
        {
          "name": "indemnización",
          "keywords": [
            "indemniz*",
            "daños",
            "perjuicios",
            "compensacion",
            "compensar*"
          ],
          "subtopics": []
        },
        {
          "name": "regalía hipotética",
          "keywords": [
            "regalia*",
            "royalty",
            "royalties",
            "canon",
            "licencia hipotetica",
            "dano material",
            "dano moral",
            "derechos morales",
            "exhibicion television",
            "obra plastica",
            "regalia hipotetica"
          ],
          "subtopics": []
        },
        {
          "name": "acumulacion pi diseno",
          "keywords": [
            "altura creativa",
            "decisiones creativas",
            "diseno industrial",
            "doctrina cofemel",
            "fabricacion masiva",
            "originalidad",
            "singularidad estetica"
          ],
          "subtopics": []
        },
        {
          "name": "bases de datos",
          "keywords": [
            "bases de datos",
            "derecho sui generis",
            "extraccion sustancial",
            "indicacion de origen",
            "ius prohibendi",
            "marca de agua",
            "scraping"
          ],
          "subtopics": []
        },
        {
          "name": "canon copia privada",
          "keywords": [
            "apropiacion indebida",
            "canon digital",
            "copia privada",
            "deposito",
            "entidades gestion",
            "remuneracion"
          ],
          "subtopics": []
        },
        {
          "name": "canon digital",
          "keywords": [
            "apropriacion indebida",
            "canon digital",
            "copia privada",
            "deposito irregular",
            "egeda",
            "entidades de gestion",
            "remuneraciones"
          ],
          "subtopics": []
        },
        {
          "name": "cesion multiuso pi marca",
          "keywords": [
            "cesion explotacion marca",
            "cesion indefinida duracion",
            "derecho paternidad autor",
            "derechos acumulables",
            "legitimacion cesionario",
            "obra dual",
            "personaje animado",
            "proteccion simultanea autor marca",
            "registro marca cesionario",
            "subrogacion adquirente",
            "transmision activos empresariales"
          ],
          "subtopics": []
        },
        {
          "name": "cesion tecnologia",
          "keywords": [
            "cesion tecnologia",
            "contrato mercantil",
            "derechos industriales",
            "incumplimiento",
            "licencia uso",
            "titularidad exclusiva"
          ],
          "subtopics": []
        },
        {
          "name": "diseno industrial",
          "keywords": [
            "bien juridico protegido",
            "delito propiedad intelectual",
            "diseno industrial",
            "estampado",
            "obra plastica",
            "producto industrial"
          ],
          "subtopics": []
        },
        {
          "name": "infraccion",
          "keywords": [
            "bien juridico tutelado",
            "consumacion penal",
            "delito propiedad industrial",
            "inscripcion registral",
            "marca falsa"
          ],
          "subtopics": []
        },
        {
          "name": "nfts fair use",
          "keywords": [
            "derecho exhibicion",
            "digitalizacion",
            "excepciones numerus clausus",
            "fair use",
            "metaverso",
            "nfts",
            "soporte fisico"
          ],
          "subtopics": []
        },
        {
          "name": "obra protegible",
          "keywords": [
            "altura creativa",
            "bases transporte",
            "cosa juzgada",
            "culpa infractor",
            "derechos de autor",
            "dibujos comerciales",
            "diseno industrial",
            "doctrina cofemel",
            "estampado original",
            "excluidos proteccion",
            "expresion objetiva",
            "formato televisivo",
            "ideas generales",
            "licenciatario",
            "merchandising",
            "monopolio ideas",
            "nulidad por mala fe",
            "obra aplicada",
            "obra creativa",
            "obra protegible",
            "originalidad",
            "personalidad del autor",
            "plagio",
            "producto util",
            "proteccion penal",
            "proyecto implantacion",
            "proyecto logistico",
            "responsabilidad indemnizatoria",
            "sentencia firme",
            "simbolos graficos",
            "smilings"
          ],
          "subtopics": []
        },
        {
          "name": "plagio",
          "keywords": [
            "acervo comun",
            "adaptacion obra",
            "adaptacion publicitaria",
            "dano emergente",
            "dano moral",
            "elementos estructurales",
            "expresion original",
            "formatos televisivos",
            "genero televisivo",
            "imaginario colectivo",
            "indemnizacion",
            "lucro cesante",
            "plagio",
            "regalia hipotetica"
          ],
          "subtopics": []
        },
        {
          "name": "software",
          "keywords": [
            "art 97 trlpi",
            "art 99 trlpi",
            "asientos servidores",
            "autoria software",
            "codigo fuente",
            "codigo reproduccion",
            "comercializacion licencias",
            "competencia desleal",
            "complementariedad relativa",
            "contrato de licencia",
            "creador original",
            "derecho exclusiva",
            "derechos morales",
            "derechos patrimoniales",
            "derechos programa",
            "desarrollo software",
            "incumplimiento contractual",
            "infraccion software",
            "iniciativa propia",
            "instalacion no autorizada",
            "obra colectiva",
            "obra creada por trabajador",
            "persona fisica creadora",
            "piezas no autorizadas",
            "programa craqueado",
            "programa de ordenador",
            "programador empleado",
            "protecciones tecnicas",
            "puesta a disposicion",
            "regalia hipotetica",
            "software comercializacion",
            "software copia",
            "software craqueado",
            "software laboral",
            "software medida",
            "software pirata",
            "titularidad software"
          ],
          "subtopics": []
        },
        {
          "name": "titulo obra",
          "keywords": [
            "accion reivindicatoria",
            "creador original",
            "mala fe registral",
            "proteccion propiedad intelectual",
            "titulo de obra",
            "videojuego"
          ],
          "subtopics": []
        }
      ]
    },
    {
      "name": "Patentes",
      "corpus_area": "patentes",
      "area_keywords": [
        "patente",
        "patentes",
        "invencion",
        "modelo de utilidad"
      ],
      "topics": [
        {
          "name": "infracción",
          "keywords": [
            "infraccion",
            "infring*",
            "explota sin permiso",
            "usa mi patente",
            "copiado mi invencion"
          ],
          "subtopics": []
        },
        {
          "name": "validez",
          "keywords": [
            "validez",
            "nulidad",
            "novedad",
            "actividad inventiva",
            "anular*"
          ],
          "subtopics": []
        },
        {
          "name": "medidas cautelares",
          "keywords": [
            "cese cautelar",
            "cautelar* la infraccion",
            "prohibicion provisional"
          ],
          "subtopics": []
        },
        {
          "name": "diseno industrial",
          "keywords": [
            "bugaboo",
            "caracter singular",
            "carrito bebe",
            "diseno industrial",
            "dominio publico",
            "estampado",
            "imitacion licita",
            "impresion general",
            "obra artistica",
            "usuario informado"
          ],
          "subtopics": []
        },
        {
          "name": "patentabilidad",
          "keywords": [
            "actividad inventiva",
            "aplicacion industrial",
            "estado de la tecnica",
            "estado tecnica",
            "experto materia",
            "falta actividad inventiva",
            "invencion",
            "novedad",
            "obviedad",
            "patentabilidad",
            "patente nulidad",
            "problema solucion"
          ],
          "subtopics": []
        }
      ]
    },
    {
      "name": "Procesal",
      "corpus_area": "procesal",
      "area_keywords": [
        "procesal",
        "procedimiento judicial",
        "litigio",
        "juicio"
      ],
      "topics": [
        {
          "name": "cosa juzgada",
          "keywords": [
            "cosa juzgada",
            "cosa juzgada material",
            "sobreseimiento",
            "sobreseer",
            "litigio anterior",
            "proceso anterior",
            "pleito anterior",
            "ya juzgado",
            "ya resuelto",
            "efecto positivo",
            "funcion positiva",
            "identidad subjetiva",
            "identidad objetiva",
            "causahabiente*",
            "causahabiente",
            "identidad juridica",
            "licenciatario",
            "sentencia firme"
          ],
          "subtopics": []
        },
        {
          "name": "medidas cautelares",
          "keywords": [
            "medidas cautelares",
            "medida cautelar",
            "cautelar*",
            "suspension provisional",
            "cese provisional",
            "cautelar marcaria",
            "cesar infraccion",
            "fumus boni iuris",
            "injerencia patrimonial",
            "quantum indemnizatorio"
          ],
          "subtopics": []
        },
        {
          "name": "prescripción",
          "keywords": [
            "prescri*",
            "caduc*",
            "plazo para reclamar",
            "fuera de plazo",
            "cinco anos",
            "confianza legitima",
            "conocimiento lesion",
            "deudor",
            "dies a quo",
            "diligencia acreedor",
            "inactividad titular",
            "legitimacion pasiva",
            "mala fe deudor",
            "marca posterior registrada",
            "plazo 5 anos",
            "plazo prescriptorio",
            "prescripcion",
            "prescripcion por tolerancia",
            "retraso desleal",
            "tarifas evento"
          ],
          "subtopics": []
        },
        {
          "name": "costas",
          "keywords": [
            "costas"
          ],
          "subtopics": []
        },
        {
          "name": "prueba",
          "keywords": [
            "prueba",
            "pruebas",
            "pericial*",
            "perito*",
            "carga de la prueba",
            "testigo*",
            "dictamen"
          ],
          "subtopics": []
        },
        {
          "name": "competencia objetiva",
          "keywords": [
            "acumulacion de acciones",
            "competencia objetiva",
            "conexion de hechos",
            "derecho a la imagen",
            "juzgados de lo mercantil"
          ],
          "subtopics": []
        },
        {
          "name": "cuestiones procesales pi",
          "keywords": [
            "acumulacion cautelar",
            "acumulacion procesal",
            "entidad television club futbol",
            "procedimiento procedimental",
            "recursos litigio"
          ],
          "subtopics": []
        },
        {
          "name": "desistimiento renuncia",
          "keywords": [
            "abandono de la accion",
            "acciones cruzadas",
            "desistimiento",
            "desistimiento previo contestacion",
            "desistimiento renuncia diferencia",
            "imposicion costas",
            "pretension imprejuzgada",
            "reejercitable",
            "renuncia",
            "temerario mala fe",
            "unilateral bilateral"
          ],
          "subtopics": []
        },
        {
          "name": "estafa comercial",
          "keywords": [
            "engano dolo",
            "estafa",
            "fraude empresarial",
            "inversion",
            "marca personal",
            "titularidad marca"
          ],
          "subtopics": []
        }
      ]
    }
  ],
  "out_of_domain": [
    {
      "domain": "fiscal y tributario",
      "keywords": [
        "fiscal*",
        "hacienda",
        "impuesto*",
        "tributari*",
        "iva",
        "irpf",
        "declaracion de la renta"
      ]
    },
    {
      "domain": "difamación y honor",
      "keywords": [
        "difama*",
        "calumnia*",
        "injuria*",
        "honor",
        "reputacion personal"
      ]
    },
    {
      "domain": "penal",
      "keywords": [
        "delito*",
        "penal",
        "estafa*",
        "robo",
        "denuncia policial"
      ]
    },
    {
      "domain": "familia y sucesiones",
      "keywords": [
        "divorcio",
        "custodia",
        "pension alimenticia",
        "herencia",
        "testamento"
      ]
    },
    {
      "domain": "laboral (no PI)",
      "keywords": [
        "despido*",
        "salario*",
        "nomina*",
        "finiquito",
        "ere"
      ]
    },
    {
      "domain": "extranjería",
      "keywords": [
        "visado*",
        "extranjeria",
        "nacionalidad",
        "permiso de residencia"
      ]
    }
  ]
}`;
// LEXICON-JSON-END

interface SubtopicDef {
  name: string;
  keywords: string[];
}
interface TopicDef {
  name: string;
  keywords: string[];
  subtopics: SubtopicDef[];
}
interface AreaDef {
  name: Exclude<ScopeArea, "Fuera de alcance">;
  corpus_area: LegalArea;
  area_keywords: string[];
  topics: TopicDef[];
}
interface OutOfDomainDef {
  domain: string;
  keywords: string[];
}
interface Lexicon {
  areas: AreaDef[];
  out_of_domain: OutOfDomainDef[];
}

const LEXICON: Lexicon = JSON.parse(LEXICON_JSON) as Lexicon;

// ---------------------------------------------------------------------------
// Normalización y coincidencia (deterministas)

/** minúsculas, sin diacríticos, solo tokens alfanuméricos. */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Un token del léxico casa con un token de la consulta (convención `*`). */
function tokenMatches(kwToken: string, token: string): boolean {
  return kwToken.endsWith("*")
    ? token.startsWith(kwToken.slice(0, -1))
    : token === kwToken;
}

/** Tramo de consulta cubierto por una keyword coincidida. */
interface SpanMatch {
  kw: string;
  weight: number;
  start: number;
  length: number;
}

function keywordMatchesAt(kwTokens: string[], tokens: string[], i: number): boolean {
  for (let j = 0; j < kwTokens.length; j++) {
    const kt = kwTokens[j];
    const qt = tokens[i + j];
    if (kt === undefined || qt === undefined || !tokenMatches(kt, qt)) return false;
  }
  return true;
}

/**
 * Todas las posiciones donde casa una keyword (token o frase: tokens
 * CONSECUTIVOS). Peso: frase=2, token=1.
 */
function allMatches(keyword: string, tokens: string[]): SpanMatch[] {
  const kwTokens = normalizeKeyword(keyword);
  if (kwTokens.length === 0) return [];
  const weight = kwTokens.length > 1 ? 2 : 1;
  const out: SpanMatch[] = [];
  for (let i = 0; i + kwTokens.length <= tokens.length; i++) {
    if (keywordMatchesAt(kwTokens, tokens, i))
      out.push({ kw: keyword, weight, start: i, length: kwTokens.length });
  }
  return out;
}

/** Normaliza una keyword preservando los asteriscos de prefijo. */
function normalizeKeyword(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9*]+/)
    .filter((t) => t.length > 0);
}

/**
 * ¿Alguna keyword de la lista casa con la consulta? (misma convención `*` y
 * frases del léxico cerrado). Reutilizada por missingFactsDetector para las
 * señales de hechos esenciales.
 */
export function matchesAnyKeyword(keywords: string[], tokens: string[]): boolean {
  for (const kw of keywords) {
    if (allMatches(kw, tokens).length > 0) return true;
  }
  return false;
}

/**
 * Puntuación de una lista de keywords SIN contar dos veces los mismos tokens
 * de la consulta: entre coincidencias que se solapan se eligen, de forma
 * determinista, las de mayor peso (luego posición, luego orden de declaración)
 * y cada keyword cuenta como máximo una vez.
 */
function scoreKeywords(keywords: string[], tokens: string[]): { score: number; hits: string[] } {
  const candidates: (SpanMatch & { order: number })[] = [];
  keywords.forEach((kw, order) => {
    for (const m of allMatches(kw, tokens)) candidates.push({ ...m, order });
  });
  candidates.sort((a, b) => b.weight - a.weight || a.start - b.start || a.order - b.order);

  const consumed: boolean[] = new Array<boolean>(tokens.length).fill(false);
  const usedKw = new Set<string>();
  let score = 0;
  const hits: string[] = [];
  for (const c of candidates) {
    if (usedKw.has(c.kw)) continue;
    let free = true;
    for (let t = c.start; t < c.start + c.length; t++) {
      if (consumed[t]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (let t = c.start; t < c.start + c.length; t++) consumed[t] = true;
    usedKw.add(c.kw);
    score += c.weight;
    hits.push(c.kw);
  }
  return { score, hits };
}

// ---------------------------------------------------------------------------
// Clasificación

const CONFIDENCE_HIGH_AT = 4;
const CONFIDENCE_MEDIUM_AT = 2;

function confidenceForScore(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_HIGH_AT) return "high";
  if (score >= CONFIDENCE_MEDIUM_AT) return "medium";
  return "low";
}

export function classifyScope(question: string): ScopeResult {
  const tokens = normalize(question ?? "");

  // Consulta vacía o sin contenido analizable => fuera de alcance (Regla 17).
  if (tokens.length === 0) {
    return {
      area: "Fuera de alcance",
      topic: null,
      subtopics: [],
      out_of_scope: true,
      confidence: "high",
      reason: "La consulta está vacía o no contiene texto analizable.",
    };
  }

  // 1) Puntuación de cada área del corpus.
  interface AreaCandidate {
    area: AreaDef;
    topic: TopicDef | null;
    topicScore: number;
    areaBonus: number;
    total: number;
    areaHits: string[];
    topicHits: string[];
  }
  const candidates: AreaCandidate[] = [];

  for (const area of LEXICON.areas) {
    const areaMatch = scoreKeywords(area.area_keywords, tokens);
    const areaBonus = areaMatch.hits.length > 0 ? 1 : 0;

    let bestTopic: TopicDef | null = null;
    let bestTopicScore = 0;
    let bestTopicHits: string[] = [];
    for (const topic of area.topics) {
      const { score, hits } = scoreKeywords(topic.keywords, tokens);
      if (score > bestTopicScore) {
        bestTopic = topic;
        bestTopicScore = score;
        bestTopicHits = hits;
      }
    }

    const total = bestTopicScore + areaBonus;
    if (total === 0) continue;
    candidates.push({
      area,
      topic: bestTopic,
      topicScore: bestTopicScore,
      areaBonus,
      total,
      areaHits: areaMatch.hits,
      topicHits: bestTopicHits,
    });
  }

  // Mejor área. Empates: (1) puntuación, (2) bonus de área (el usuario nombró
  // el área explícitamente), (3) orden de declaración del léxico (estable).
  let best: AreaCandidate | null = null;
  for (const cand of candidates) {
    if (
      best === null ||
      cand.total > best.total ||
      (cand.total === best.total && cand.areaBonus > best.areaBonus)
    ) {
      best = cand;
    }
  }
  // Segunda mejor área (para detectar ambigüedad entre áreas).
  let runnerUpTotal = 0;
  for (const cand of candidates) {
    if (best !== null && cand.area.name !== best.area.name && cand.total > runnerUpTotal)
      runnerUpTotal = cand.total;
  }

  // 2) Materias ajenas al corpus.
  let outBest: { domain: string; score: number; hits: string[] } | null = null;
  for (const dom of LEXICON.out_of_domain) {
    const { score, hits } = scoreKeywords(dom.keywords, tokens);
    if (score > 0 && (outBest === null || score > outBest.score)) {
      outBest = { domain: dom.domain, score, hits };
    }
  }

  const inTotal = best?.total ?? 0;

  // 3) DENY-BY-DEFAULT (Regla 17): materia ajena igual o más fuerte que la
  // materia del corpus => fuera de alcance. También si no hay coincidencias.
  if (outBest !== null && outBest.score >= inTotal) {
    return {
      area: "Fuera de alcance",
      topic: null,
      subtopics: [],
      out_of_scope: true,
      confidence: "high",
      reason:
        `La consulta trata sobre una materia no cubierta por el corpus ` +
        `("${outBest.domain}"; coincidencias: ${outBest.hits.join(", ")}).`,
    };
  }
  if (best === null) {
    return {
      area: "Fuera de alcance",
      topic: null,
      subtopics: [],
      out_of_scope: true,
      confidence: "low",
      reason:
        "Ninguna materia del corpus se reconoce en la consulta (léxico cerrado sin coincidencias; deny-by-default).",
    };
  }

  // 4) Subtemas del tema ganador.
  const subtopics: string[] = [];
  if (best.topic) {
    for (const st of best.topic.subtopics) {
      if (scoreKeywords(st.keywords, tokens).hits.length > 0) subtopics.push(st.name);
    }
  }

  const evidence: string[] = [];
  if (best.areaHits.length > 0)
    evidence.push(`área "${best.area.name}" (${best.areaHits.join(", ")})`);
  if (best.topic && best.topicHits.length > 0)
    evidence.push(`tema "${best.topic.name}" (${best.topicHits.join(", ")})`);

  // Ambigüedad entre áreas: otra área a <=1 punto => confianza low para que el
  // motor repregunte en vez de responder (Reglas 7 y 17).
  let confidence = confidenceForScore(best.total);
  let ambiguityNote = "";
  if (runnerUpTotal > 0 && best.total - runnerUpTotal <= 1) {
    confidence = "low";
    ambiguityNote = ` Ambigüedad: otra área puntúa ${runnerUpTotal} frente a ${best.total}.`;
  }

  return {
    area: best.area.name,
    topic: best.topic && best.topicScore > 0 ? best.topic.name : null,
    subtopics,
    out_of_scope: false,
    confidence,
    reason: `Coincidencias del léxico cerrado: ${evidence.join("; ")}.${ambiguityNote}`,
  };
}

// ---------------------------------------------------------------------------
// Puentes hacia el modelo de datos (UserQuery.classified_area / corpus topics)

/** ScopeArea visible → LegalArea del modelo de datos; null si fuera de alcance. */
export function scopeAreaToLegalArea(area: ScopeArea): LegalArea | null {
  const found = LEXICON.areas.find((a) => a.name === area);
  return found ? found.corpus_area : null;
}

/** Tema visible → clave de topic del corpus ("riesgo de confusión" → "riesgo_de_confusion"). */
export function toCorpusTopicKey(topic: string): string {
  return normalize(topic).join("_");
}

/**
 * Todos los pares área/tema del léxico cerrado. Permite a los tests verificar
 * que cada tema clasificable tiene su contraparte aguas abajo (p. ej. una
 * checklist de hechos esenciales en missingFactsDetector).
 */
export function getKnownTopics(): Array<{ area: ScopeArea; topic: string }> {
  const out: Array<{ area: ScopeArea; topic: string }> = [];
  for (const area of LEXICON.areas) {
    for (const topic of area.topics) out.push({ area: area.name, topic: topic.name });
  }
  return out;
}
