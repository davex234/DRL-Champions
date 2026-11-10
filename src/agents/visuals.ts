/**
 * NEXUS AGENT IDENTITY SYSTEM 1.0 — el manifiesto visual de los diez agentes (Fase 48).
 *
 * ────────────────────────── QUÉ ES ESTO Y QUÉ NO ES ──────────────────────────
 *
 * Es la **fuente única** de cómo se ve un agente fuera del mapa: su acento propio, su motivo
 * visual, y qué piezas de arte existen de verdad. Antes de esta fase, «cómo se ve un agente»
 * era el color de su CLASE y su sigilo, y estaba repartido entre `AgentEmblem`, el
 * constructor de composiciones, el teatro y el HUD de retransmisión. Aquí hay un sitio.
 *
 * NO es el catálogo. Los nombres, las clases, el kit y las etiquetas siguen viviendo en
 * `catalog.ts` y este fichero no los repite: los lee. Si mañana se añade un agente al
 * catálogo sin entrada aquí, `agentVisual()` devuelve una identidad derivada de su clase —no
 * se rompe nada— y la prueba `visuals.test.ts` avisa de que le falta identidad propia.
 *
 * ────────────────────────── EL ACENTO NO SUSTITUYE AL COLOR DE CLASE ──────────────────────────
 *
 * **Sobre el mapa manda la clase, siempre.** Un vistazo a la pizarra tiene que decir la
 * composición —cuántos controladores, cuántos centinelas—, y eso sólo funciona si los dos
 * controladores son del mismo violeta. Por eso `AgentEmblem` y las fichas del tablero siguen
 * usando `AGENT_CLASS_COLOR` y esta fase no los toca.
 *
 * El `accent` es para la IDENTIDAD, no para la lectura táctica: vive dentro de la familia
 * cromática de su clase pero distingue a los dos agentes que la comparten, y sólo se usa en
 * superficies donde ya sabes qué clase estás mirando (el hueco del cinco, la ficha del
 * roster, el panel de Presentar). Veil no puede ser el mismo violeta que Haze en una tarjeta
 * que existe para decir «este es Veil».
 *
 * ────────────────────────── EL GLIFO NO SE JUBILA ──────────────────────────
 *
 * El retrato COMPLEMENTA al sigilo; no lo sustituye. En el mapa, en tamaños pequeños y en
 * cualquier superposición táctica gana el sigilo, porque a 20 px un retrato es una mancha.
 * Por eso cada agente declara `glyph: "emblem"`: el respaldo no es una ausencia, es una
 * pieza de identidad de pleno derecho que siempre está.
 */
import { AGENTS } from "./catalog";
import type { AgentClass, AgentDef } from "./types";
import { agentArtSrc } from "../lib/assets";

/* ═══════════════════════ EL CONTRATO DE ARTE ═══════════════════════ */

/**
 * Las cuatro piezas que el sistema sabe pintar. Que estén declaradas NO significa que
 * existan: lo que existe lo dice `published` en cada agente.
 */
export type AgentArtVariant = "avatar" | "portrait" | "portrait-large" | "fullbody";

export const AGENT_ART_VARIANTS: AgentArtVariant[] = ["avatar", "portrait", "portrait-large", "fullbody"];

/**
 * Qué tiene que entregar cada pieza. Es un CONTRATO, no una sugerencia: si los diez retratos
 * no comparten encuadre, cinco caras en fila se leen como cinco fotos sueltas en vez de como
 * una alineación.
 *
 * Reglas comunes a las cuatro: fondo transparente de verdad (WEBP con alfa), personaje
 * separado del fondo, **cero texto, cero logotipos, cero marcos y cero interfaz dentro del
 * arte** —el nombre, la clase y el estado los pone la UI—, y luz coherente con el resto
 * (clave fría alta a la izquierda, relleno del color de la clase a la derecha).
 */
export interface AgentArtSpec {
  /** Proporción ancho/alto de la pieza. La UI reserva esta caja antes de cargar. */
  aspect: number;
  /** Tamaño intrínseco en píxeles con el que se entrega el máster. */
  width: number;
  height: number;
  /** Qué entra en el encuadre. */
  crop: string;
  /** Dónde se usa. */
  usage: string;
  /** Peso máximo aceptable por pieza, en kilobytes. */
  maxKb: number;
}

