/**
 * LÍMITE DE FRECUENCIA DEL PvP (Bloque 7.6).
 *
 * Resuelve D-PVP-9. Es una capa DELANTE de las superficies PvP; no sustituye a ninguna de las
 * defensas que ya tiene el juego.
 *
 * ─────────────────────── DÓNDE VIVE EL CONTADOR, Y POR QUÉ ───────────────────────
 *
 * En PostgreSQL (`app_rate_take`, migración 0036), no en memoria de este proceso.
 *
 * El proyecto ya tiene un limitador en memoria —el de `/api/telemetry`— y su propia cabecera
 * explica por qué le vale: «el peor caso de saltárselo son filas de más en una tabla con
 * retención de 90 días». Aquí detrás hay partidas, cola y rating, así que ese argumento no
 * sirve: con dos procesos de Node, dos `Map` distintos son dos límites distintos, y el efectivo
 * es la suma. Un contador compartido es la única forma de que el límite signifique algo.
 *
 * ─────────────────────── QUIÉN ES EL SUJETO ───────────────────────
 *
 * El `user_id` del Bearer, SIEMPRE. Nunca `body.userId`, nunca `query.userId`: si el sujeto lo
 * eligiera el cliente, cambiarlo sería saltarse el límite, que es justo lo que no puede pasar.
 *
 * ─────────────────────── POR QUÉ NO SE LIMITA POR IP ───────────────────────
 *
 * Se auditó y se decidió NO hacerlo, con dos razones:
 *
 *   1. **No hay una IP fiable.** Este proyecto se sirve sin una cadena de proxies de confianza
 *      configurada, así que lo único disponible es `x-forwarded-for`, que **lo pone el cliente**.
 *      Construir un límite sobre una cabecera falsificable no es una defensa: es una que se
 *      salta escribiendo otra línea.
 *   2. **Sería un amplificador.** Limitar por IP obliga a ESCRIBIR en la base de datos por cada
 *      petición anónima. Hoy una petición sin token cuesta prácticamente cero —`getSession`
 *      devuelve `null` sin tocar la red ni la base en cuanto no hay cabecera `authorization`— y
 *      añadirle un UPSERT convertiría el propio límite en la vía de agotar recursos.
 *
 * El límite por IP pertenece al borde (nginx, Vercel, Cloudflare), que sí sabe de dónde viene la
 * conexión. Queda anotado como deuda **D-RL-1**, no disimulado.
 *
 * ─────────────────────── FALLO ABIERTO, Y A PROPÓSITO ───────────────────────
 *
 * Si el contador falla, se DEJA PASAR la petición. Puede sonar mal para algo que se llama
 * «límite», pero: el PvP no funciona sin base de datos, así que un fallo del contador significa
 * que la partida iba a fallar de todos modos. Cerrar aquí convertiría un problema del limitador
 * en una caída del juego, y el limitador es lo accesorio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Superficies con política propia. Cada una es una cubeta distinta en la tabla. */
export type RateBucket =
  | "pvp_sync" | "pvp_action" | "mm_status" | "mm_write"
  | "social_read" | "social_search" | "social_write" | "social_heartbeat"
  | "events_read"
  | "profile_read" | "profile_write"
  | "deck_read" | "deck_write"
  | "season_read"
  | "campaign_read" | "campaign_write"
  | "daily_loop_read"
  | "collection_read" | "collection_write" | "cards_read"
  | "draft_read" | "draft_write"
  | "admin_read" | "admin_write"
  | "onboarding_read" | "onboarding_write"
  | "economy_write" | "upload_write"
  | "cup_read" | "cup_write" | "cup_status"
  | "feedback_write"
  | "pickem_read" | "pickem_write";

export interface RatePolicy {
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Longitud de la ventana, en segundos. */
  windowSeconds: number;
  /** Para qué es, y de dónde sale el número. */
  why: string;
}

