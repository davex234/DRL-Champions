/**
 * ADAPTADOR VLR → SYNC (Fase 17C) — el traductor que faltaba entre dos sistemas terminados.
 *
 *   importer-vlr (validado)          este fichero            syncTournament (escrito)
 *   RawSnapshot            ────────► CompetitiveSource ────► Supabase
 *
 * ────────────────────────── POR QUÉ HACE FALTA ──────────────────────────
 *
 * Los dos extremos existían y funcionaban, pero hablan idiomas distintos. Ambos declaran
 * tipos `Raw*` CON LOS MISMOS NOMBRES y forma diferente, que es justo lo que hacía que el
 * hueco no se viera:
 *
 *   · El importer identifica por NOMBRE            → `RawMatch.teamA: "Fnatic"`
 *     El sync identifica por ID                    → `RawMatch.teamAId: "vlr-t-2593"`
 *   · El importer entrega el scoreboard PLANO      → `mapStats[]` con `matchMapId`
 *     El sync lo espera ANIDADO                    → `map.players[]`
 *   · El importer referencia fases por `stageId`   → el sync por `stageSlug`
 *   · El importer da agentes y mapas por NOMBRE    → las FK exigen el slug de `agents`/`maps`
 *
 * Aquí se traduce. NADA más: no se descarga, no se escribe, no se calcula ninguna estadística
 * y no se inventa un solo dato. Si una identidad no se puede resolver, se DECLARA como
 * incidencia y el llamador decide — nunca se rellena con un valor por defecto.
 *
 * ────────────────────────── CRITERIO DE IDENTIDAD ──────────────────────────
 *
 * Se reutiliza lo que ya existe, sin inventar un sistema nuevo:
 *
 *   · Equipos y jugadores llevan el ID REAL de vlr.gg con prefijo de origen (`vlr-t-`,
 *     `vlr-p-`), igual que la semilla usa `demo-`. El id no se inventa: lo publica la fuente.
 *   · Un equipo que solo aparece en partidos (sin ficha propia en VLR) se identifica por su
 *     nombre normalizado. Es determinista y no colisiona con los que sí traen id.
 *   · El scoreboard referencia al jugador por NICK, así que el cruce nick → id se hace contra
 *     el roster del propio torneo. Si un nick es ambiguo, se declara y NO se elige por azar.
 *   · Agentes y mapas se resuelven contra las tablas `agents` y `maps` que YA están pobladas,
 *     comparando por nombre. No se añade ninguna fila a esos catálogos.
 */
import type { RawSnapshot } from "@/importer";
import type {
  CompetitiveSource, RawCircuit, RawTournament, RawStage, RawTeam, RawMatch, RawMatchMap,
  RawMapPlayer, RawStanding,
} from "./source";

/** Fila de `players` lista para upsert. El sync no daba de alta jugadores; ahora sí. */
export interface SyncPlayerRow {
  id: string;
  nick: string;
  full_name: string | null;
  team_id: string | null;
  region: string | null;
  role: string | null;
  country: string | null;
  status: string;
}

/** Una identidad que no se ha podido resolver. Nunca se resuelve «por defecto». */
export interface AdapterIssue {
  kind: "agente-desconocido" | "mapa-desconocido" | "nick-ambiguo" | "jugador-sin-identidad"
    | "equipo-sin-identidad" | "partido-invalido" | "mapa-invalido";
  detail: string;
}

export interface AdapterOptions {
  /**
   * Id del evento en Supabase. Se pasa SIEMPRE de forma explícita para que la primera pasada
   * real pueda ir a un evento aislado y no pueda tocar `demo-masters-madrid-2026` por descuido.
   */
  eventId: string;
  /** Catálogo de agentes ya existente: nombre → id. No se amplía. */
  agents: Map<string, string>;
  /** Catálogo de mapas ya existente: nombre → id. No se amplía. */
  maps: Map<string, string>;
}

export interface AdapterResult {
  source: CompetitiveSource;
  /** Filas de `players` que el sync debe dar de alta antes de escribir estadísticas. */
  players: SyncPlayerRow[];
  issues: AdapterIssue[];
  summary: {
    eventId: string;
    eventName: string;
    teams: number;
    players: number;
    matches: number;
    maps: number;
    mapStats: number;
    standings: number;
    /** Filas de scoreboard que no pudieron enlazarse con un jugador. Debe ser 0. */
    orphanStats: number;
  };
}

/** Normalización para comparar nombres. Igual criterio que el conector: minúsculas y sin ruido. */
const norm = (s: string | undefined | null): string =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Slug estable a partir de un nombre, para entidades que la fuente no identifica. */
const slug = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sin-nombre";

