/**
 * ARNÉS QA · FASE 44 — ESCENAS (QA SYNTHETIC).
 *
 * Cada escena dice qué enseña y de qué sección del encargo es. Las piezas nuevas de la fase (armazón, JUGAR, momentos,
 * cargador, estados, XP, rating, hojas, audio, laboratorio de movimiento) se montan en nativo con datos inventados y
 * etiquetados; los laboratorios de sobre, partida, campaña, draft, colección, temporada y perfil reutilizan los arneses
 * reales de sus fases (misma pieza, mismo dominio) para no crear un segundo juego de fixtures.
 */
export type SectionId =
  | "GAME SHELL" | "PLAY CTA" | "MODE SELECT" | "HOME" | "PACKS" | "PACK OPENING" | "COLLECTION" | "CARD DETAIL"
  | "DECKS" | "STRATEGY" | "PREMATCH" | "COMBAT" | "RESULTS" | "CAMPAIGN" | "DRAFT" | "RANKED" | "SEASON" | "MISSIONS"
  | "ACHIEVEMENTS" | "EVENTS" | "PICKEMS" | "PROFILE" | "EMPTY" | "ERROR" | "OFFLINE" | "LOADING" | "MOTION" | "REDUCED MOTION";

export interface Fase44Scene {
  id: string;
  section: SectionId;
  note: string;
  /** Escena de otro arnés real (se monta en un marco). */
  frame?: string;
}

const f = (section: SectionId, id: string, note: string, frame?: string): Fase44Scene => ({ id, section, note, frame });