/**
 * LA POLÍTICA. Los números salen de medir el cliente, no de elegirlos.
 *
 * Ritmo real, leído de `POLL_MS` (bloque 7.3) y de `usePvpQueue` (bloque 7.5):
 *
 *   sondeo de partida  1.200 ms con el turno del rival →  50 pet/min   (2.500 ms en el tuyo → 24)
 *   sondeo de cola     2.000 ms                        →  30 pet/min
 *   acciones           20 por partida, repartidas en varios minutos
 *   pestaña oculta     15.000 / 6.000 ms               →   4 y 10 pet/min
 *
 * Cada límite deja entre 2× y 3× de margen. Ese margen es deliberado y tiene destinatario: dos
 * pestañas abiertas con la misma cuenta, un refresco, la transición de cola a partida y los
 * `syncNow` manuales. Aun así, «mil peticiones en un segundo» se corta en la petición ~150.
 */
export const RATE_POLICY: Record<RateBucket, RatePolicy> = {
  pvp_sync: {
    limit: 150, windowSeconds: 60,
    why: "El sondeo más rápido son 50 pet/min (1.200 ms). 3× de margen: dos pestañas y las transiciones caben.",
  },
  pvp_action: {
    limit: 40, windowSeconds: 60,
    why: "Una partida entera son 20 acciones repartidas en minutos. 40/min es el doble de una partida completa por minuto.",
  },
  mm_status: {
    limit: 90, windowSeconds: 60,
    why: "El sondeo de cola son 30 pet/min (2.000 ms). 3× de margen, igual que el de partida.",
  },
  mm_write: {
    limit: 20, windowSeconds: 60,
    why: "Entrar y salir de la cola son ~2 acciones por búsqueda. 20/min tolera al indeciso y corta al que automatiza.",
  },
  /* FASE 29 · social. Misma tabla y misma RPC (`app_rate_take`): cubetas nuevas, cero migración. */
  social_read: {
    limit: 90, windowSeconds: 60,
    why: "El hub se lee al entrar, tras cada acción y al refrescar el badge (≤ 1 pet/min). 90/min es 10× lo normal.",
  },
  social_search: {
    limit: 30, windowSeconds: 60,
    why: "Búsqueda con debounce de 300 ms y mínimo 2 letras: teclear un nombre son 3–6 peticiones. 30/min corta la enumeración.",
  },
  social_write: {
    limit: 30, windowSeconds: 60,
    why: "Solicitar, aceptar, retar, bloquear: acciones humanas, una cada varios segundos. 30/min frena el spam de solicitudes.",
  },
  social_heartbeat: {
    limit: 40, windowSeconds: 60,
    why: "F85 · el pulso (latido + contador + retos) es 1 cada 20 s por pestaña visible (3/min) más uno al volver a la pestaña, y 12/min mientras espero respuesta a un reto. 40/min cubre varias pestañas y dispositivos y corta el abuso.",
  },
  /* FASE 30 · eventos en directo. Refresco con partido en directo cada 20 s (3/min) + badge cada 2 min. */
  /* FASE 31 · perfil de jugador. Leer un perfil es un gesto humano; guardar la vitrina, más aún. */
  profile_read: {
    limit: 60, windowSeconds: 60,
    why: "Abrir perfiles desde la escalera o la búsqueda son pocas lecturas por minuto. 60/min cabe de sobra y frena el rastreo masivo de perfiles.",
  },
  profile_write: {
    limit: 20, windowSeconds: 60,
    why: "Guardar vitrina, logros o avatar son acciones de edición deliberadas. 20/min tolera ajustes seguidos y corta la automatización.",
  },
  /* FASE 32 · equipos (Deck Builder 2.0). Misma tabla y misma RPC: cubetas nuevas, cero migración. */
  deck_read: {
    limit: 90, windowSeconds: 60,
    why: "La foto de equipos se lee al entrar en el hub, tras cada guardado y desde pre-partida, PvP, retos y el vestíbulo. 90/min es 10× un uso intenso y corta el rastreo.",
  },
  deck_write: {
    limit: 30, windowSeconds: 60,
    why: "Guardar, renombrar, duplicar, borrar o activar son gestos humanos: el constructor guarda de una vez (save_composition), no por carta. 30/min tolera ajustes seguidos y corta la automatización.",
  },
  /* FASE 34 · temporada. Misma tabla y RPC (`app_rate_take`): cubeta nueva, cero migración. */
  season_read: {
    limit: 30, windowSeconds: 60,
    why: "El hub se lee al entrar, tras volver a la pestaña y una vez al cruzar a cero la cuenta atrás. 30/min es >10× lo normal y corta el rastreo.",
  },
  /* FASE 35 · Road to Champions. Misma tabla y RPC (`app_rate_take`): cubetas nuevas, cero migración. */
  campaign_read: {
    limit: 60, windowSeconds: 60,
    why: "El mapa se lee al entrar, al volver de una partida, desde el hub de modos, la arena (contexto del nodo) y el perfil propio. 60/min es >10× lo normal y corta el rastreo.",
  },
  campaign_write: {
    limit: 20, windowSeconds: 60,
    why: "Lanzar un nodo, sincronizar tras la partida o abandonar son gestos humanos separados por una partida de minutos. 20/min tolera reintentos y corta la automatización.",
  },
  /* FASE 36 · Daily Loop (vestíbulo). Misma tabla y RPC (`app_rate_take`): cubeta nueva, cero migración. */
  daily_loop_read: {
    limit: 40, windowSeconds: 60,
    why: "La home lee la foto al entrar, al volver a la pestaña (con un mínimo de 30 s entre lecturas), al recuperar la conexión y con «Actualizar». 40/min es >10× lo normal, deja sitio a varias pestañas y corta el rastreo.",
  },
  /* FASE 37 · Collection Room. Buscar/filtrar/ordenar ocurre en el cliente sobre la foto: el servidor no se golpea por tecla. */
  collection_read: {
    limit: 30, windowSeconds: 60,
    why: "La foto personal se lee al entrar en la colección o en la ficha de una carta y tras cambiar un favorito. 30/min es >10× lo normal y corta el rastreo.",
  },
  /* COLECCIONES ILIMITADAS · páginas de ejemplares (`/api/game/cards`). Misma tabla y RPC: cubeta nueva, cero migración. */
  cards_read: {
    limit: 120, windowSeconds: 60,
    why: "Recorrer las copias de una carta son páginas de hasta 100 ejemplares al hacer scroll: 120/min deja leer 12.000 copias por minuto a quien de verdad las tiene y corta el rastreo.",
  },
  collection_write: {
    limit: 40, windowSeconds: 60,
    why: "Marcar o quitar favoritos es un gesto humano (un toque por carta). 40/min tolera ráfagas al ordenar la colección y corta la automatización.",
  },
  /* FASE 39 · Draft Gauntlet. Misma tabla y RPC (`app_rate_take`): cubetas nuevas, cero migración de límites. */
  draft_read: {
    limit: 40, windowSeconds: 60,
    why: "La run se lee al entrar, al volver de un combate, al volver a la pestaña y tras un 409 de versión. 40/min es >10× lo normal y corta el rastreo.",
  },
  draft_write: {
    limit: 40, windowSeconds: 60,
    why: "Diez elecciones con vista previa y confirmación, lanzar cinco combates o abandonar: gestos humanos. 40/min tolera un draft rápido con reintentos y corta la automatización.",
  },
  /* F58 · Admin Control Center. Misma tabla y RPC: el sujeto es el userId del ADMIN (sale de `verifyAdmin`). */
  admin_read: {
    limit: 240, windowSeconds: 60,
    why: "El panel lee por pantalla (tablas paginadas, fichas, búsqueda con debounce). 240/min cubre a un admin navegando deprisa con varias pestañas y corta el rastreo con un token robado.",
  },
  admin_write: {
    limit: 20, windowSeconds: 60,
    why: "Sancionar, ajustar créditos, conceder o publicar son gestos con confirmación: nadie hace más de unos pocos por minuto. 20/min impide que un bug de UI o un script dispare 100 concesiones.",
  },
  events_read: {
    limit: 60, windowSeconds: 60,
    why: "El refresco más rápido son 3 pet/min (20 s con partido en directo). 60/min es 20×: caben varias pestañas y el hub + el partido a la vez.",
  },
  /* F63 · onboarding. Misma tabla y RPC (`app_rate_take`): cubetas nuevas, cero migración. */
  onboarding_read: {
    limit: 60, windowSeconds: 60,
    why: "La guía se lee una vez por pantalla del recorrido (colección, sobre, equipo, partida, progreso) con caché de 20 s en el cliente. 60/min es >10× un recorrido rápido con dos pestañas.",
  },
  onboarding_write: {
    limit: 20, windowSeconds: 60,
    why: "Empezar, saltar, retomar, terminar o crear el primer equipo son gestos humanos, casi siempre UNA vez por cuenta. 20/min tolera reintentos y corta la automatización.",
  },
  /* F67 · escrituras de economía (abrir/comprar sobres, tienda, reclamar, créditos, maestría, prestigio). Sin migración. */
  economy_write: {
    limit: 30, windowSeconds: 60,
    why: "Abrir o comprar un sobre, reclamar una recompensa o canjear son gestos con animación de varios segundos: nadie hace más de 10-15 por minuto. 30/min deja 2× de margen y corta el bucle automatizado contra el libro mayor.",
  },
  upload_write: {
    limit: 20, windowSeconds: 60,
    why: "Subir un recurso desde el panel es un gesto manual (elegir fichero, confirmar). 20/min cubre una tanda de subidas y corta el abuso con un token de admin robado.",
  },
  /* F86 · torneos de jugadores. Misma tabla y RPC (`app_rate_take`): cubetas nuevas, cero migración de límites. */
  cup_read: {
    limit: 60, windowSeconds: 60,
    why: "El hub y la ficha se releen cada 20 s con la pestaña visible (3/min), al volver a ella y tras cada acción; el indicador del menú, cada minuto. 60/min es >10× lo normal con dos pestañas y corta el rastreo.",
  },
  /* F86.1 · el sondeo LIGERO de estado, aparte de las lecturas de hub/ficha: ritmo adaptativo por pestaña visible. */
  cup_status: {
    limit: 90, windowSeconds: 60,
    why: "Esperando al rival se lee cada 3 s (20/min) por pestaña visible; con cruce relevante, cada 5 s (12/min); sin cruce, 1/min. 90/min cubre tres pestañas en espera a la vez y corta el rastreo; no comparte cubeta con hub/ficha ni con las escrituras.",
  },
  cup_write: {
    limit: 30, windowSeconds: 60,
    why: "Inscribirse o retirarse es un gesto suelto; esperar al rival renueva «estoy listo» cada 5 s (12/min). 30/min cubre la espera con margen y corta la automatización.",
  },
  /* F86.2 · feedback de la alpha: enviar un formulario es un gesto humano; el reintento con la misma clave no duplica. */
  feedback_write: {
    limit: 6, windowSeconds: 60,
    why: "Una persona envía el formulario de feedback una vez (y quizá otra si se acuerda de algo). 6/min cubre reintentos y dos pestañas y corta el bucle; la BD además topa en 30 envíos por cuenta.",
  },
  /* F87 · Pick'ems 2.0 (cuadros). Misma tabla y RPC (`app_rate_take`): cubetas nuevas, cero migración de límites. */
  pickem_read: {
    limit: 60, windowSeconds: 60,
    why: "La ficha de un cuadro se relee al cerrar cada partido (cuenta atrás → servidor), al volver a la pestaña y tras cada pick con conflicto. 60/min es >10× lo normal con dos pestañas y corta el rastreo.",
  },
  pickem_write: {
    limit: 60, windowSeconds: 60,
    why: "Rellenar un cuadro son 14-28 clics rápidos (y algún cambio). 60/min deja completarlo de una sentada en dos pestañas y corta el bucle automatizado.",
  },
};

