/**
 * IDENTITY RESOLVER (Fase 4) — puente Analyzer (`p:*` canónico del Importer) ↔ roster del
 * catálogo. Orden: alias inyectado → id exacto (sin prefijo) → nick normalizado (REUTILIZA
 * `normalizeKey` de intel). Varios candidatos ⇒ `ambiguous` (nunca se adivina). Sin match ⇒
 * `NewPlayerDraft` con stats base REUTILIZANDO `statsFromMetrics`. Sin estado global.
 */
import { normalizeKey } from "@/intel/identity";
import { statsFromMetrics } from "@/domain/cards/statsFromMetrics";
import type { Player, RoleId } from "@/domain/cards/types";
import type { AnalyzerResult, PlayerReport } from "@/analyzer";
import type { GeneratorCtx, PlayerResolution } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("cardgenerator");

const ROLE_MAP: Record<string, RoleId> = {
  duelist: "Duelista", initiator: "Iniciador", sentinel: "Centinela", controller: "Controlador",
};
const roleFor = (role?: string): RoleId => ROLE_MAP[(role ?? "").toLowerCase()] ?? "Flex";

const stripPrefix = (id: string): string => (id.startsWith("p:") ? id.slice(2) : id);

/** Id de catálogo único para un draft (colisiones → sufijo determinista). */
const draftId = (nick: string, taken: Set<string>): string => {
  const base = normalizeKey(nick) || "player";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

function buildDraft(p: PlayerReport, analysis: AnalyzerResult, ctx: GeneratorCtx, taken: Set<string>): Player {
  const meta = ctx.playerMeta?.[p.playerId] ?? {};
  const team = analysis.report.teams.find((t) => t.teamId === p.teamId);
  const teamName = team?.name ?? "";
  return {
    id: draftId(p.nick, taken),
    nick: p.nick,
    fullName: meta.fullName,
    team: teamName,
    teamTag: teamName.slice(0, 3).toUpperCase(),
    region: meta.region ?? "EMEA",
    role: roleFor(p.role),
    country: meta.country ?? "",
    // Stats base desde las métricas REALES del torneo (statsFromMetrics reutilizado).
    stats: statsFromMetrics({
      acs: p.acs, adr: p.adr, kills: p.kills, deaths: p.deaths,
      assists: p.assists, hsPct: p.hsPct, clutches: p.clutches, kast: p.kast,
    }),
    accolades: [],
    image: meta.image,
    status: "active",
  };
}

/** Resuelve todos los jugadores del informe contra el roster inyectado. Orden por analyzerId. */
export function resolvePlayers(analysis: AnalyzerResult, ctx: GeneratorCtx): PlayerResolution[] {
  const byId = new Map(ctx.roster.map((p) => [p.id, p]));
  const byNick = new Map<string, Player[]>();
  for (const p of ctx.roster) {
    const k = normalizeKey(p.nick);
    const arr = byNick.get(k);
    if (arr) arr.push(p);
    else byNick.set(k, [p]);
  }
  const taken = new Set(ctx.roster.map((p) => p.id));

  const out: PlayerResolution[] = [];
  for (const p of [...analysis.report.players].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const alias = ctx.aliases?.[p.playerId] ?? ctx.aliases?.[normalizeKey(p.nick)];
    if (alias) {
      out.push(byId.has(alias)
        ? { analyzerId: p.playerId, nick: p.nick, status: "resolved", playerId: alias, reason: "alias inyectado" }
        : { analyzerId: p.playerId, nick: p.nick, status: "ambiguous", reason: tr("alias \"{alias}\" no existe en el roster", { alias: td(alias) }) });
      continue;
    }
    const direct = byId.get(stripPrefix(p.playerId));
    if (direct) {
      out.push({ analyzerId: p.playerId, nick: p.nick, status: "resolved", playerId: direct.id, reason: "id exacto" });
      continue;
    }
    const nickMatches = byNick.get(normalizeKey(p.nick)) ?? [];
    if (nickMatches.length === 1) {
      out.push({ analyzerId: p.playerId, nick: p.nick, status: "resolved", playerId: nickMatches[0].id, reason: "nick normalizado" });
      continue;
    }
    if (nickMatches.length > 1) {
      out.push({ analyzerId: p.playerId, nick: p.nick, status: "ambiguous", reason: tr("{length} jugadores con nick \"{nick}\" — requiere alias", { length: nickMatches.length, nick: p.nick }) });
      continue;
    }
    const draft = buildDraft(p, analysis, ctx, taken);
    taken.add(draft.id);
    out.push({ analyzerId: p.playerId, nick: p.nick, status: "created", playerId: draft.id, draft, reason: tr("jugador nuevo (draft)") });
  }
  return out;
}
