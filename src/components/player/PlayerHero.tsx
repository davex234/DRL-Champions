"use client";

/**
 * HERO DEL PERFIL — F89 PROFILE 2.0 (sobre la tarjeta de la Fase 31/56).
 *
 * Abre el perfil con la IDENTIDAD entera en una pieza: avatar con su marco equipado, nombre, título y banderín
 * (cosméticos reales), EQUIPO FAVORITO (equipo esports real con su logo del producto), «miembro desde» (solo el mes),
 * nivel de cuenta, el RANGO COMPETITIVO de F84 (emblema + rango + división + rating + puesto del Top; en colocación X / N), las
 * INSIGNIAS destacadas de F82 a tamaño de trofeo y, en escritorio, las CARTAS DESTACADAS en abanico (CardArt real: el
 * asset ES la carta, sin marco ni caja alrededor).
 *
 * Lo propio (SELF) y lo ajeno (PUBLIC) ya vienen distintos del servidor; aquí solo cambia qué acciones se ofrecen.
 */
import { useState } from "react";
import Link from "next/link";
import { Stage } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { CardArt } from "@/components/cards/CardArt";
import { CardViewer } from "@/components/cards/CardViewer";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import { getCard } from "@/data/catalog";
import type { PlayerIdentitySnapshot, ShowcaseSlot } from "@/domain/profile/identity";
import { PlayerAvatar, ProfileButton, fmtMonth, serialText, TeamMark } from "./bits";
import { CompetitiveEmblem } from "@/components/competitive/ranked/CompetitiveEmblem";

export interface PlayerHeroProps {
  snap: PlayerIdentitySnapshot;
  onEdit?: () => void;
  onShare?: () => void;
  /** F89 · abrir el editor en una pestaña concreta (insignias, equipo). Solo en el perfil propio. */
  onEditTab?: (tab: "badges" | "team") => void;
  onCardView?: (s: ShowcaseSlot) => void;
  /** Acciones sociales reales (Fase 29): se montan solo para perfiles ajenos. */
  social?: React.ReactNode;
}