export interface RateDecision {
  allowed: boolean;
  /** Segundos hasta que la ventana se reinicia. Va tal cual en `Retry-After`. */
  retryAfter: number;
}

const PERMITIDO: RateDecision = { allowed: true, retryAfter: 0 };

/**
 * Consume un turno de la cubeta indicada para un usuario.
 *
 * `userId` tiene que venir del Bearer. Esta función no lo comprueba porque no puede: quien la
 * llama es el único que sabe de dónde lo sacó, y el contrato es que salga de `getSession`.
 */
export async function takeRate(
  sb: SupabaseClient, userId: string, bucket: RateBucket,
): Promise<RateDecision> {
  const policy = RATE_POLICY[bucket];
  try {
    const { data, error } = await sb.rpc("app_rate_take", {
      p_subject: userId,
      p_bucket: bucket,
      p_limit: policy.limit,
      p_window_seconds: policy.windowSeconds,
    });
    // Fallo abierto: ver la cabecera.
    if (error) { console.error(`[rate] ${bucket}: ${error.message}`); return PERMITIDO; }
    const r = data as { allowed?: boolean; retryAfter?: number } | null;
    if (!r || typeof r.allowed !== "boolean") return PERMITIDO;
    return { allowed: r.allowed, retryAfter: Number(r.retryAfter ?? policy.windowSeconds) };
  } catch (e) {
    console.error(`[rate] ${bucket}: ${e instanceof Error ? e.message : "error"}`);
    return PERMITIDO;
  }
}

