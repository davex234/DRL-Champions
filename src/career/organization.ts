/**
 * ORGANIZACIÓN DEL CLUB — el nivel de "dirigir G2/Fnatic/Sentinels" (Career Fase 5/7).
 *
 * NO es otro Club/Finance/Facility/Staff Engine: es la CAPA que COMPONE los motores de Fase 3
 * (facilities/staff/sponsors/economy/academy) en una organización viva — prestigio multi-fuente,
 * fanbase con estado de ánimo, valor total del club e IA de organizaciones rivales. Reutiliza el
 * Living World (WorldTeam prestige/budget/fanbase) y el buzón de noticias. PURO y DETERMINISTA.
 */
import type { NewsItem } from "@/intel";
import type { WorldState, WorldTeam } from "@/world";
import type { ClubView, ClubManagement } from "./types";
import { facilityEffects, FACILITY_IDS, MAX_FACILITY_LEVEL } from "./facilities";
import { staffEffects } from "./staff";
import { makeRng, seedOf, type Rng } from "./rng";
import { ns } from "@/i18n/runtime";

const tr = ns("career");

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ───────────────────────────── Roles de la organización ─────────────────────────────

/** Las 11 posiciones de una organización profesional (el Head Coach = el usuario). */
export const ORG_POSITIONS = [
  { key: "head_coach", label: "Head Coach", isUser: true },
  { key: "ceo", label: "CEO", isUser: false },
  { key: "sporting_director", label: "Director deportivo", isUser: false },
  { key: "assistant_coach", label: "Entrenador asistente", isUser: false },
  { key: "analyst", label: "Analista", isUser: false },
  { key: "scout", label: "Ojeador", isUser: false },
  { key: "psychologist", label: "Psicólogo", isUser: false },
  { key: "performance", label: "Preparador físico", isUser: false },
  { key: "content_manager", label: "Content Manager", isUser: false },
  { key: "marketing_manager", label: "Marketing Manager", isUser: false },
  { key: "community_manager", label: "Community Manager", isUser: false },
] as const;

// ───────────────────────────── Prestigio multi-fuente ─────────────────────────────

export interface PrestigeBreakdown {
  results: number; content: number; fans: number; history: number; legends: number;
  academy: number; staff: number; sponsors: number; facilities: number; transfers: number;
  /** Delta de prestigio a aplicar esta temporada (acotado). */
  total: number;
}

export interface PrestigeInputs {
  club: ClubView;
  mgmt: ClubManagement;
  champion: boolean;
  legends: number;         // jugadores/entrenadores legendarios en el club
  transferActivity: number;// gasto+ingreso del mercado de la temporada
}

/** El prestigio ya NO depende solo de ganar: contenido/fans/historia/leyendas/academia/staff/
 *  sponsors/instalaciones/fichajes. Devuelve el desglose + delta acotado. Determinista. */
export function computePrestige(inp: PrestigeInputs): PrestigeBreakdown {
  const { club, mgmt } = inp;
  const fx = facilityEffects(mgmt.facilities);
  const sx = staffEffects(mgmt.staff);
  const topFrac = 1 - (club.position - 1) / Math.max(1, club.totalTeams - 1); // 1 = campeón

  const avgFac = FACILITY_IDS.reduce((a, id) => a + (mgmt.facilities[id] ?? 1), 0) / FACILITY_IDS.length;
  const topSponsors = mgmt.sponsors.filter((s) => s.tier === "title" || s.tier === "global").length;

  const results = (topFrac - 0.5) * 6 + (inp.champion ? 1.5 : 0);      // -3..+4.5
  const content = clamp(fx.contentReach * 1.2 + sx.contentBoost * 1.4, 0, 2);
  const fans = clamp(club.fanbase / 8000, 0, 1.5);
  const history = clamp(club.titles * 0.05, 0, 1);
  const legends = clamp(inp.legends * 0.3, 0, 1.2);
  const academy = clamp(fx.academyQuality * 0.8 + (mgmt.academyStaff?.length ?? 0) * 0.15, 0, 1.2);
  const staff = clamp((sx.commercialBoost + sx.trainingBoost + sx.infoBoost) * 0.5, 0, 1.2);
  const sponsors = clamp(topSponsors * 0.25, 0, 0.8);
  const facilities = clamp((avgFac - 1) / (MAX_FACILITY_LEVEL - 1), 0, 1);
  const transfers = clamp(inp.transferActivity / 60000, 0, 1);

  const raw = results + content + fans + history + legends + academy + staff + sponsors + facilities + transfers;
  const total = clamp(raw, -4, 6);
  return { results, content, fans, history, legends, academy, staff, sponsors, facilities, transfers, total };
}