export function PlayerHero({ snap, onEdit, onShare, onEditTab, onCardView, social }: PlayerHeroProps) {
  const { player, ranked, self } = snap;
  // F84 · el rango de la temporada competitiva (servidor): emblema + rango + división; puesto solo si está en el Top.
  const comp = snap.competitive;
  const accent = snap.accent.color;
  const team = snap.favoriteTeam;
  const hasFan = snap.showcase.length > 0;
  return (
    <Stage grid className="relative overflow-hidden p-5 sm:p-8 lg:p-10" data-testid="player-hero" data-view={snap.view}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(720px 360px at 8% 0%, ${accent}38, transparent 70%), radial-gradient(560px 300px at 100% 100%, ${accent}24, transparent 70%), linear-gradient(115deg, transparent 55%, rgba(255,255,255,0.03) 55.2%, transparent 62%)` }} />
      <div className={`grid items-center gap-8 ${hasFan ? "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px]" : ""}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="nx-label">{snap.view === "SELF" ? "Tu perfil de jugador" : "Perfil de jugador"}</span>
            {player.banner && (
              <span className="nx-clip-sm px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]" style={{ background: `${player.banner.color}22`, color: player.banner.color }}>⬢ {player.banner.label}</span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-4 sm:gap-6">
            <PlayerAvatar avatar={player.avatar} username={player.username} frame={player.frame} />
            <div className="min-w-0 flex-1">
              <h1 className="line-clamp-2 break-words font-display text-[clamp(26px,5.5vw,58px)] font-bold uppercase leading-[0.95] text-white [overflow-wrap:anywhere]" data-field="player-name">{player.username}</h1>
              {player.title && <p className="mt-1 font-display text-[13px] font-bold uppercase tracking-[0.12em]" style={{ color: player.title.color }}>{player.title.label}</p>}
              <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Identidad" data-testid="hero-identity">
                {team && <li data-testid="favorite-team" data-team={team.id}><TeamMark team={team} /></li>}
                <li><Badge tone="info" data-level={player.level}>Nivel {player.level}</Badge></li>
                {snap.memberSince !== null && <li className="text-[12px] text-white/55" data-testid="member-since">Miembro desde {fmtMonth(snap.memberSince)}</li>}
                {snap.seasonTrack && <li data-testid="season-level-chip"><Badge tone="gold" data-season-level={snap.seasonTrack.level}>{snap.seasonTrack.name.split(" · ")[0]} · nivel {snap.seasonTrack.level}</Badge></li>}
                {ranked?.provisional && <li><Badge tone="warn" dot>Ranked provisional</Badge></li>}
              </ul>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:gap-8 items-center" data-testid="hero-ranked" data-rank-state={comp?.state ?? "none"} data-tier={comp?.rank?.tierId}>
            {comp && (
              <CompetitiveEmblem rank={comp.rank} state={comp.state} placement={comp.placement} size="sm" position={ranked?.position ?? null} animate={false} className="row-span-2 sm:row-span-1" />
            )}
            {comp && (
              <Readout size="md" label="Rango" value={comp.state === "RANKED" && comp.rank ? comp.rank.label : comp.state === "PLACEMENT" ? `Colocación ${comp.placement.played}/${comp.placement.total}` : "Sin clasificar"}
                tone={comp.rank?.color ?? "var(--nx-gold)"} />
            )}
            <Readout size="md" label="Rating" value={ranked ? ranked.rating : comp ? comp.rating : "—"} tone="var(--nx-cyan)" />
            {ranked?.position != null && <Readout size="md" label="Top" value={`#${ranked.position}`} unit={`de ${ranked.rankedTotal}`} />}
            {comp?.peakRank && <Readout size="md" label="Mejor rango · temporada" value={comp.peakRank.label} tone={comp.peakRank.color} />}
          </div>

          <HeroBadges snap={snap} onEditTab={onEditTab} />

          {self && (
            <div className="mt-6 max-w-md" data-testid="hero-xp">
              <div className="flex justify-between gap-3 text-[11px] text-white/50"><span>Nivel de cuenta · progreso al {player.level + 1}</span><span className="tabular-nums">{self.xpIntoLevel} / {self.xpForNext} XP</span></div>
              <Meter value={Math.round(self.progress * 100)} tone="info" height={5} label={`Nivel ${player.level}: ${self.xpIntoLevel} de ${self.xpForNext} XP`} className="mt-1" />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="hero-actions">
            {snap.view === "SELF" ? (
              <>
                <ProfileButton tone="primary" onClick={onEdit} data-action="edit">Editar perfil</ProfileButton>
                <ProfileButton onClick={onShare} data-action="share">Copiar enlace</ProfileButton>
                <Link href="/coleccion/trofeos" data-action="trophy-room" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-gold/40 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-gold transition hover:bg-drl-gold/10">Sala de Trofeos</Link>
                <Link href="/cuenta" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/10 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 transition hover:text-white">Cuenta y ajustes</Link>
                {/* FASE 32 · solo en tu perfil, y solo un enlace: la composición de tus equipos nunca va en la foto del perfil. */}
                <Link href="/duelos/mazos" data-action="edit-team" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/10 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 transition hover:text-white">Editar equipo</Link>
              </>
            ) : (
              <>
                <ProfileButton onClick={onShare} data-action="share">Copiar enlace</ProfileButton>
              </>
            )}
          </div>
          {snap.view !== "SELF" && social && <div className="mt-4" data-testid="hero-social">{social}</div>}
        </div>

        {hasFan && <HeroCardFan slots={snap.showcase} onView={onCardView} />}
      </div>
    </Stage>
  );
}

/**
 * Insignias destacadas (F82) dentro del héroe: son lo primero que se ve de su colección. PUBLIC: solo las elegidas (y
 * poseídas, filtrado en servidor); sin elegidas, nada. SELF sin elegidas: una invitación útil, nunca un hueco triste.
 */
function HeroBadges({ snap, onEditTab }: { snap: PlayerIdentitySnapshot; onEditTab?: (tab: "badges" | "team") => void }) {
  const isSelf = snap.view === "SELF";
  const owned = snap.self?.ownedBadges.length ?? 0;
  if (snap.badges.length > 0) {
    return (
      <div className="mt-6" data-testid="hero-badges" data-count={snap.badges.length}>
        <div className="flex items-center gap-3">
          <span className="nx-label">Insignias</span>
          {isSelf && <button type="button" onClick={() => onEditTab?.("badges")} className="nx-action inline-flex min-h-[44px] items-center" data-action="manage-badges">Gestionar insignias</button>}
        </div>
        <ol className="mt-3 grid grid-cols-3 items-start gap-2 sm:flex sm:flex-wrap sm:gap-8" aria-label="Insignias destacadas">
          {snap.badges.map((b) => <li key={b.id} className="flex min-w-0 justify-center sm:block"><TrophyBadge badge={b} size="md" showLabel className="min-w-0 max-w-full" /></li>)}
        </ol>
      </div>
    );
  }
  if (!isSelf) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 text-[12px] text-white/55" data-testid="hero-badges" data-count={0}>
      <span aria-hidden className="text-drl-gold">◆</span>
      <span>{owned > 0 ? `Tienes ${owned} ${owned === 1 ? "insignia" : "insignias"}: destaca hasta 3 en tu perfil.` : "Completa una colección de equipo para ganar tu primera insignia."}</span>
      {owned > 0 && <button type="button" onClick={() => onEditTab?.("badges")} className="nx-action inline-flex min-h-[44px] items-center" data-action="manage-badges">Equipar insignias</button>}
      {owned === 0 && <Link href="/coleccion/trofeos" className="nx-focus nx-action inline-flex min-h-[44px] items-center">Ver colecciones</Link>}
      {!snap.favoriteTeam && <button type="button" onClick={() => onEditTab?.("team")} className="nx-action inline-flex min-h-[44px] items-center" data-action="choose-team">Elegir equipo favorito</button>}
    </div>
  );
}

/**
 * Abanico de cartas destacadas (escritorio y tableta ancha). CardArt directo: la carta es el asset; la profundidad es
 * `drop-shadow` sobre su silueta. Tocar una carta abre el visor canónico. Sin animación obligatoria: el giro se anula
 * con movimiento reducido y la información (nombre, serie) está en la etiqueta del botón.
 */
function HeroCardFan({ slots, onView }: { slots: ShowcaseSlot[]; onView?: (s: ShowcaseSlot) => void }) {
  const [open, setOpen] = useState<ShowcaseSlot | null>(null);
  const lead = slots[0];
  const sides = slots.slice(1, 3);
  const openDef = open ? getCard(open.cardId) : null;
  const place = ["left-1/2 z-20 w-[62%] -translate-x-1/2", "left-0 top-[9%] z-10 w-[48%] -rotate-[9deg]", "right-0 top-[9%] z-10 w-[48%] rotate-[9deg]"];
  const items = [lead, ...sides];
  return (
    <div className="relative hidden h-[400px] lg:block xl:h-[460px]" data-testid="hero-cards" data-count={slots.length}>
      <span aria-hidden className="absolute inset-x-[12%] bottom-2 h-10 rounded-[50%] bg-black/60 blur-2xl" />
      <ol className="relative h-full" aria-label="Cartas destacadas">
        {items.map((s, i) => {
          const def = getCard(s.cardId);
          return (
            <li key={s.uid} className={`absolute top-0 ${place[i]} transition-transform duration-300 hover:-translate-y-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0`} data-slot={s.slot}>
              <button type="button" className="nx-focus block w-full" onClick={() => { onView?.(s); setOpen(s); }} aria-label={`Ver ${s.nick}, ${s.variantLabel}, ${serialText(s.serial, s.serialLimit)}`}>
                {def?.image
                  ? <CardArt src={def.image} alt={`${s.nick} · ${s.variantLabel}`} shadow="lifted" glow={i === 0 ? s.glow : null} glowSize={18} loading={i === 0 ? "eager" : "lazy"} sizes="280px" />
                  : <span className="grid aspect-[750/1048] place-items-center text-caption text-ink-muted">Carta no disponible</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {open && openDef && <CardViewer card={openDef} serial={open.serial ?? undefined} onClose={() => setOpen(null)} />}
    </div>
  );
}