export function snapshotToSource(snapshot: RawSnapshot, opts: AdapterOptions): AdapterResult {
  const issues: AdapterIssue[] = [];
  const push = (kind: AdapterIssue["kind"], detail: string) => issues.push({ kind, detail });

  /* ── 1. EQUIPOS · nombre → id ─────────────────────────────────────────────
   * El id real de VLR cuando la fuente lo publica; el nombre normalizado cuando el equipo solo
   * aparece en partidos (caso que el propio conector contempla y que la auditoría pedía cubrir).
   */
  const teamIdByName = new Map<string, string>();
  const teamNameById = new Map<string, string>();
  const teams: RawTeam[] = [];
  for (const t of snapshot.teams) {
    if (!t.name) { push("equipo-sin-identidad", "equipo sin nombre en el snapshot"); continue; }
    const id = t.id ? `vlr-t-${t.id}` : `vlr-t-${slug(t.name)}`;
    teamIdByName.set(norm(t.name), id);
    if (t.tag) teamIdByName.set(norm(t.tag), id);
    teamNameById.set(id, t.name);
    teams.push({
      id, name: t.name, tag: t.tag, fullName: t.fullName,
      region: t.region ?? snapshot.tournament.region, country: t.country,
    });
  }
  const teamId = (name: string | undefined): string | undefined =>
    name ? teamIdByName.get(norm(name)) : undefined;

  /* ── 2. JUGADORES · nick → id ─────────────────────────────────────────────
   * El scoreboard referencia por NICK, así que el cruce se hace contra el roster del torneo.
   * Un nick repetido es ambiguo: se declara y no se elige ninguno.
   */
  const playerIdByNick = new Map<string, string>();
  const ambiguous = new Set<string>();
  const players: SyncPlayerRow[] = [];
  for (const p of snapshot.players) {
    if (!p.nick) { push("jugador-sin-identidad", "jugador sin nick en el snapshot"); continue; }
    if (!p.id) { push("jugador-sin-identidad", `«${p.nick}» sin id de VLR`); continue; }
    const key = norm(p.nick);
    if (playerIdByNick.has(key) && playerIdByNick.get(key) !== `vlr-p-${p.id}`) {
      ambiguous.add(key);
      push("nick-ambiguo", `«${p.nick}» corresponde a más de un jugador; no se resuelve por azar`);
      continue;
    }
    const id = `vlr-p-${p.id}`;
    playerIdByNick.set(key, id);
    players.push({
      id, nick: p.nick, full_name: p.fullName ?? null,
      team_id: teamId(p.team) ?? null,
      region: p.region ?? snapshot.tournament.region ?? null,
      role: p.role ?? null, country: p.country ?? null,
      status: p.status ?? "active",
    });
  }
  const playerId = (nick: string | undefined): string | undefined => {
    if (!nick) return undefined;
    const key = norm(nick);
    return ambiguous.has(key) ? undefined : playerIdByNick.get(key);
  };

  /* ── 3. FASES · stageId → stageSlug ───────────────────────────────────── */
  const stageSlugById = new Map<string, string>();
  const stages: RawStage[] = (snapshot.stages ?? []).map((s, i) => {
    const sl = s.slug ?? slug(s.name);
    stageSlugById.set(s.id, sl);
    return { slug: sl, name: s.name, kind: s.kind, orderIdx: s.orderIdx ?? i };
  });

  /* ── 4. SCOREBOARD · plano → anidado en map.players[] ─────────────────── */
  const statsByMapId = new Map<string, RawMapPlayer[]>();
  let orphanStats = 0;
  for (const st of snapshot.mapStats ?? []) {
    const pid = playerId(st.player);
    if (!pid) {
      orphanStats++;
      push("jugador-sin-identidad", `scoreboard de «${st.player}» sin jugador en el roster del torneo`);
      continue;
    }
    const tid = teamId(st.team);
    if (!tid) {
      orphanStats++;
      push("equipo-sin-identidad", `scoreboard de «${st.player}» con equipo «${st.team}» no resuelto`);
      continue;
    }
    let agentId: string | undefined;
    if (st.agent) {
      agentId = opts.agents.get(norm(st.agent));
      if (!agentId) push("agente-desconocido", `agente «${st.agent}» no existe en la tabla agents`);
    }
    const list = statsByMapId.get(st.matchMapId) ?? [];
    list.push({
      playerId: pid, nick: st.player, teamId: tid, agentId,
      kills: st.kills, deaths: st.deaths, assists: st.assists,
      acs: st.acs, kast: st.kast, hsPct: st.hsPct,
      // vlr.gg publica el ADR ya por ronda; no da ni daño total ni rondas por mapa, así que
      // se pasa medido y el mapper lo prefiere igual que ya hace con `acs` y `kast`.
      adr: st.adr,
      fk: st.fk, fd: st.fd, clutches: st.clutches,
    });
    statsByMapId.set(st.matchMapId, list);
  }

  /* ── 5. MAPAS por partido ─────────────────────────────────────────────── */
  const mapsByMatch = new Map<string, RawMatchMap[]>();
  for (const mp of snapshot.maps ?? []) {
    if (!mp.matchId) { push("mapa-invalido", `mapa ${mp.id} sin partido`); continue; }
    if (mp.mapOrder == null) { push("mapa-invalido", `mapa ${mp.id} sin orden`); continue; }
    let mapId: string | undefined;
    if (mp.map) {
      mapId = opts.maps.get(norm(mp.map));
      if (!mapId) push("mapa-desconocido", `mapa «${mp.map}» no existe en la tabla maps`);
    }
    const list = mapsByMatch.get(mp.matchId) ?? [];
    list.push({
      mapId, mapOrder: mp.mapOrder, scoreA: mp.scoreA, scoreB: mp.scoreB,
      winnerTeamId: teamId(mp.winner),
      pickedBy: teamId(mp.pickedBy),
      players: statsByMapId.get(mp.id) ?? [],
    });
    mapsByMatch.set(mp.matchId, list);
  }

  /* ── 6. PARTIDOS · nombres → ids, con los mapas ya anidados ───────────── */
  const matches: RawMatch[] = [];
  for (const m of snapshot.matches) {
    const a = teamId(m.teamA);
    const b = teamId(m.teamB);
    if (!a || !b) {
      push("partido-invalido", `partido ${m.id}: equipo no resuelto (${m.teamA} vs ${m.teamB})`);
      continue;
    }
    matches.push({
      id: m.id, eventId: opts.eventId,
      stageSlug: m.stageId ? stageSlugById.get(m.stageId) : undefined,
      teamAId: a, teamBId: b,
      startTime: m.startTime, status: m.status, format: m.format, bestOf: m.bestOf,
      round: m.round, matchOrder: m.matchOrder,
      scoreA: m.scoreA, scoreB: m.scoreB,
      winnerTeamId: teamId(m.winner),
      mvpPlayerId: playerId(m.mvp),
      maps: mapsByMatch.get(m.id) ?? [],
    });
  }

  /* ── 7. CLASIFICACIÓN ─────────────────────────────────────────────────── */
  const standings: RawStanding[] = [];
  for (const s of snapshot.standings ?? []) {
    const tid = teamId(s.team);
    if (!tid) { push("equipo-sin-identidad", `clasificación con equipo «${s.team}» no resuelto`); continue; }
    standings.push({
      stageSlug: s.stageId ? stageSlugById.get(s.stageId) : undefined,
      teamId: tid, position: s.position, groupLabel: s.groupLabel, status: s.status,
    });
  }

  /* ── 8. TORNEO ────────────────────────────────────────────────────────── */
  const t = snapshot.tournament;
  const tournament: RawTournament = {
    id: opts.eventId, name: t.name, type: t.type, circuitId: t.circuitId, tier: t.tier,
    region: t.region, status: t.status, slug: t.slug, prizePool: t.prizePool,
    location: t.location, country: t.country, startDate: t.startDate, endDate: t.endDate,
  };
  const circuits: RawCircuit[] = snapshot.circuit
    ? [{ id: snapshot.circuit.id, name: snapshot.circuit.name, tier: snapshot.circuit.tier, region: snapshot.circuit.region, scope: snapshot.circuit.scope }]
    : [];

  const source: CompetitiveSource = {
    id: "vlr",
    label: `VLR · ${t.name}`,
    getCircuits: async () => circuits,
    getTournaments: async () => [tournament],
    getTournament: async (id) => (id === opts.eventId ? tournament : null),
    getStages: async () => stages,
    getTeams: async () => teams,
    // Los partidos ya llevan sus mapas y su scoreboard, así que `syncTournament` no necesita
    // pedir detalle: no hay red que valga desde aquí.
    getMatches: async () => matches,
    getMatchDetail: async (matchId) => matches.find((m) => m.id === matchId) ?? null,
    getStandings: async () => standings,
  };

  const mapCount = [...mapsByMatch.values()].reduce((n, l) => n + l.length, 0);
  const statCount = [...statsByMapId.values()].reduce((n, l) => n + l.length, 0);

  return {
    source, players, issues,
    summary: {
      eventId: opts.eventId, eventName: t.name,
      teams: teams.length, players: players.length, matches: matches.length,
      maps: mapCount, mapStats: statCount, standings: standings.length, orphanStats,
    },
  };
}