export const AGENT_ART_CONTRACT: Record<AgentArtVariant, AgentArtSpec> = {
  avatar: {
    aspect: 1,
    width: 256,
    height: 256,
    crop: "Cabeza y hombros. Los ojos (o el visor) en el tercio superior. Corte por encima del pecho.",
    usage: "Roster, listas, tiras de composición, HUD de retransmisión.",
    maxKb: 40,
  },
  portrait: {
    aspect: 3 / 4,
    width: 480,
    height: 640,
    crop: "Cara y torso superior, corte a media caja torácica. Cabeza en el tercio superior, mirada hacia el centro del encuadre.",
    usage: "Los cinco huecos del gestor de composiciones y el panel de Presentar.",
    maxKb: 90,
  },
  "portrait-large": {
    aspect: 3 / 4,
    width: 960,
    height: 1280,
    crop: "EL MISMO encuadre que `portrait`, al doble de resolución. No es otro plano: es la misma foto más grande.",
    usage: "Cabeceras, pantallas de agente y cualquier superficie por encima de 480 px de ancho.",
    maxKb: 220,
  },
  fullbody: {
    aspect: 3 / 5,
    width: 720,
    height: 1200,
    crop: "Silueta completa con los pies dentro y un 4 % de margen inferior. Postura de reposo, peso sobre una pierna.",
    usage: "Reservado. Pantalla de agente y material de presentación.",
    maxKb: 260,
  },
};

/* ═══════════════════════ LA IDENTIDAD DE CADA UNO ═══════════════════════ */

/**
 * Lo que este fichero añade al catálogo: identidad VISUAL.
 *
 * `motif` y `silhouette` no son decoración: son el contrato que recibirá quien produzca el
 * arte, y lo que hace que los diez se distingan EN SILUETA y no sólo por el color.
 */
export interface AgentIdentity {
  /** Acento propio, dentro de la familia cromática de su clase. */
  accent: string;
  /** El gesto visual que se repite en todas sus piezas. */
  motif: string;
  /** Qué hace reconocible su contorno a contraluz. */
  silhouette: string;
  /** Piezas de arte REALMENTE publicadas en `/public/agents/<id>/`. */
  published: AgentArtVariant[];
}

/**
 * Identidad por agente.
 *
 * Los acentos se han elegido por pares: los dos que comparten clase quedan dentro de la misma
 * familia —para no romper la lectura por clase— pero separados lo justo para distinguirlos
 * uno al lado del otro. El grave/agudo de cada pareja está pensado con su papel: el que ancla
 * lleva el tono profundo, el que se mueve lleva el claro.
 *
 * `published` dice qué piezas existen DE VERDAD en disco. En la Fase 48 estaba vacío en los
 * diez; en la 48B se publica Veil (`portrait` + `avatar`) como muestra patrón, y los otros
 * nueve siguen en sigilo hasta que esa muestra se apruebe. Publicar una pieza es añadir el
 * fichero y su nombre a esta lista; no hay que tocar ningún componente.
 *
 * `portrait-large` NO se declara para Veil: el máster mide 960 × 1280 y el retrato sale de un
 * recorte de 880 px de ancho, así que un `portrait-large` sería un reescalado, no más detalle.
 */