/**
 * Respuesta de «demasiadas peticiones».
 *
 * Es DELIBERADAMENTE anodina y siempre igual. No dice qué cubeta se agotó, ni cuántas van, ni si
 * el usuario existe, ni si la partida existe: un mensaje que varíe según el caso es un oráculo
 * que se puede interrogar. Lo único que cambia entre respuestas es `Retry-After`, que es
 * información sobre la política —pública por definición— y no sobre nadie.
 */
export const TOO_MANY = "Demasiadas solicitudes. Inténtalo de nuevo en unos segundos.";

export function rateHeaders(retryAfter: number): Record<string, string> {
  return { "cache-control": "no-store", "retry-after": String(Math.max(1, Math.round(retryAfter))) };
}

/**
 * ¿Este error es «la dependencia no contesta» y no «el servidor está roto»? (Bloque 7.6)
 *
 * Salió midiendo, no teorizando. Con 300 peticiones simultáneas contra la pila local, el cliente
 * de Supabase empieza a devolver `TypeError: fetch failed` («other side closed»): se agotan los
 * sockets contra Kong. La ruta lo recogía en su `catch` final y respondía **500 con el texto
 * interno del error**. Dos cosas mal en una: 500 dice «me he roto yo» cuando lo cierto es «mi
 * dependencia no está», y el texto crudo del error no es asunto del cliente.
 */