// ───────────────────────────── Fanbase viva ─────────────────────────────

export type FanbaseMood = "eufórica" | "contenta" | "neutral" | "inquieta" | "enfadada";

export interface FanbaseResult {
  delta: number;          // variación de fans a aplicar (WorldTeam.fanbase)
  mood: FanbaseMood;
  moodScore: number;      // 0..100
  merchRevenue: number;   // ingreso extra por merchandising del ánimo (informativo)
  message: string;
}

export interface FanbaseInputs {
  club: ClubView;
  mgmt: ClubManagement;
  champion: boolean;
  expectation: number;    // posición esperada (1 = campeón)
  bigSignings: number;    // fichajes-bomba de la temporada
}

/** La afición crece/decrece, se enfada o celebra según resultados vs expectativa, contenido,
 *  fichajes y engagement. Influye en prestigio/ingresos (merch). Determinista. */
export function computeFanbase(inp: FanbaseInputs): FanbaseResult {
  const { club, mgmt } = inp;
  const fx = facilityEffects(mgmt.facilities);
  const sx = staffEffects(mgmt.staff);
  const beatExpectation = inp.expectation - club.position; // >0 = mejor de lo esperado
  const engagement = fx.fanEngagement + sx.communityBoost + fx.contentReach * 0.5 + sx.marketingBoost * 0.6;

  const moodScore = clamp(
    50 + beatExpectation * 8 + (inp.champion ? 20 : 0) + inp.bigSignings * 6 + engagement * 15 - (club.position > club.totalTeams * 0.75 ? 20 : 0),
    0, 100,
  );
  const mood: FanbaseMood = moodScore >= 82 ? "eufórica" : moodScore >= 62 ? "contenta" : moodScore >= 42 ? "neutral" : moodScore >= 25 ? "inquieta" : "enfadada";

  // Crecimiento base por ánimo + engagement; una afición enfadada se marcha.
  const growthRate = (moodScore - 50) / 100 * 0.12 + engagement * 0.03;
  const delta = Math.round(club.fanbase * growthRate + (inp.champion ? 200 : 0) + inp.bigSignings * 40);
  const merchRevenue = Math.round(Math.max(0, club.fanbase * (moodScore / 100) * (1 + fx.fanEngagement) * 1.5));
  const message =
    mood === "eufórica" ? tr("La afición está EN LLAMAS: récord de merchandising y ambiente.")
    : mood === "contenta" ? tr("La afición disfruta de la temporada.")
    : mood === "neutral" ? tr("La afición mantiene la calma.")
    : mood === "inquieta" ? tr("La afición empieza a impacientarse.")
    : tr("La afición está ENFADADA: caen abonos y ventas.");
  return { delta, mood, moodScore, merchRevenue, message };
}

// ───────────────────────────── Valor total del club ─────────────────────────────

export interface ClubValue { squad: number; facilities: number; academy: number; brand: number; total: number }

/** Valor total de la ORGANIZACIÓN: plantilla + instalaciones + academia + marca (fanbase/prestigio/sponsors). */
export function clubValue(mgmt: ClubManagement, squadValue: number, club: ClubView): ClubValue {
  const facilities = FACILITY_IDS.reduce((a, id) => a + Math.round(3000 * Math.pow(1.7, (mgmt.facilities[id] ?? 1)) - 3000), 0);
  const academy = mgmt.academy.reduce((a, p) => a + p.value, 0) + (mgmt.academyStaff?.length ?? 0) * 3000;
  const brand = Math.round(club.fanbase * 8 + club.prestige * 500 + mgmt.sponsors.reduce((a, s) => a + s.income, 0) * 2);
  const total = squadValue + facilities + academy + brand;
  return { squad: squadValue, facilities, academy, brand, total };
}

// ───────────────────────────── IA de organizaciones ─────────────────────────────

export type OrgEventType = "investment" | "cost_cut" | "academy_built" | "staff_signed" | "income_record" | "financial_trouble" | "fan_record";
export interface OrgEvent { id: string; type: OrgEventType; season: number; at: number; clubId: string; clubName: string; detail: string; magnitude: number }