export const AGENT_IDENTITY: Record<string, AgentIdentity> = {
  /* ── Controladores: tapan. El motivo es la MATERIA QUE OCULTA ── */
  veil: {
    accent: "#8b7bf0",
    motif: "Telas pesadas de composite que cuelgan verticales: lo que Veil despliega CAE y se queda.",
    silhouette: "Alta y estrecha. Capa técnica larga con lastre en el bajo, hombros estrechos, capucha baja que oculta la mitad superior de la cara.",
    /* F48C · candidato V2 (V1 de F48B conservado en docs/product/art/veil/v1). Máster fuera de /public. */
    published: ["portrait", "avatar"],
  },
  haze: {
    accent: "#c3a0ff",
    motif: "Volutas en movimiento: cintas sueltas y tejido ligero que siempre va medio paso por detrás del cuerpo.",
    silhouette: "Media, compacta y en movimiento. Chaqueta corta abierta, cintas de escape a la espalda, pelo recogido alto.",
    published: [],
  },

  /* ── Iniciadores: barren y ven. El motivo es el INSTRUMENTO ── */
  probe: {
    accent: "#19e3ff",
    motif: "Óptica: lentes, sensores y un abanico de antenas cortas en el antebrazo izquierdo.",
    silhouette: "Media-alta y delgada. Mochila de sensores plana, visor monocular asimétrico sobre el ojo derecho, brazo izquierdo más voluminoso que el derecho.",
    published: [],
  },
  pulse: {
    accent: "#6ea8ff",
    motif: "Ondas concéntricas: placas de resonancia en el pecho y los guanteletes que marcan el latido.",
    silhouette: "Media y atlética, postura adelantada. Peto de resonancia con nervaduras horizontales, guanteletes gruesos, cabeza descubierta.",
    published: [],
  },

  /* ── Duelistas: empujan. El motivo es la DIRECCIÓN ── */
  spear: {
    accent: "#ff2e63",
    motif: "Una sola línea que apunta: todo el equipo está orientado hacia delante, nada cuelga.",
    silhouette: "Alta, de hombros anchos y cintura estrecha. Peto acuñado en punta, un solo hombro reforzado, coleta corta.",
    published: [],
  },
  blitz: {
    accent: "#ff7a3d",
    motif: "Quiebro: placas cortas y superpuestas, todo dispuesto para cambiar de dirección sin perder velocidad.",
    silhouette: "Baja y densa. Torso corto y ancho, protecciones cortas en antebrazos y espinillas, casco integral con visor de una pieza.",
    published: [],
  },

  /* ── Centinelas: cierran. El motivo es el CIERRE ── */
  warden: {
    accent: "#3fc07a",
    motif: "Placa y cerrojo: superficies grandes, continuas y sin huecos. Lo que Warden ocupa, se queda ocupado.",
    silhouette: "La más voluminosa de los diez. Hombreras cuadradas, placa frontal de una pieza, cuello alto, casco con mandíbula cerrada.",
    published: [],
  },
  tripwire: {
    accent: "#7fd44f",
    motif: "Tensión entre dos puntos: carretes, guías y cable fino recogido en el cinturón y los muslos.",
    silhouette: "Media y enjuta, siempre algo agachada. Chaleco de bolsillos planos, carretes en las caderas, gafas de trabajo subidas a la frente.",
    published: [],
  },

  /* ── Flexibles: se desdoblan. El motivo es la COPIA ── */
  specter: {
    accent: "#cbb26a",
    motif: "Desplazamiento: contornos que se repiten un poco desfasados, como una figura que no acaba de estar donde parece.",
    silhouette: "Alta y ligera, de brazos largos. Sobrecapa sin mangas con faldón partido, pañuelo alto que cubre la barbilla, sin equipo visible en las manos.",
    published: [],
  },
  echo: {
    accent: "#ffd35c",
    motif: "Repetición a distinta distancia: elementos iguales a tres tamaños —placas, correas, bolsillos— en el mismo eje.",
    silhouette: "Media, equilibrada y cargada. Arnés de cinco puntos con módulos repetidos, mangas asimétricas, auriculares de diadema sobre gorro corto.",
    published: [],
  },
};

/* ═══════════════════════ EL MANIFIESTO ═══════════════════════ */

/**
 * Lo que consume la interfaz. Una entrada por agente, con todo resuelto: color de clase para
 * la lectura táctica, acento propio para la identidad, y la ruta de cada pieza publicada —o
 * `null` si esa pieza no existe todavía.
 *
 * `null` es información, no un hueco: un `null` dice «pinta el sigilo», y por eso el producto
 * nunca pide al servidor una imagen que sabe que no está.
 */
export interface AgentVisual {
  id: string;
  name: string;
  class: AgentClass;
  /** Color de la CLASE. El que manda sobre el mapa. */
  classColor: string;
  /** Color propio del agente. Sólo para superficies de identidad. */
  accent: string;
  motif: string;
  silhouette: string;
  /** Siempre disponible: el sigilo vectorial de `AgentEmblem`. Nunca es `null`. */
  glyph: "emblem";
  avatar: string | null;
  portrait: string | null;
  portraitLarge: string | null;
  fullbody: string | null;
}