export function isDependencyDown(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const txt = `${e.name} ${e.message} ${(e.cause as Error | undefined)?.message ?? ""}`.toLowerCase();
  return txt.includes("fetch failed") || txt.includes("other side closed")
    || txt.includes("econnrefused") || txt.includes("econnreset")
    || txt.includes("socket hang up") || txt.includes("etimedout");
}

/** Lo que se le dice a alguien cuando la base no contesta. Genérico a propósito. */
export const UNAVAILABLE = "El servicio no está disponible ahora mismo. Inténtalo en unos segundos.";

/**
 * Barrido oportunista de contadores muertos.
 *
 * Sin `cron`, igual que la caducidad de la cola (7.4) y el vencimiento de turno (7.4.3): lo mueve
 * el mismo tráfico que crea las filas. Se llama con muy poca probabilidad para que el coste medio
 * por petición sea despreciable — una fila muerta no molesta a nadie, y solo hay que impedir que
 * la tabla crezca sin fin.
 */
export async function maybeSweepRates(sb: SupabaseClient): Promise<void> {
  if (Math.random() > 0.002) return;   // ~1 de cada 500 peticiones
  try { await sb.rpc("app_rate_sweep", { p_older_than_seconds: 3600 }); }
  catch { /* el barrido es comodidad, no corrección */ }
}