/**
 * Los clubes IA también dirigen su organización: invierten en instalaciones (prestigio↑,
 * presupuesto↓), recortan (presupuesto estable), construyen academias, contratan staff. Se
 * refleja en prestige/budget/fanbase del WorldTeam. O(clubes) por temporada. Determinista.
 * `protectTeamId` blinda al club del usuario (lo gestiona el usuario). Bounded para rendimiento.
 */
export function runAiOrganizations(world: WorldState, protectTeamId: string | null, at: number): OrgEvent[] {
  const rng: Rng = makeRng(seedOf(world.seed, "org", world.season));
  const events: OrgEvent[] = [];
  const teams = Object.values(world.teams);
  const cap = Math.max(2, Math.floor(teams.length * 0.05)); // nº de noticias notables por temporada
  let notable = 0;

  for (const t of teams) {
    if (protectTeamId && t.id === protectTeamId) continue;
    const r = makeRng(seedOf(world.seed, "org", world.season, t.id));
    const rich = t.budget > 25000;
    const good = t.standings.length ? t.standings[t.standings.length - 1].pos <= teams.length * 0.4 : false;

    if (rich && r.chance(0.55)) {
      // INVIERTE: gasta en organización → prestigio y fans suben, presupuesto baja.
      const spend = Math.round(3000 + r.int(0, 6000));
      t.budget = Math.max(0, t.budget - spend);
      t.prestige = clamp(t.prestige + 0.6 + (good ? 0.5 : 0), 0, 100);
      t.fanbase = Math.round(t.fanbase * 1.01 + 40);
      if (notable < cap && r.chance(0.25)) { events.push(mk("investment", world, t, tr("{name} invierte {spend} en su organización.", { name: t.name, spend }), 45, at)); notable++; }
    } else if (!rich && r.chance(0.5)) {
      // RECORTA: preserva presupuesto, prestigio se estanca/baja levemente.
      t.prestige = clamp(t.prestige - 0.15, 0, 100);
      if (notable < cap && r.chance(0.15)) { events.push(mk("cost_cut", world, t, tr("{name} aplica un plan de austeridad.", { name: t.name }), 30, at)); notable++; }
    }
    // Construir academia (raro, clubes con proyecto).
    if (t.prestige > 55 && r.chance(0.06) && notable < cap) { t.prestige = clamp(t.prestige + 0.8, 0, 100); events.push(mk("academy_built", world, t, tr("{name} inaugura una nueva academia.", { name: t.name }), 55, at)); notable++; }
  }
  return events;
}

function mk(type: OrgEventType, world: WorldState, t: WorldTeam, detail: string, magnitude: number, at: number): OrgEvent {
  return { id: `org:${world.season}:${type}:${t.id}`, type, season: world.season, at, clubId: t.id, clubName: t.name, detail, magnitude };
}

// ───────────────────────────── Noticias de organización ─────────────────────────────

const ORG_KIND: Record<OrgEventType, NewsItem["kind"]> = {
  investment: "event", cost_cut: "event", academy_built: "special", staff_signed: "transfer",
  income_record: "record", financial_trouble: "record", fan_record: "record",
};
const ORG_TITLE: Record<OrgEventType, string> = {
  investment: "Inversión en el club", cost_cut: "Ajuste presupuestario", academy_built: "Nueva academia",
  staff_signed: "Refuerzo en el staff", income_record: "Récord de ingresos", financial_trouble: "Apuros financieros", fan_record: "Récord de afición",
};

/** Eventos de organización → NewsItem (buzón único, ids deterministas). `at` lo inyecta el store. */
export function orgNews(events: OrgEvent[]): NewsItem[] {
  return events.map((e) => ({
    id: `org:${e.season}:${e.type}:${e.clubId}`,
    at: e.at, kind: ORG_KIND[e.type], title: ORG_TITLE[e.type], body: e.detail, tags: ["club", e.type],
  }));
}

/** Prestigio como "tier" del club (para dashboards). */
export function prestigeTier(prestige: number): string {
  return prestige >= 85 ? tr("Élite mundial") : prestige >= 68 ? tr("Top continental") : prestige >= 50 ? tr("Consolidado") : prestige >= 32 ? tr("Emergente") : tr("Modesto");
}