/**
 * Color por clase. Lo declara `AgentEmblem` para el mapa; aquí se repite el VALOR porque este
 * módulo es datos puros y no puede importar un componente de React (`src/agents` lo consumen
 * también el motor de simulación y los scripts de Node). La prueba `visuals.test.ts` comprueba
 * que las dos copias no se separen nunca.
 */
export const AGENT_CLASS_ACCENT: Record<AgentClass, string> = {
  controller: "#a78bfa",
  initiator: "#19e3ff",
  duelist: "#ff2e63",
  sentinel: "#3fc07a",
  flex: "#ffd35c",
};

const identidad = (a: AgentDef): AgentIdentity =>
  AGENT_IDENTITY[a.id] ?? {
    /* Un agente sin identidad propia hereda la de su clase: se ve bien, no se ve único. */
    accent: AGENT_CLASS_ACCENT[a.class],
    motif: "",
    silhouette: "",
    published: [],
  };

const arte = (id: string, v: AgentArtVariant, pub: AgentArtVariant[]): string | null =>
  (pub.includes(v) ? agentArtSrc(id, v) : null);

function construir(a: AgentDef): AgentVisual {
  const i = identidad(a);
  return {
    id: a.id,
    name: a.name,
    class: a.class,
    classColor: AGENT_CLASS_ACCENT[a.class],
    accent: i.accent,
    motif: i.motif,
    silhouette: i.silhouette,
    glyph: "emblem",
    avatar: arte(a.id, "avatar", i.published),
    portrait: arte(a.id, "portrait", i.published),
    portraitLarge: arte(a.id, "portrait-large", i.published),
    fullbody: arte(a.id, "fullbody", i.published),
  };
}

const POR_ID = new Map(AGENTS.map((a) => [a.id, a]));

/**
 * `agentVisuals["veil"]` — el acceso que pedía el encargo.
 *
 * Se construye al LEER, no al importar, y por una razón concreta: si fuera una foto tomada al
 * cargar el módulo, publicar una pieza de arte durante la sesión —o simularlo en una prueba—
 * dejaría este objeto diciendo una cosa y `agentArt()` otra. Dos fuentes de verdad otra vez,
 * que es justo lo que este fichero existe para evitar. El coste es armar un objeto literal por
 * lectura; el beneficio es que el manifiesto no puede desincronizarse de `AGENT_IDENTITY`.
 */
export const AGENT_VISUALS: Record<string, AgentVisual> = Object.defineProperties(
  {},
  Object.fromEntries(
    AGENTS.map((a) => [a.id, { get: () => construir(a), enumerable: true, configurable: false }]),
  ),
) as Record<string, AgentVisual>;

export const agentVisual = (id: string): AgentVisual | undefined => {
  const a = POR_ID.get(id);
  return a ? construir(a) : undefined;
};

/**
 * La pieza de arte a usar, o `null` si hay que caer al sigilo.
 *
 * `portrait-large` degrada a `portrait` y `avatar` degrada a `portrait` **sólo en ese
 * sentido**: una pieza de más resolución vale para un hueco pequeño, pero un avatar recortado
 * a la cabeza NO vale para un hueco de medio cuerpo. Un degradado al revés dejaría cabezas
 * estiradas en los cinco huecos, que es peor que el sigilo.
 */
export function agentArt(id: string, variant: AgentArtVariant): string | null {
  const v = agentVisual(id);
  if (!v) return null;
  switch (variant) {
    case "avatar": return v.avatar ?? v.portrait ?? v.portraitLarge;
    case "portrait": return v.portrait ?? v.portraitLarge;
    case "portrait-large": return v.portraitLarge;
    case "fullbody": return v.fullbody;
  }
}

/** Cuántas piezas hay publicadas en total. Cero significa «todo el producto va con sigilos». */
export const publishedArtCount = (): number =>
  AGENTS.reduce((n, a) => n + (AGENT_IDENTITY[a.id]?.published.length ?? 0), 0);
