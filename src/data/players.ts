import type { Player, Region, RoleId } from "@/domain/cards/types";
import { statsFromMetrics, type RawMetrics } from "@/domain/cards/statsFromMetrics";

/**
 * Datos semilla de jugadores profesionales de Valorant.
 * Stats en escala 0-99 (plausibles, ajustables). `accolades` define qué
 * cartas especiales existen para cada jugador en el catálogo.
 *
 * Ampliar el roster = añadir entradas aquí.
 */
const SEED_PLAYERS: Player[] = [
  // ============ EMEA ============
  {
    id: "benjy",
    nick: "Benjyfishy",
    fullName: "Benjamin Fish",
    team: "Team Heretics",
    teamTag: "TH",
    region: "EMEA",
    role: "Iniciador",
    country: "GB",
    stats: { dmg: 84, scr: 86, com: 85, hs: 78, ast: 88, clu: 82 },
    accolades: ["ewc-winner", "regional-winner"],
  },
  {
    id: "wo0t",
    nick: "Wo0t",
    fullName: "Mohamed Yassine Ouchen",
    team: "Team Heretics",
    teamTag: "TH",
    region: "EMEA",
    role: "Duelista",
    country: "MA",
    stats: { dmg: 90, scr: 91, com: 89, hs: 79, ast: 58, clu: 85 },
    accolades: ["ewc-winner", "ewc-mvp", "regional-winner"],
  },
  {
    id: "derke",
    nick: "Derke",
    fullName: "Nikita Sirmitev",
    team: "Fnatic",
    teamTag: "FNC",
    region: "EMEA",
    role: "Duelista",
    country: "FI",
    stats: { dmg: 93, scr: 94, com: 91, hs: 84, ast: 55, clu: 87 },
    accolades: ["masters-winner", "masters-mvp", "regional-winner", "regional-mvp", "prime"],
  },
  {
    id: "boaster",
    nick: "Boaster",
    fullName: "Jake Howlett",
    team: "Fnatic",
    teamTag: "FNC",
    region: "EMEA",
    role: "Iniciador",
    country: "GB",
    stats: { dmg: 70, scr: 72, com: 74, hs: 62, ast: 92, clu: 80 },
    accolades: ["masters-winner", "regional-winner"],
  },
  {
    id: "alfajer",
    nick: "Alfajer",
    fullName: "Emir Ali Beder",
    team: "Fnatic",
    teamTag: "FNC",
    region: "EMEA",
    role: "Centinela",
    country: "TR",
    stats: { dmg: 89, scr: 90, com: 90, hs: 88, ast: 70, clu: 86 },
    accolades: ["masters-winner", "regional-mvp", "regional-winner", "prime"],
  },
  {
    id: "chronicle",
    nick: "Chronicle",
    fullName: "Timofey Khromov",
    team: "Fnatic",
    teamTag: "FNC",
    region: "EMEA",
    role: "Flex",
    country: "RU",
    stats: { dmg: 86, scr: 87, com: 88, hs: 76, ast: 80, clu: 84 },
    accolades: ["masters-winner", "regional-winner"],
  },
  {
    id: "leo",
    nick: "Leo",
    fullName: "Leo Jannesson",
    team: "Team Liquid",
    teamTag: "TL",
    region: "EMEA",
    role: "Iniciador",
    country: "SE",
    stats: { dmg: 82, scr: 84, com: 83, hs: 70, ast: 90, clu: 81 },
    accolades: ["regional-winner"],
  },
  {
    id: "scream",
    nick: "ScreaM",
    fullName: "Adil Benrlitom",
    team: "Karmine Corp",
    teamTag: "KC",
    region: "EMEA",
    role: "Duelista",
    country: "BE",
    stats: { dmg: 88, scr: 86, com: 85, hs: 95, ast: 60, clu: 80 },
    accolades: ["hall-of-fame", "icon"],
  },

  // ============ AMERICAS ============
  {
    id: "aspas",
    nick: "aspas",
    fullName: "Erick Santos",
    team: "MIBR",
    teamTag: "MIBR",
    region: "Americas",
    role: "Duelista",
    country: "BR",
    stats: { dmg: 95, scr: 96, com: 93, hs: 80, ast: 58, clu: 90 },
    accolades: ["champions-winner", "champions-mvp", "regional-winner", "icon", "prime"],
  },
  {
    id: "demon1",
    nick: "Demon1",
    fullName: "Max Mazanov",
    team: "NRG",
    teamTag: "NRG",
    region: "Americas",
    role: "Duelista",
    country: "US",
    stats: { dmg: 94, scr: 95, com: 92, hs: 78, ast: 56, clu: 88 },
    accolades: ["champions-winner", "champions-mvp", "regional-winner", "prime"],
  },
  {
    id: "boostio",
    nick: "Boostio",
    fullName: "Kelden Pupello",
    team: "NRG",
    teamTag: "NRG",
    region: "Americas",
    role: "Centinela",
    country: "US",
    stats: { dmg: 80, scr: 82, com: 81, hs: 68, ast: 86, clu: 88 },
    accolades: ["champions-winner", "regional-winner"],
  },
  {
    id: "tenz",
    nick: "TenZ",
    fullName: "Tyson Ngo",
    team: "Sentinels",
    teamTag: "SEN",
    region: "Americas",
    role: "Duelista",
    country: "CA",
    stats: { dmg: 92, scr: 92, com: 89, hs: 90, ast: 60, clu: 85 },
    accolades: ["masters-winner", "regional-winner", "icon", "prime"],
  },
  {
    id: "zekken",
    nick: "zekken",
    fullName: "Zachary Patrone",
    team: "Sentinels",
    teamTag: "SEN",
    region: "Americas",
    role: "Duelista",
    country: "US",
    stats: { dmg: 91, scr: 92, com: 90, hs: 76, ast: 66, clu: 86 },
    accolades: ["masters-winner", "masters-mvp", "regional-winner"],
  },
  {
    id: "johnqt",
    nick: "johnqt",
    fullName: "Mohamed Ouarid",
    team: "Sentinels",
    teamTag: "SEN",
    region: "Americas",
    role: "Iniciador",
    country: "MA",
    stats: { dmg: 78, scr: 80, com: 80, hs: 66, ast: 84, clu: 83 },
    accolades: ["masters-winner", "regional-winner"],
  },
  {
    id: "sacy",
    nick: "Sacy",
    fullName: "Gustavo Rossi",
    team: "Sentinels",
    teamTag: "SEN",
    region: "Americas",
    role: "Iniciador",
    country: "BR",
    stats: { dmg: 83, scr: 85, com: 84, hs: 72, ast: 87, clu: 84 },
    accolades: ["champions-winner", "masters-winner", "regional-winner"],
  },

  // ============ PACIFIC ============
  {
    id: "t3xture",
    nick: "t3xture",
    fullName: "Kim Na-ra",
    team: "Gen.G",
    teamTag: "GENG",
    region: "Pacific",
    role: "Duelista",
    country: "KR",
    stats: { dmg: 93, scr: 95, com: 92, hs: 82, ast: 62, clu: 89 },
    accolades: ["champions-winner", "champions-mvp", "regional-winner", "prime"],
  },
  {
    id: "meteor",
    nick: "Meteor",
    fullName: "Kim Tae-O",
    team: "Gen.G",
    teamTag: "GENG",
    region: "Pacific",
    role: "Iniciador",
    country: "KR",
    stats: { dmg: 85, scr: 87, com: 86, hs: 74, ast: 82, clu: 85 },
    accolades: ["champions-winner", "regional-winner"],
  },
  {
    id: "zest",
    nick: "Zest",
    fullName: "Kim Gi-seok",
    team: "DRX",
    teamTag: "DRX",
    region: "Pacific",
    role: "Centinela",
    country: "KR",
    stats: { dmg: 79, scr: 82, com: 82, hs: 68, ast: 85, clu: 86 },
    accolades: ["regional-winner", "regional-mvp"],
  },
  {
    id: "mako",
    nick: "MaKo",
    fullName: "Kim Myeong-gwan",
    team: "DRX",
    teamTag: "DRX",
    region: "Pacific",
    role: "Controlador",
    country: "KR",
    stats: { dmg: 77, scr: 80, com: 80, hs: 70, ast: 83, clu: 84 },
    accolades: ["regional-winner"],
  },
  {
    id: "buzz",
    nick: "BuZz",
    fullName: "Yu Byung-chul",
    team: "DRX",
    teamTag: "DRX",
    region: "Pacific",
    role: "Duelista",
    country: "KR",
    stats: { dmg: 90, scr: 90, com: 88, hs: 80, ast: 60, clu: 84 },
    accolades: ["regional-winner", "regional-mvp"],
  },

  // ============ CHINA ============
  {
    id: "zmjjkk",
    nick: "ZmjjKK",
    fullName: "Zheng Yongkang",
    team: "EDward Gaming",
    teamTag: "EDG",
    region: "China",
    role: "Duelista",
    country: "CN",
    stats: { dmg: 92, scr: 93, com: 90, hs: 81, ast: 57, clu: 86 },
    accolades: ["masters-winner", "regional-winner", "regional-mvp"],
  },
  {
    id: "chichoo",
    nick: "CHICHOO",
    fullName: "Zhang Yongkang",
    team: "EDward Gaming",
    teamTag: "EDG",
    region: "China",
    role: "Iniciador",
    country: "CN",
    stats: { dmg: 76, scr: 78, com: 79, hs: 64, ast: 84, clu: 82 },
    accolades: ["masters-winner", "regional-winner"],
  },
  {
    id: "haodong",
    nick: "Haodong",
    fullName: "Guo Haodong",
    team: "EDward Gaming",
    teamTag: "EDG",
    region: "China",
    role: "Centinela",
    country: "CN",
    stats: { dmg: 81, scr: 83, com: 83, hs: 72, ast: 80, clu: 85 },
    accolades: ["masters-winner", "regional-winner"],
  },
  {
    id: "nobody",
    nick: "nobody",
    fullName: "Wang Senxu",
    team: "EDward Gaming",
    teamTag: "EDG",
    region: "China",
    role: "Flex",
    country: "CN",
    stats: { dmg: 84, scr: 85, com: 85, hs: 73, ast: 78, clu: 83 },
    accolades: ["masters-winner", "regional-winner"],
  },

  // ============ GAME CHANGERS ============
  {
    id: "mimi",
    nick: "mimi",
    fullName: "Michaela Lintrup",
    team: "Shopify Rebellion",
    teamTag: "SR",
    region: "EMEA",
    role: "Iniciador",
    country: "DK",
    stats: { dmg: 83, scr: 85, com: 84, hs: 74, ast: 82, clu: 82 },
    accolades: ["game-changers", "regional-winner"],
  },
  {
    id: "flexinja",
    nick: "Flxja",
    fullName: "Florescent",
    team: "G2 Gozen",
    teamTag: "G2",
    region: "Americas",
    role: "Duelista",
    country: "US",
    stats: { dmg: 87, scr: 88, com: 86, hs: 76, ast: 64, clu: 83 },
    accolades: ["game-changers", "regional-winner"],
  },
];

