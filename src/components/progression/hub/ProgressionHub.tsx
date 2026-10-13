"use client";

/**
 * FASE 62 · EL HUB DE PROGRESO — una pantalla de juego, no un cuadro de mandos.
 *
 * Se alimenta de UNA lectura (`GET /api/game/meta`) y responde, en este orden:
 *   1. ¿QUÉ ESTOY PROGRESANDO?   → dos medidores, cada uno con su XP y su nombre: CUENTA y TEMPORADA.
 *   2. ¿QUÉ PUEDO CONSEGUIR YA?  → lo reclamable, con su recompensa real y el botón (reclamo manual, servidor).
 *   3. ¿QUÉ DEBERÍA HACER HOY?   → objetivos del día / semana / temporada / hitos, «Renueva en» del servidor y un acceso
 *                                  a la pantalla que los mueve.
 *   4. ¿QUÉ ME FALTA?            → el carril de temporada en ventana (pasado · actual · siguiente · bloqueado).
 *   + logros, colección (cartas únicas / 331), competitivo (APARTE del nivel) y lo último recibido.
 *
 * Nada se calcula aquí: el modelo sale de `domain/progression/hub` sobre la foto del servidor.
 *
 * IA 2026-10-07 · DOS VISTAS de la MISMA pieza (sin duplicar nada): `view="full"` es MI CUENTA → PROGRESIÓN (lo que he
 * conseguido, lo que puedo reclamar y lo que me falta); `view="objectives"` es TEMPORADA → OBJETIVOS (qué hacer: los
 * objetivos del pase por tipo, con su reclamo en la propia fila). Mismos reclamos del servidor en las dos.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { EASE } from "@/design/motion";
import { Meter } from "@/components/ui/Meter";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { RewardReveal } from "@/components/rewards/RewardReveal";
import { useNow } from "@/lib/useNow";
import { useClaims } from "@/lib/progression/claims";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import {
  claimables, meter, objectiveGroups, resetLabel, trackWindow,
  type Claimable, type ObjectiveCard, type TrackNode,
} from "@/domain/progression/hub";
import { XP_NAMES } from "@/domain/rewards/display";

const fmt = (n: number) => n.toLocaleString("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions);

export function ProgressionHub({ snap, receivedAt, reload, view = "full" }: { snap: MetaSnapshot; receivedAt: number; reload: () => Promise<void>; view?: "full" | "objectives" }) {
  /* Reloj del servidor estimado: `serverNow` + lo transcurrido en local desde que llegó la foto (nunca el reloj local a secas). */
  const now = useNow(30_000);
  const serverNow = snap.serverNow + Math.max(0, now - receivedAt);
  const pass = snap.pass;
  const list = useMemo(() => claimables(pass, snap.serverNow), [pass, snap.serverNow]);
  const groups = useMemo(() => objectiveGroups(pass.missions, snap.serverNow), [pass.missions, snap.serverNow]);
  const track = useMemo(() => trackWindow(pass.tracks.free, pass.level, pass.season.maxLevel), [pass.tracks.free, pass.level, pass.season.maxLevel]);
  const claims = useClaims(reload);
  /*
   * «Reclamar todo» ENCADENADO: reclamar misiones sube la XP de temporada y puede abrir niveles del carril; se vuelve a
   * leer la foto del servidor y se recogen también (como mucho 3 rondas, solo claves no intentadas). El servidor decide.
   */
  const [chaining, setChaining] = useState(false);
  const chainRef = useRef(false);
  const claimEverything = async (first: Claimable[]) => {
    if (chainRef.current) return;
    chainRef.current = true;
    setChaining(true);
    try {
    const tried = new Set<string>();
    let next = first;
    for (let round = 0; round < 3 && next.length > 0; round++) {
      next.forEach((c) => tried.add(c.key));
      await claims.claimAll(next);
      const fresh = await fetchMetaSnapshot().catch(() => null);
      if (!fresh) break;
      next = claimables(fresh.pass, fresh.serverNow).filter((c) => !tried.has(c.key));
    }
    } finally { chainRef.current = false; setChaining(false); }
  };

  const reveal = (
    <AnimatePresence>
      {claims.claimed.length > 0 && <RewardReveal key="reveal" claimed={claims.claimed} onClose={claims.clearReveal} />}
    </AnimatePresence>
  );

  const objectives = (
      <section id="objetivos" {...(view === "full" ? { "aria-labelledby": "h-objetivos" } : { "aria-label": "Objetivos de la temporada" })} className="scroll-mt-24">
        {/* En Temporada → Objetivos la página ya se titula «Objetivos»: aquí no se repite (BATTLE PASS CLEANUP, 2026-10-07). */}
        {view === "full" && <SectionHead id="h-objetivos" kicker="Qué hacer ahora" title="Objetivos" />}
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.id} className="nx-f62-panel p-4" data-group={g.id}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[15px] font-bold uppercase tracking-[0.1em] text-white">{g.label}</h3>
                {g.resetsAt && <span className="nx-label !text-[10px] text-white/55" data-testid={`reset-${g.id}`}>{resetLabel(g.resetsAt, serverNow)}</span>}
              </div>
              <ul className="flex flex-col gap-2.5">
                {g.items.map((o) => (
                  <ObjectiveRow key={o.key} o={o} busy={claims.busy.has(o.key)} onClaim={() => {
                    const c = list.find((x) => x.key === o.key);
                    if (c) void claims.claimOne(c);
                  }} />
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="text-[13px] text-white/55">Tus objetivos se asignan al abrir <Link href="/logros" className="nx-action">Logros y pase</Link>.</p>}
        </div>
      </section>
  );

  if (view === "objectives") {
    return (
      <div className="flex flex-col gap-6" data-f62="objectives">
        {objectives}
        {reveal}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-f62="hub">
      <Hero snap={snap} serverNow={serverNow} />

      <ClaimCenter list={list} busy={claims.busy} chaining={chaining} onOne={claims.claimOne} onAll={(l) => void claimEverything(l)} errors={claims.last.filter((o) => !o.ok)} />

      {objectives}

      <section aria-labelledby="h-temporada">
        <SectionHead id="h-temporada" kicker={pass.season.name} title="Camino de temporada" link={{ href: "/temporada/pase", label: "Ver pase de batalla" }} />
        <div className="nx-f62-panel p-4">
          {track.complete ? (
            <p className="font-display text-[15px] font-bold uppercase text-drl-gold" data-testid="track-complete">Temporada completada · nivel {track.maxLevel} de {track.maxLevel}</p>
          ) : track.next ? (
            <p className="mb-3 text-[13px] text-white/75" data-testid="track-next">
              Siguiente recompensa en el <b className="text-white">nivel {track.next.level}</b>:{" "}
              <RewardDisplay reward={track.next.reward} size="sm" className="align-middle" />
            </p>
          ) : null}
          <ol className="flex items-stretch gap-2 overflow-x-auto pb-1" aria-label="Recompensas del carril libre">
            {track.hiddenBefore > 0 && <li className="grid shrink-0 place-items-center px-1 text-[11px] text-white/40">+{track.hiddenBefore}</li>}
            {track.nodes.map((n) => <TrackCell key={n.level} n={n} />)}
            {track.hiddenAfter > 0 && <li className="grid shrink-0 place-items-center px-1 text-[11px] text-white/40">+{track.hiddenAfter}</li>}
          </ol>
          {!pass.competitiveUnlocked && (
            <p className="mt-3 text-[12px] text-white/55">El carril competitivo se abre en Oro ({fmt(pass.competitiveMinPoints)} puntos de rango · tienes {fmt(pass.points)}).</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Achievements snap={snap} />
        <Collection snap={snap} />
        <Competitive snap={snap} />
        <Recent snap={snap} />
      </div>

      {reveal}
    </div>
  );
}

/* ─────────────────────────── cabecera: CUENTA y TEMPORADA ─────────────────────────── */

function Hero({ snap, serverNow }: { snap: MetaSnapshot; serverNow: number }) {
  const lv = snap.level;
  const acc = meter(lv.xpIntoLevel, lv.xpForNext, false, `${XP_NAMES.account}: ${fmt(lv.xpIntoLevel)} de ${fmt(lv.xpForNext)}`);
  const season = snap.season;
  const seasonComplete = season.level >= season.maxLevel;
  const sea = meter(season.xpIntoLevel, season.xpForNext, seasonComplete, `${XP_NAMES.season}: ${fmt(season.xpIntoLevel)} de ${fmt(season.xpForNext)}`);
  const daysLeft = season.endsAt ? Math.max(0, Math.ceil((season.endsAt - serverNow) / 86_400_000)) : null;
  return (
    <section aria-label="Tu progreso" className="grid gap-4 md:grid-cols-2" data-testid="hub-hero">
      <div className="nx-f62-hero relative overflow-hidden p-5" data-kind="account">
        <span className="nx-label !text-[10px] text-[#7ff0ff]">Nivel de cuenta</span>
        <div className="mt-2 flex items-center gap-4">
          <LevelBadge value={lv.level} tone="account" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white">{fmt(lv.xpIntoLevel)} / {fmt(lv.xpForNext)} <span className="text-[#7ff0ff]">{XP_NAMES.account}</span></p>
            <Meter className="mt-2" value={acc.ratio * 100} tone="info" height={10} label={acc.label} />
            <p className="mt-1.5 text-[12px] text-white/60">Faltan <b className="text-white">{fmt(lv.toNext)}</b> para el nivel {lv.level + 1}. Se gana jugando duelos y abriendo sobres.</p>
          </div>
        </div>
      </div>
      <div className="nx-f62-hero relative overflow-hidden p-5" data-kind="season">
        <div className="flex items-baseline justify-between gap-2">
          <span className="nx-label !text-[10px] text-[#ffe08a]">Temporada · {season.name}</span>
          {daysLeft !== null && <span className="nx-label !text-[10px] text-white/55">{daysLeft === 0 ? "Termina hoy" : `Quedan ${daysLeft} días`}</span>}
        </div>
        <div className="mt-2 flex items-center gap-4">
          <LevelBadge value={season.level} tone="season" max={season.maxLevel} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white">
              {seasonComplete ? "Nivel máximo" : <>{fmt(season.xpIntoLevel)} / {fmt(season.xpForNext)} <span className="text-[#ffe08a]">{XP_NAMES.season}</span></>}
            </p>
            <Meter className="mt-2" value={sea.ratio * 100} tone="gold" height={10} label={sea.label} />
            <p className="mt-1.5 text-[12px] text-white/60">La {XP_NAMES.season.toLowerCase()} se gana <b className="text-white">reclamando objetivos</b>. Cada nivel abre una recompensa del carril.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LevelBadge({ value, tone, max }: { value: number; tone: "account" | "season"; max?: number }) {
  return (
    <span className={cn("nx-f62-badge grid shrink-0 place-items-center", tone === "season" && "is-season")} aria-hidden>
      <b className="font-display text-[28px] font-extrabold leading-none text-white">{value}</b>
      {max ? <span className="font-display text-[10px] text-white/55">/ {max}</span> : null}
    </span>
  );
}

/* ─────────────────────────── reclamar ─────────────────────────── */

function ClaimCenter({ list, busy, chaining, onOne, onAll, errors }: {
  list: Claimable[]; busy: Set<string>; chaining: boolean; onOne: (c: Claimable) => void; onAll: (l: Claimable[]) => void; errors: { key: string; error: string | null }[];
}) {
  const reduced = useReducedMotion();
  if (list.length === 0) {
    return (
      <section className="nx-f62-panel flex flex-wrap items-center justify-between gap-3 p-4" data-testid="claim-center" data-count={0}>
        <p className="text-[13px] text-white/65">No tienes nada pendiente de recoger. Completa objetivos para sumar {XP_NAMES.season.toLowerCase()}.</p>
        <Link href="/jugar" className="nx-f62-cta" data-testid="claim-play">Jugar</Link>
      </section>
    );
  }
  const anyBusy = busy.size > 0 || chaining;
  return (
    <section className="nx-f62-claims p-4" aria-labelledby="h-reclamar" data-testid="claim-center" data-count={list.length}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="nx-label !text-[10px] text-drl-gold">Ya lo has ganado</span>
          <h2 id="h-reclamar" className="font-display text-[20px] font-extrabold uppercase tracking-[0.04em] text-white">{list.length} {list.length === 1 ? "recompensa por reclamar" : "recompensas por reclamar"}</h2>
        </div>
        <button type="button" className="nx-f62-cta is-gold" disabled={anyBusy} aria-busy={anyBusy} onClick={() => onAll(list)} data-testid="claim-all">
          {anyBusy ? "Reclamando…" : "Reclamar todo"}
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((c, i) => (
          <motion.li
            key={c.key}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-black/35 px-3 py-2.5 ring-1 ring-white/10"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (reduced ? 0.02 : 0.04) * i, duration: 0.2, ease: EASE.out }}
            data-claim={c.kind}
          >
            <span className="min-w-0">
              <b className="block truncate text-[13px] text-white">{c.label}</b>
              <RewardDisplay reward={c.reward} seasonXp={c.seasonXp} size="sm" />
              {errors.find((e) => e.key === c.key) && <span className="block text-[11px] text-drl-red">{errors.find((e) => e.key === c.key)!.error}</span>}
            </span>
            <button type="button" className="nx-f62-cta shrink-0" disabled={busy.has(c.key)} aria-busy={busy.has(c.key)} onClick={() => onOne(c)} data-claim-key={c.key}>
              {busy.has(c.key) ? "…" : "Reclamar"}
            </button>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

/* ─────────────────────────── objetivos ─────────────────────────── */

const STATE_TEXT = { CLAIMABLE: "Completado", IN_PROGRESS: "En progreso", CLAIMED: "Recogido", EXPIRED: "Caducado" } as const;

function ObjectiveRow({ o, busy, onClaim }: { o: ObjectiveCard; busy: boolean; onClaim: () => void }) {
  return (
    <li className={cn("rounded-lg bg-black/30 p-3 ring-1", o.state === "CLAIMABLE" ? "ring-drl-gold/50" : "ring-white/10", o.state === "CLAIMED" && "opacity-60")} data-objective={o.id} data-state={o.state}>
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 text-[13.5px] text-white">{o.label}</b>
        <span className="nx-readout shrink-0 text-[13px] text-white/85">{o.current} / {o.goal}</span>
      </div>
      <Meter className="mt-2" value={(o.current / o.goal) * 100} tone={o.state === "CLAIMABLE" || o.state === "CLAIMED" ? "ok" : "info"} height={6} label={`${o.label}: ${o.current} de ${o.goal}`} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <RewardDisplay reward={o.reward} seasonXp={o.seasonXp} size="sm" />
        <span className="flex items-center gap-2">
          <span className="nx-label !text-[9px] text-white/50">{STATE_TEXT[o.state]}</span>
          {o.state === "CLAIMABLE" && <button type="button" className="nx-f62-cta is-gold !min-h-[36px]" disabled={busy} aria-busy={busy} onClick={onClaim}>{busy ? "…" : "Reclamar"}</button>}
          {o.cta && <Link href={o.cta.href} className="nx-f62-cta !min-h-[36px]" data-cta-metric>{o.cta.label}</Link>}
        </span>
      </div>
    </li>
  );
}

/* ─────────────────────────── carril ─────────────────────────── */

const NODE_TEXT: Record<TrackNode["state"], string> = { CLAIMED: "Recogido", CLAIMABLE: "Reclamable", CURRENT: "Alcanzado", NEXT: "Siguiente", LOCKED: "Bloqueado" };

function TrackCell({ n }: { n: TrackNode }) {
  return (
    <li className={cn("nx-f62-node flex w-[104px] shrink-0 flex-col items-center gap-1.5 p-2 text-center", `is-${n.state.toLowerCase()}`)} data-node={n.level} data-state={n.state}>
      <span className="font-display text-[12px] font-bold text-white">Nivel {n.level}</span>
      <RewardDisplay reward={n.reward} size="sm" layout="stack" dim={n.state === "LOCKED"} />
      <span className="nx-label !text-[9px]">{NODE_TEXT[n.state]}</span>
    </li>
  );
}

/* ─────────────────────────── tarjetas ─────────────────────────── */

function Card({ title, children, link, testid }: { title: string; children: React.ReactNode; link?: { href: string; label: string }; testid: string }) {
  return (
    <section className="nx-f62-panel flex flex-col p-4" data-testid={testid}>
      <h3 className="nx-label !text-[10px] text-white/70">{title}</h3>
      <div className="mt-2 flex-1">{children}</div>
      {link && <Link href={link.href} className="nx-action mt-3 text-[12px]">{link.label} →</Link>}
    </section>
  );
}

function Achievements({ snap }: { snap: MetaSnapshot }) {
  const a = snap.pass.achievements;
  const claimed = a.filter((x) => x.claimed).length;
  const ready = a.filter((x) => x.complete && !x.claimed).length;
  const near = a.filter((x) => !x.complete).sort((x, y) => y.current / y.goal - x.current / x.goal)[0] ?? null;
  return (
    <Card title="Logros" testid="hub-achievements" link={{ href: "/logros", label: "Todos los logros" }}>
      <p className="font-display text-[26px] font-extrabold leading-none text-white">{claimed}<span className="text-[15px] text-white/45"> / {a.length}</span></p>
      {ready > 0 && <p className="mt-1 text-[12px] text-drl-gold">{ready} listo{ready === 1 ? "" : "s"} para reclamar</p>}
      {near && (
        <div className="mt-3">
          <p className="text-[12.5px] text-white/80">{near.name}</p>
          <Meter className="mt-1" value={(near.current / Math.max(1, near.goal)) * 100} tone="gold" height={5} label={`${near.name}: ${near.current} de ${near.goal}`} />
          <p className="mt-1 text-[11px] text-white/50">{Math.min(near.current, near.goal)} / {near.goal}</p>
        </div>
      )}
    </Card>
  );
}

function Collection({ snap }: { snap: MetaSnapshot }) {
  const c = snap.collection;
  if (!c) return <Card title="Colección" testid="hub-collection" link={{ href: "/coleccion", label: "Ver colección" }}><p className="text-[12px] text-white/55">Sin datos de colección.</p></Card>;
  const next = c.milestones.find((m) => !m.reached) ?? null;
  return (
    <Card title="Colección" testid="hub-collection" link={{ href: "/coleccion", label: "Ver colección" }}>
      <p className="font-display text-[26px] font-extrabold leading-none text-white" data-unique={c.unique} data-total={c.total}>{c.unique}<span className="text-[15px] text-white/45"> / {c.total}</span></p>
      <p className="mt-1 text-[11.5px] text-white/55">cartas únicas del catálogo · {fmt(c.instances)} ejemplares</p>
      <Meter className="mt-2" value={c.progress * 100} tone="info" height={5} label={`Colección: ${c.unique} de ${c.total} cartas únicas`} />
      {next && <p className="mt-1.5 text-[11.5px] text-white/60">Siguiente marca: {next.at} únicas (te faltan {next.at - c.unique})</p>}
    </Card>
  );
}

function Competitive({ snap }: { snap: MetaSnapshot }) {
  const r = snap.rating;
  return (
    <Card title="Competitivo" testid="hub-competitive" link={{ href: "/competitivo", label: "Ir a competitivo" }}>
      {r && r.gamesPlayed > 0 ? (
        <>
          <p className="font-display text-[26px] font-extrabold leading-none text-white">{fmt(r.rating)}<span className="text-[12px] text-white/50"> rating</span></p>
          <p className="mt-1 text-[12px] text-white/60">
            {snap.ladder?.position ? `Puesto ${snap.ladder.position} de ${snap.ladder.rankedTotal}` : "Sin puesto todavía"} · {r.gamesPlayed} partidas{r.provisional ? " · provisional" : ""}
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-white/60">Aún no has jugado ranked. El rating es un progreso aparte: no depende de tu nivel de cuenta.</p>
      )}
    </Card>
  );
}

function Recent({ snap }: { snap: MetaSnapshot }) {
  const rows = snap.rewards.slice(0, 4);
  return (
    <Card title="Recibido hace poco" testid="hub-recent" link={{ href: "/recompensas", label: "Historial" }}>
      {rows.length === 0 ? <p className="text-[12px] text-white/55">Aún no has recibido recompensas.</p> : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 truncate text-white/80">{r.label}</span>
              <RewardDisplay reward={{ credits: r.credits || undefined, packId: r.pack?.packId, packCount: r.pack?.count }} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SectionHead({ id, kicker, title, link }: { id: string; kicker: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <span className="nx-label !text-[10px] text-white/50">{kicker}</span>
        <h2 id={id} className="font-display text-[20px] font-extrabold uppercase tracking-[0.04em] text-white">{title}</h2>
      </div>
      {link && <Link href={link.href} className="nx-action text-[12px]">{link.label} →</Link>}
    </div>
  );
}
