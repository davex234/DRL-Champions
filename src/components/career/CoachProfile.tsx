"use client";

/**
 * COACH PROFILE — perfil/hub de la carrera del entrenador (Career Fase 1/7).
 *
 * Pinta los datos preparados por `careerBroadcast` (motor puro): identidad, atributos,
 * reputación, licencia, palmarés, objetivos, logros y eventos. La UI solo muestra.
 */
import { useMemo } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { careerBroadcast, levelProgress } from "@/career";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";
import { CoachDashboard } from "./CoachDashboard";
import { ClubManagement } from "./ClubManagement";
import { ClubOrganization } from "./ClubOrganization";
import { ClubLegacyPanel } from "./ClubLegacyPanel";
import { TransferMarket } from "./TransferMarket";
import { CareerEndgame } from "./CareerEndgame";
import { useServerEconomy, SERVER_ECONOMY_ONLY } from "@/lib/game/serverEconomy";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("career");

export function CoachProfile() {
  useLocale();
  const career = useManagerStore((s) => s.career)!;
  const claim = useManagerStore((s) => s.claimAchievement);
  const serverEconomy = useServerEconomy();
  const retired = useManagerStore((s) => s.endgame != null);
  const bc = useMemo(() => careerBroadcast(career), [career]);
  const lp = levelProgress(career.xp);

  return (
    <div className="space-y-6">
      {/* Cabecera de identidad */}
      <header className="flex flex-wrap items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-br from-base-800/80 to-base-900/80 p-6">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-drl/30 bg-drl/10 text-5xl">{bc.avatar}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-bold text-white">{bc.name}</h1>
            <span className="rounded-full bg-drl/15 px-2.5 py-0.5 text-xs font-bold text-drl">{bc.license.name}</span>
          </div>
          <p className="mt-1 text-sm text-white/55">
            {bc.age} {tr("años ·")} {bc.country} · {td(bc.region)} · {td(bc.styleLabel)} · {td(bc.personalityLabel)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {bc.personalityTags.map((t) => (
              <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/55">{td(t)}</span>
            ))}
          </div>
          {bc.bio && <p className="mt-2 max-w-2xl text-sm text-white/45">{td(bc.bio)}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Big label={tr("OVR")} value={String(bc.overall)} />
          <Big label={tr("Nivel")} value={String(bc.level)} />
          <Big label={tr("Reputación")} value={String(bc.reputationScore)} />
        </div>
      </header>

      {/* Fin de carrera — ceremonia de legado (Fase 7) cuando el entrenador se retira */}
      {retired && <CareerEndgame />}

      {/* Dashboard de contrato/club (Fase 2) */}
      <CoachDashboard />

      {/* Legado & ecosistema mundial (Fase 6) */}
      {career.management && <ClubLegacyPanel />}

      {/* Organización profesional del club (Fase 5) */}
      {career.management && <ClubOrganization />}

      {/* Gestión integral del club (Fase 3) */}
      {career.management && <ClubManagement />}

      {/* Mercado de fichajes interactivo (Fase 4) */}
      {career.management && <TransferMarket />}

      {/* Llamada al fin de carrera (Fase 7) mientras sigue en activo */}
      {!retired && <CareerEndgame />}

      {/* XP + equipo + objetivo */}
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title={tr("Experiencia")}>
          <p className="text-sm text-white/60">{tr("Nivel")} {bc.level} · <span className="text-drl">{td(bc.reputationTier)}</span></p>
          <Bar value={lp.progress} />
          <p className="mt-1 text-xs text-white/40">{tr("{xp} XP · faltan {missing} para el nivel {level}", { xp: formatCredits(bc.xp), missing: formatCredits(bc.xpToNext), level: bc.level + 1 })}</p>
          {bc.nextLicense && (
            <p className="mt-2 text-xs text-white/40">
              {fill(tr("Próxima licencia {license}: nivel {level}, {titles} títulos, rep {reputation}", { ...slots("license"), level: bc.nextLicense.req.level, titles: bc.nextLicense.req.titles, reputation: bc.nextLicense.req.reputation }), { license: <span className="text-white/70">{td(bc.nextLicense.name)}</span> })}
            </p>
          )}
        </Panel>
        <Panel title={tr("Equipo actual")}>
          <p className="text-lg font-display text-white">{td(bc.currentTeam) ?? tr("En el paro")}</p>
          <p className="mt-1 text-xs text-white/40">{tr("Temporada")} {career.season}</p>
        </Panel>
        <Panel title={tr("Objetivo personal")}>
          <p className="text-sm text-white/70">🎯 {td(bc.personalGoal)}</p>
        </Panel>
      </div>

      {/* Reputación por ámbitos */}
      <Panel title={tr("Reputación mundial")}>
        <div className="grid gap-3 sm:grid-cols-4">
          {([[tr("Local"), bc.reputation.local], [tr("Regional"), bc.reputation.regional], [tr("Continental"), bc.reputation.continental], [tr("Global"), bc.reputation.global]] as const).map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-xs text-white/50"><span>{td(k)}</span><span>{Math.round(v)}</span></div>
              <Bar value={v / 100} />
            </div>
          ))}
        </div>
      </Panel>

      {/* Atributos */}
      <Panel title={tr("Atributos")}>
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {bc.attrFamilies.map((fam) => (
            <div key={fam.family}>
              <p className="mb-2 font-display text-xs uppercase tracking-wider text-drl">{td(fam.family)}</p>
              <div className="space-y-1.5">
                {fam.rows.map((r) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-xs text-white/55">{td(r.label)}</span>
                    <Bar value={r.value / 100} />
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-white/70">{Math.round(r.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Estadísticas vitalicias */}
      <Panel title={tr("Carrera")}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label={tr("Partidos")} value={bc.stats.matchesPlayed} />
          <Stat label={tr("Victorias")} value={bc.stats.wins} />
          <Stat label={tr("Títulos")} value={bc.stats.titles} />
          <Stat label={tr("Finales")} value={bc.stats.finals} />
          <Stat label={tr("MVPs")} value={bc.stats.mvps} />
          <Stat label={tr("Mejor racha")} value={bc.stats.bestWinStreak} />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Objetivos */}
        <Panel title={tr("Objetivos")}>
          <ul className="space-y-2">
            {bc.objectives.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-sm">
                <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px]",
                  o.status === "achieved" ? "bg-drl-cyan/20 text-drl-cyan" : "bg-white/5 text-white/40")}>
                  {o.status === "achieved" ? "✓" : td(HORIZON_ICON[o.horizon])}
                </span>
                <span className={cn(o.status === "achieved" ? "text-white/40 line-through" : "text-white/70")}>{td(o.text)}</span>
                <span className="ml-auto text-[11px] uppercase text-white/30">{td(HORIZON_LABEL[o.horizon])}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Logros */}
        <Panel title={tr("Logros")}>
          <ul className="space-y-2">
            {bc.achievements.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                <span className="text-lg">{a.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-white/80">{td(a.name)}</p>
                  <Bar value={a.current / a.goal} />
                </div>
                {/* F69 · el premio del logro son créditos LOCALES: con cuenta no se reclama (el servidor manda). */}
                {a.complete && !a.claimed && !serverEconomy ? (
                  <button onClick={() => claim(a.id)} className="rounded-md bg-drl px-2 py-1 text-[11px] font-bold text-white hover:brightness-110">
                    +{formatCredits(a.reward)}
                  </button>
                ) : (
                  <span className={cn("text-[11px]", a.claimed ? "text-drl-cyan" : "text-white/30")} title={a.complete && !a.claimed ? td(SERVER_ECONOMY_ONLY) : undefined}>{a.claimed ? tr("Reclamado") : a.complete ? tr("Completado") : `${a.current}/${a.goal}`}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Palmarés */}
      {bc.titles.length > 0 && (
        <Panel title={tr("Palmarés")}>
          <ul className="space-y-1.5">
            {bc.titles.slice().reverse().map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-white/70">
                <span>🏆</span><span className="text-white/85">{td(t.competition)}</span>
                <span className="text-white/40">· {t.team} · T{t.season}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Crónica reciente */}
      {bc.recentEvents.length > 0 && (
        <Panel title={tr("Crónica")}>
          <ul className="space-y-1.5">
            {bc.recentEvents.map((e, i) => (
              <li key={i} className="text-sm text-white/55"><span className="text-white/30">T{e.season}</span> · {td(e.detail)}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

const HORIZON_LABEL: Record<string, string> = { short: "Corto", medium: "Medio", long: "Largo", lifetime: "Vital" };
const HORIZON_ICON: Record<string, string> = { short: "•", medium: "◆", long: "★", lifetime: "∞" };

function Big({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="rounded-xl border border-white/10 bg-base-900/50 px-4 py-2">
      <p className="font-display text-2xl font-bold text-white">{td(value)}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  useLocale();
  return (
    <div className="rounded-lg border border-white/5 bg-base-900/40 p-2 text-center">
      <p className="font-display text-xl font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <section className="rounded-2xl border border-white/10 bg-base-800/50 p-5">
      <h2 className="mb-3 font-display text-sm uppercase tracking-wider text-white/70">{td(title)}</h2>
      {children}
    </section>
  );
}
function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl transition-all" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