// ============================================================================
// ROSTER REAL — VCT 2026 (Fase 2)
//
// `players-vct-2026.json` es la descarga real de VLR (13 torneos oficiales, 371 jugadores) ya
// agregada por jugador y ponderada por rondas. Es la fuente de `metrics`; de ahí el dominio
// deriva Stronghold/Gamesense/Entryfrag.
//
// Los jugadores SEMILLA de arriba son autoría editorial previa. Al fusionar:
//   · si el semilla existe en VLR  → conserva su ficha editorial (equipo, rol, palmarés) y
//     RECIBE las métricas reales, que es lo único que el modelo necesita;
//   · si el semilla NO existe en VLR → se queda sin `metrics` y NO genera carta. No se le
//     inventan estadísticas: para reincorporarlo hace falta rellenar `editorial` a mano.
//   · los jugadores de VLR que no estaban en la semilla se añaden al roster.
// ============================================================================
import VLR_ROSTER from "./vlr/players-vct-2026.json";

interface VlrRosterRow {
  id: string; vlrId: string; nick: string; team: string; teamTag: string;
  region: string; country: string; role: string;
  metrics: {
    acs: number | null; adr: number | null; kd: number | null; kast: number | null;
    hsPct: number | null; kills: number; deaths: number; assists: number;
    fk: number; fd: number; rounds: number;
  };
  maps: number;
}

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const asRegion = (r: string): Region => (REGIONS.includes(r as Region) ? (r as Region) : "EMEA");
const asRole = (r: string): RoleId => (ROLES.includes(r as RoleId) ? (r as RoleId) : "Flex");