export const FASE44_SCENES: Fase44Scene[] = [
  f("GAME SHELL", "shell-menu", "hoja «Menú» del móvil con todas las secciones y el sonido"),
  f("GAME SHELL", "shell-bars", "barra superior y dock: JUGAR/CONTINUAR en sus tres tamaños"),
  f("PLAY CTA", "play-cta", "JUGAR en reposo, CONTINUAR PARTIDA (solo con partida del servidor) y foco"),
  f("MODE SELECT", "mode-select", "selector de modos con cuenta, equipo listo y campaña empezada"),
  f("MODE SELECT", "mode-locked", "selector sin equipo válido: bloqueos con su motivo real"),
  f("MODE SELECT", "mode-signed-out", "selector sin sesión"),
  f("HOME", "home-claim", "lobby: acción del día = reclamar → escenario JUGAR encima", "/design-system/fase36?scene=claim"),
  f("HOME", "home-resume", "lobby con partida PvE a medias → el héroe ES CONTINUAR PARTIDA", "/design-system/fase36?scene=match-pve"),
  f("HOME", "home-packs", "lobby con sobres sin abrir", "/design-system/fase36?scene=packs"),
  f("HOME", "home-fresh", "cuenta nueva (primera sesión)", "/design-system/fase36?scene=fresh"),
  f("HOME", "home-returning", "vuelta tras 7 días", "/design-system/fase42?scene=return-7d"),
  f("PACKS", "packs-inventory", "inventario: ABRIR SOBRE domina y el sobre es un objeto"),
  f("PACKS", "packs-empty", "sin sobres: conseguir o jugar"),
  f("PACK OPENING", "pack-ready", "sobre antes de abrir", "/design-system/fase38?scene=stage-ready"),
  f("PACK OPENING", "pack-opening", "resultado del servidor recibido: rotura", "/design-system/fase38?scene=stage-opening"),
  f("PACK OPENING", "pack-hand-legendary", "cartas boca abajo con legendaria dentro (anticipación SOLO tras el servidor)", "/design-system/fase38?scene=stage-hand-legendary"),
  f("PACK OPENING", "pack-common", "común revelada (nivel 2)", "/design-system/fase38?scene=reveal-common"),
  f("PACK OPENING", "pack-uncommon", "poco común revelada (nivel 2)", "/design-system/fase38?scene=reveal-uncommon"),
  f("PACK OPENING", "pack-rare", "rara revelada (nivel 3 ligero)", "/design-system/fase38?scene=reveal-rare"),
  f("PACK OPENING", "pack-epic", "épica revelada (nivel 3)", "/design-system/fase38?scene=reveal-epic"),
  f("PACK OPENING", "pack-legendary", "legendaria revelada (nivel 4, luz de sala)", "/design-system/fase38?scene=reveal-legendary"),
  f("PACK OPENING", "pack-serial-one", "serial #1 (nivel 4)", "/design-system/fase38?scene=reveal-serial-one"),
  f("PACK OPENING", "pack-new", "carta NUEVA", "/design-system/fase38?scene=reveal-new"),
  f("PACK OPENING", "pack-duplicate", "DUPLICADA (secundario, sin valor ni venta)", "/design-system/fase38?scene=reveal-duplicate"),
  f("PACK OPENING", "pack-summary-mixed", "resumen mezclado", "/design-system/fase38?scene=summary-mixed"),
  f("PACK OPENING", "pack-summary-all-new", "resumen: todas nuevas", "/design-system/fase38?scene=summary-all-new"),
  f("PACK OPENING", "pack-summary-all-dup", "resumen: todas duplicadas", "/design-system/fase38?scene=summary-all-duplicates"),
  f("PACK OPENING", "pack-open-another", "resumen con ABRIR OTRO (dock fijo)", "/design-system/fase38?scene=summary-open-another"),
  f("PACK OPENING", "pack-no-more", "resumen sin más sobres", "/design-system/fase38?scene=summary-no-more"),
  f("COLLECTION", "collection-veteran", "colección grande", "/design-system/fase37?scene=hub-veteran"),
  f("COLLECTION", "collection-fresh", "colección vacía", "/design-system/fase37?scene=hub-fresh"),
  f("CARD DETAIL", "card-detail", "ficha de carta", "/design-system/fase37?scene=detail-owned"),
  f("DECKS", "decks-hub", "mis equipos (loadouts)", "/design-system/fase32?scene=hub"),
  f("DECKS", "deck-moments", "PLANTILLA LISTA y EQUIPO ACTIVO como momento"),
  f("STRATEGY", "strategy-lab", "laboratorio de equipo", "/design-system/fase43?scene=legal-balanced"),
  f("STRATEGY", "strategy-swap", "vista previa de cambio", "/design-system/fase43?scene=swap-tradeoff"),
  f("PREMATCH", "prematch", "preparación PvE", "/design-system/fase33?scene=prematch-pve"),
  f("PREMATCH", "prematch-rival-hidden", "privacidad PvP: rival oculto", "/design-system/fase33?scene=rival-hidden"),
  f("COMBAT", "combat-intro", "entrada de partida", "/design-system/fase33?scene=intro"),
  f("COMBAT", "combat-turn", "turno 1 atacando", "/design-system/fase33?scene=turn1-attack"),
  f("COMBAT", "combat-stat", "revelado de estadística", "/design-system/fase33?scene=stat-reveal"),
  f("COMBAT", "combat-match-point", "punto de partida (derivado honestamente)", "/design-system/fase33?scene=match-point"),
  f("RESULTS", "result-victory", "VICTORIA con XP que anima y acciones arriba"),
  f("RESULTS", "result-defeat", "DERROTA sin vergüenza: progreso y siguiente acción"),
  f("RESULTS", "result-draw", "EMPATE con presentación propia"),
  f("RESULTS", "result-level-up", "victoria que cruza un nivel real: SUBIDA DE NIVEL"),
  f("RESULTS", "xp-levels", "XP: sin cambio, un tramo, un nivel y varios niveles"),
  f("RESULTS", "rating-delta", "rating antes → después (+ y −), sin cifras intermedias"),
  f("RESULTS", "moments", "momentos: objetivo, logro, nivel, plantilla, equipo activo"),
  f("CAMPAIGN", "campaign-map", "mapa de campaña", "/design-system/fase35?scene=map-mid"),
  f("CAMPAIGN", "campaign-node", "nodo disponible", "/design-system/fase35?scene=node-available"),
  f("DRAFT", "draft-pick", "elección de draft", "/design-system/fase39?state=pick-1"),
  f("DRAFT", "draft-run", "run: fases 1 → 5", "/design-system/fase39?state=gauntlet-map"),
  f("RANKED", "ranked", "resultado ranked", "/design-system/fase33?scene=ranked-result"),
  f("SEASON", "season", "temporada", "/design-system/fase34?scene=full"),
  f("MISSIONS", "missions", "objetivos de hoy y de la semana", "/design-system/fase42?scene=normal-today"),
  f("ACHIEVEMENTS", "achievements", "logros por reclamar", "/design-system/fase36?scene=claim-achievement"),
  f("EVENTS", "events", "eventos reales", "/design-system/fase42?scene=event-upcoming"),
  f("PICKEMS", "pickems", "predicción pendiente", "/design-system/fase42?scene=pickem-soon"),
  f("PROFILE", "profile", "perfil de jugador", "/design-system/fase31?scene=own-full"),
  f("EMPTY", "empty", "estados vacíos con siguiente acción"),
  f("ERROR", "error", "NO SE HA PODIDO CARGAR + REINTENTAR + VOLVER AL LOBBY; mensaje técnico filtrado"),
  f("ERROR", "not-found", "404 del juego"),
  f("OFFLINE", "offline", "ESTÁS SIN CONEXIÓN"),
  f("LOADING", "loading", "cargador de juego y esqueletos contextuales"),
  f("LOADING", "toasts", "avisos de juego (sin «Success»)"),
  f("MOTION", "motion-lab", "niveles 0–4, tokens, muelles y familias de transición"),
  f("MOTION", "overlays", "hoja y diálogo con Escape y foco atrapado"),
  f("MOTION", "audio", "ajustes de sonido"),
  f("REDUCED MOTION", "reduced", "mismo laboratorio: con movimiento reducido todo se lee igual y quieto"),
];

export const SECTIONS: SectionId[] = [...new Set(FASE44_SCENES.map((s) => s.section))];