/** Convierte una fila de la descarga en métricas de dominio. Los nulos se omiten (no se rellenan). */
function toMetrics(m: VlrRosterRow["metrics"]): RawMetrics {
  const out: RawMetrics = {
    kills: m.kills, deaths: m.deaths, assists: m.assists,
    fk: m.fk, fd: m.fd, rounds: m.rounds,
  };
  if (m.acs != null) out.acs = m.acs;
  if (m.adr != null) out.adr = m.adr;
  if (m.kd != null) out.kd = m.kd;
  if (m.kast != null) out.kast = m.kast;
  if (m.hsPct != null) out.hsPct = m.hsPct;
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

function buildRoster(): Player[] {
  const vlr = VLR_ROSTER as VlrRosterRow[];
  const byNick = new Map(vlr.map((r) => [norm(r.nick), r]));
  const usedVlrIds = new Set<string>();

  // 1. Los semilla conservan su identidad editorial y reciben las métricas reales si existen.
  const merged: Player[] = SEED_PLAYERS.map((p) => {
    const hit = byNick.get(norm(p.nick));
    if (!hit) return p;
    usedVlrIds.add(hit.vlrId);
    return { ...p, metrics: toMetrics(hit.metrics) };
  });

  // 2. El resto del circuito se incorpora tal cual. `stats` (6 heredadas) se derivan de las
  //    mismas métricas para que el simulador siga funcionando; no intervienen en el combate.
  const seedNicks = new Set(SEED_PLAYERS.map((p) => norm(p.nick)));
  for (const r of vlr) {
    if (seedNicks.has(norm(r.nick))) continue;
    const metrics = toMetrics(r.metrics);
    merged.push({
      id: r.id,
      nick: r.nick,
      team: r.team || r.teamTag,
      teamTag: r.teamTag,
      region: asRegion(r.region),
      role: asRole(r.role),
      country: r.country,
      stats: statsFromMetrics(metrics),
      accolades: [],
      metrics,
    });
  }
  return merged;
}

/** Roster completo del juego: semilla editorial + circuito real VCT 2026. */
export const PLAYERS: Player[] = buildRoster();

/** Solo los jugadores con métricas reales suficientes (>= MIN_ROUNDS). */
export const VLR_PLAYER_COUNT = (VLR_ROSTER as VlrRosterRow[]).length;
