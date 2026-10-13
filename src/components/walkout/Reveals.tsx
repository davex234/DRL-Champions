"use client";

/**
 * PACK WALKOUT · LAS PIEZAS DEL REVEAL (DOM sobre el escenario): sobre, bandera, rol, equipo, edición, OVR, nombre y carta.
 *
 * Cada pieza entra en el centro del escenario con su gesto (la bandera CAE con peso, el escudo del equipo entra en
 * diagonal y golpea, el rol sube, la media cuenta) y, cuando entra la siguiente, se retira a su sitio en el carril
 * lateral (escritorio) o en la fila superior (móvil): al final se ve todo lo revelado alrededor de la carta.
 * Todo es función del fotograma: el mismo instante se ve igual, SALTAR es el fotograma final. Son DOM: el texto final
 * (nombre, media, equipo, rol) es legible por lectores de pantalla y por la QA.
 */
import { memo, useMemo, type ReactNode } from "react";
import { clamp01, easeInOutCubic, easeOutCubic, heavyDrop, type WalkoutFrame } from "@/domain/walkout/timeline";
import type { EditionPreset, WalkoutInput } from "@/domain/walkout/input";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { Card3D } from "@/components/visual/Card3D";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("walkout");

export type WalkoutLayout = { tall: boolean; w: number; h: number };
type Pt = { x: number; y: number };

/** Donde ENTRA cada pieza: por encima de la persona que camina (no encima de ella). */
const CENTER = (l: WalkoutLayout): Pt => (l.tall ? { x: 50, y: 30 } : { x: 50, y: 31 });
/**
 * Con la persona en escena (0.2) las pistas entran A SU LADO, no sobre ella: en escritorio a su izquierda (camino del
 * carril), en móvil por encima de su cabeza (camino de la fila superior).
 */
const ENTRY = (l: WalkoutLayout, walk: boolean, slot: "flag" | "role" | "team"): Pt =>
  !walk ? CENTER(l) : l.tall ? { x: 50, y: 19 } : { x: slot === "role" ? 24 : 29, y: { flag: 30, role: 50, team: 64 }[slot] };
/** Con la persona en escena, el rol (palabras largas: «CONTROLADOR») entra más pequeño para no tapar ni a ella ni a la bandera. */
const roleBig = (l: WalkoutLayout, walk: boolean) => (walk && !l.tall ? 0.62 : 1);
/** Con la persona en escena (0.2) la media entra A SU LADO, no sobre su cara. */
const BESIDE = (l: WalkoutLayout): Pt => (l.tall ? { x: 50, y: 29 } : { x: 76, y: 40 });
export const SLOTS = (l: WalkoutLayout): Record<"flag" | "role" | "team" | "ovr" | "edition" | "name" | "card", Pt> => l.tall
  ? { flag: { x: 17, y: 8 }, role: { x: 50, y: 8 }, team: { x: 83, y: 8 }, edition: { x: 50, y: 15 }, ovr: { x: 50, y: 40 }, card: { x: 50, y: 50 }, name: { x: 50, y: 85 } }
  : { flag: { x: 12, y: 27 }, role: { x: 12, y: 50 }, team: { x: 12, y: 73 }, edition: { x: 50, y: 8 }, ovr: { x: 88, y: 46 }, card: { x: 50, y: 47 }, name: { x: 50, y: 89 } };

export const cardScale = (l: WalkoutLayout) => Math.max(0.5, Math.min(l.tall ? 1 : 1.12, (l.w - 48) / 300, (l.h * (l.tall ? 0.52 : 0.6)) / 420));

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Rótulo secundario: crece mientras la pieza se retira al carril, para seguir legible (≈ 13 px) ya reducida. */
const DOCK_LABEL = "calc(18px + 14px * var(--dock, 0))";

type Gesture = "drop" | "diagonal" | "rise" | "fade";

/** Una pieza: entra en `from` con su gesto y se retira a `to` mientras `dock` avanza. */
function Piece({ enter, dock = 0, from, to, big, small, gesture, reduced, children, testId, z = 20 }: {
  enter: number; dock?: number; from: Pt; to: Pt; big: number; small: number; gesture: Gesture; reduced: boolean;
  children: ReactNode; testId: string; z?: number;
}) {
  if (enter <= 0) return null;
  // Se retira en la primera mitad de la entrada siguiente: nunca dos piezas grandes a la vez en el centro.
  const d = easeInOutCubic(Math.min(1, dock * 2));
  const g: Gesture = reduced ? "fade" : gesture;
  let dx = 0, dy = 0, opacity = 1, extra = 1;
  if (g === "drop") { dy = heavyDrop(enter) * -70; opacity = Math.min(1, enter * 5); }
  else if (g === "diagonal") { const o = heavyDrop(enter, 0.05); dx = o * 45; dy = o * -65; opacity = Math.min(1, enter * 5); extra = 1 + Math.max(0, o) * 0.5; }
  else if (g === "rise") { dy = (1 - easeOutCubic(enter)) * 8; opacity = easeOutCubic(enter); }
  else opacity = easeOutCubic(enter);
  const x = lerp(from.x, to.x, d), y = lerp(from.y, to.y, d);
  const s = lerp(big, small, d) * extra;
  return (
    <div data-testid={testId} className="pointer-events-none absolute" style={{
      left: `${x}%`, top: `${y}%`, zIndex: z, opacity, ["--dock" as string]: d,
      transform: `translate(-50%, -50%) translate(${dx}vw, ${dy}vh) scale(${s})`,
    }}>{children}</div>
  );
}

/** Reacción de luz bajo una pieza al aterrizar (sin rebote: un destello que se apaga). */
const impactGlow = (enter: number, at = 0.55) => (enter > at && enter < 1 ? Math.sin(((enter - at) / (1 - at)) * Math.PI) : 0);

export function PackPiece({ frame, art, preset }: { frame: WalkoutFrame; art: string | null; preset: EditionPreset }) {
  const p = frame.p.pack ?? 0, o = frame.p.open ?? 0, b = frame.p.blackout ?? 0;
  if (p <= 0 || b >= 1) return null;
  const split = easeInOutCubic(o) * 34;
  const half = (top: boolean) => (
    <div className="absolute inset-0" style={{ clipPath: top ? "inset(0 0 52% 0)" : "inset(48% 0 0 0)", transform: `translateY(${top ? -split : split}%) rotate(${top ? -o * 4 : o * 3}deg)` }}>
      {art
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={art} alt="" className="h-full w-full object-contain" draggable={false} />
        : <div className="h-full w-full rounded-xl" style={{ background: `linear-gradient(160deg, #1a1f2e, #07080d)`, border: `1px solid ${preset.light}` }} />}
    </div>
  );
  return (
    <div data-testid="walkout-pack" className="pointer-events-none absolute left-1/2 top-[46%] z-30 aspect-[5/7] h-[52%] max-h-[460px]"
      style={{ transform: `translate(-50%, -50%) translateY(${(1 - easeOutCubic(p)) * 6}vh) scale(${0.9 + easeOutCubic(p) * 0.1})`, opacity: easeOutCubic(p) * (1 - easeInOutCubic(b)) }}>
      {half(true)}{half(false)}
      {/* la ranura de luz al abrirse */}
      <div className="absolute inset-x-[-30%] top-1/2 h-[3px] -translate-y-1/2" style={{ background: `linear-gradient(90deg, transparent, #fff, ${preset.accent}, #fff, transparent)`, opacity: Math.sin(clamp01(o) * Math.PI), boxShadow: `0 0 40px 12px ${preset.accent}` }} />
    </div>
  );
}

export function FlagPiece({ frame, input, layout, reduced, failed, walk = false }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; failed: boolean; walk?: boolean }) {
  useLocale();
  const e = frame.p.flag ?? 0;
  const glow = reduced ? 0 : impactGlow(e);
  const w = layout.tall ? 190 : 250;
  const showFlag = input.flag && !failed;
  return (
    <Piece testId="walkout-flag" enter={e} dock={frame.p.role ?? frame.p.edition ?? 0} from={ENTRY(layout, walk, "flag")} to={SLOTS(layout).flag} big={1} small={layout.tall ? 0.36 : 0.42} gesture="drop" reduced={reduced}>
      <div className="relative" style={{ width: w }}>
        <div className="absolute -inset-10 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.55), transparent)", opacity: glow }} />
        {showFlag
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={input.flag!.src} alt={t("Bandera: {name}", { name: input.flag!.name })} className="relative block w-full rounded-[6px]" style={{ aspectRatio: "4/3", objectFit: "cover", boxShadow: "0 18px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.18)" }} draggable={false} />
          : <div className="relative flex aspect-[4/3] w-full items-center justify-center rounded-[6px] border border-white/25 bg-white/5 font-display text-4xl font-black uppercase tracking-[0.12em] text-white" aria-label={t("Región: {v}", { v: td(input.region) ?? t("sin región") })}>{td(input.region) ?? "—"}</div>}
        <p className="mt-3 text-center font-display font-bold uppercase tracking-[0.3em] text-white/80" style={{ fontSize: DOCK_LABEL }}>{showFlag ? input.flag!.name : t("Región")}</p>
      </div>
    </Piece>
  );
}

export function RolePiece({ frame, input, layout, reduced, accent, walk = false }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; accent: string; walk?: boolean }) {
  const e = frame.p.role ?? 0;
  const tracking = reduced ? 0.12 : lerp(0.6, 0.12, easeOutCubic(e));
  return (
    <Piece testId="walkout-role" enter={e} dock={frame.p.team ?? frame.p.edition ?? 0} from={ENTRY(layout, walk, "role")} to={SLOTS(layout).role} big={roleBig(layout, walk)} small={layout.tall ? 0.34 : 0.4} gesture="rise" reduced={reduced}>
      <div className="text-center">
        <p className="font-display font-black uppercase leading-none text-white" style={{ fontSize: layout.tall ? 54 : 96, letterSpacing: `${tracking}em`, textShadow: `0 0 30px ${accent}88` }}>{td(input.role)}</p>
        <p className="mt-3 inline-block rounded-sm border px-3 py-1 font-display font-bold tracking-[0.3em] text-white" style={{ borderColor: accent, fontSize: DOCK_LABEL }}>{td(input.roleAbbr)}</p>
      </div>
    </Piece>
  );
}

export function TeamPiece({ frame, input, layout, reduced, failed, walk = false, retreat = 0 }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; failed: boolean; walk?: boolean; /** 0..1: con la persona en escena, el escudo se retira al carril tras el impacto. */ retreat?: number }) {
  useLocale();
  const e = frame.p.team ?? 0;
  const glow = reduced ? 0 : impactGlow(e);
  const size = layout.tall ? 200 : 270;
  const logo = input.team.logoSrc && !failed ? input.team.logoSrc : null;
  return (
    <Piece testId="walkout-team" enter={e} dock={Math.max(frame.p.edition ?? 0, retreat / 2)} from={ENTRY(layout, walk, "team")} to={SLOTS(layout).team} big={1} small={layout.tall ? 0.34 : 0.4} gesture="diagonal" reduced={reduced}>
      <div className="relative flex flex-col items-center" style={{ width: size }}>
        <div className="absolute -inset-16 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.7), transparent)", opacity: glow }} />
        {logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logo} alt={t("Equipo: {name}", { name: input.team.name })} className="relative block w-full object-contain" style={{ height: size, filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.7))" }} draggable={false} />
          : <div className="relative flex w-full items-center justify-center rounded-full border-2 border-white/40 bg-white/5 font-display font-black uppercase text-white" style={{ height: size, fontSize: size / Math.max(4, input.team.tag.length + 1.5) }} aria-label={t("Equipo: {name}", { name: input.team.name })}>{input.team.tag}</div>}
        {(logo || input.team.name !== input.team.tag) && <p className="relative mt-2 whitespace-nowrap text-center font-display font-bold uppercase tracking-[0.25em] text-white/85" style={{ fontSize: DOCK_LABEL }}>{input.team.name}</p>}
      </div>
    </Piece>
  );
}

const TREATMENT: Record<EditionPreset["accentTreatment"], (p: EditionPreset) => string> = {
  plain: (p) => `linear-gradient(180deg, #ffffff, ${p.accent})`,
  metal: (p) => `linear-gradient(180deg, #ffffff 0%, ${p.accent} 45%, ${p.light} 55%, #ffffff 100%)`,
  prism: (p) => `linear-gradient(90deg, ${p.light}, #ffffff, ${p.accent}, #ff9be0, ${p.light})`,
  gold: () => "linear-gradient(180deg, #fff6cf 0%, #ffd36b 45%, #b8862b 60%, #fff0b8 100%)",
};

export function EditionPiece({ frame, input, layout, reduced, preset }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; preset: EditionPreset }) {
  useLocale();
  const e = frame.p.edition ?? 0;
  const sweep = reduced ? 1 : easeInOutCubic(e);
  return (
    <Piece testId="walkout-edition" enter={e} from={SLOTS(layout).edition} to={SLOTS(layout).edition} big={1} small={1} gesture="fade" reduced={reduced} z={25}>
      <div className="relative text-center">
        <div className="mx-auto h-px" style={{ width: `${sweep * (layout.tall ? 260 : 520)}px`, background: `linear-gradient(90deg, transparent, ${preset.accent}, transparent)` }} />
        <p className="my-1.5 whitespace-nowrap bg-clip-text font-display font-black uppercase text-transparent" style={{ backgroundImage: TREATMENT[preset.accentTreatment](preset), fontSize: layout.tall ? 22 : 34, letterSpacing: "0.32em", filter: "drop-shadow(0 1px 5px rgba(0,0,0,0.85))" }}>{td(input.edition.label)}</p>
        <div className="mx-auto h-px" style={{ width: `${sweep * (layout.tall ? 260 : 520)}px`, background: `linear-gradient(90deg, transparent, ${preset.accent}, transparent)` }} />
      </div>
    </Piece>
  );
}

/** La MEDIA: primero el primer dígito (pausa), después el número entero de golpe. Mucho peso visual. */
export function RatingPiece({ frame, input, layout, reduced, preset, walk = false }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; preset: EditionPreset; walk?: boolean }) {
  useLocale();
  const first = frame.p.ovrFirst ?? 0, full = frame.p.ovrFull ?? 0;
  const s = String(input.ovr);
  const shown = full > 0 ? s : s.slice(0, 1);
  const punch = reduced || full <= 0 ? 1 : 1 + (1 - easeOutCubic(full)) * 0.28;
  const dock = layout.tall ? 0 : Math.max(frame.p.flash ?? 0, frame.p.name ?? 0);
  // En móvil la carta ya lleva la media: el número grande cede el centro a la carta.
  const fadeOut = layout.tall ? easeInOutCubic(frame.p.card ?? 0) : 0;
  return (
    <Piece testId="walkout-ovr" enter={first} dock={dock} from={walk ? BESIDE(layout) : CENTER(layout)} to={SLOTS(layout).ovr} big={walk && layout.tall ? 0.8 : 1} small={0.42} gesture="rise" reduced={reduced} z={26}>
      <div className="text-center" style={{ opacity: 1 - fadeOut }}>
        <p className="font-display font-black leading-[0.85] text-white tabular-nums" style={{ fontSize: layout.tall ? 190 : 300, transform: `scale(${punch})`, textShadow: `0 0 60px ${preset.light}, 0 0 140px ${preset.light}88` }} aria-label={t("Media {ovr}", { ovr: input.ovr })}>{td(shown)}</p>
        <p className="mt-1 font-display font-bold uppercase tracking-[0.5em] text-white/70" style={{ fontSize: DOCK_LABEL }}>{t("Media")}</p>
      </div>
    </Piece>
  );
}

export function NamePiece({ frame, input, layout, reduced }: { frame: WalkoutFrame; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean }) {
  const e = frame.p.name ?? 0;
  const tracking = reduced ? 0.06 : lerp(0.5, 0.06, easeOutCubic(e));
  return (
    <Piece testId="walkout-name" enter={e} from={SLOTS(layout).name} to={SLOTS(layout).name} big={1} small={1} gesture="rise" reduced={reduced} z={40}>
      <h2 className="whitespace-nowrap text-center font-display font-black uppercase leading-none text-white" style={{ fontSize: layout.tall ? 46 : 72, letterSpacing: `${tracking}em`, textShadow: "0 6px 30px rgba(0,0,0,0.8)" }}>{input.playerName}</h2>
    </Piece>
  );
}

/** La carta CANÓNICA (Card3D → CardVisual → PlayerCard → CardArt): sale de la luz donde estaba la persona. */
export const CardPiece = memo(function CardPiece({ enter, input, layout, reduced, preset }: { enter: number; input: WalkoutInput; layout: WalkoutLayout; reduced: boolean; preset: EditionPreset }) {
  useLocale();
  const card = useMemo(() => (
    <Card3D mode="static" glow={preset.light} className="w-[300px]">
      <CardVisual alt={t("Carta de {playerName}", { playerName: input.playerName })} chamfer="18px" className="w-[300px]">
        <PlayerCard card={input.card} size="lg" interactive={false} />
      </CardVisual>
    </Card3D>
  ), [input.card, input.playerName, preset.light]);
  if (enter <= 0) return null;
  const k = easeOutCubic(enter);
  const bright = reduced ? 1 : lerp(3.2, 1, k);
  const at = SLOTS(layout).card;
  return (
    <div data-testid="walkout-card" className="pointer-events-none absolute z-30" style={{
      left: `${at.x}%`, top: `${at.y}%`, opacity: reduced ? k : Math.min(1, enter * 2.5),
      transform: `translate(-50%, -50%) translateY(${reduced ? 0 : (1 - k) * 6}vh) scale(${cardScale(layout) * (reduced ? 1 : lerp(0.88, 1, k))})`,
      filter: bright !== 1 ? `brightness(${bright}) blur(${reduced ? 0 : (1 - k) * 3}px)` : undefined,
    }}>{card}</div>
  );
});

/** Resumen accesible del estado final (lectores de pantalla y QA): nombre, media, equipo, rol, edición y país. */
export function WalkoutSummary({ input }: { input: WalkoutInput }) {
  useLocale();
  return (
    <section className="sr-only" aria-live="polite" data-testid="walkout-summary">
      <h2>{input.playerName}</h2>
      <p>{t("Media")} {input.ovr}</p>
      <p>{t("Equipo")} {input.team.name}</p>
      <p>{t("Rol")} {td(input.role)}</p>
      <p>{t("Edición")} {td(input.edition.label)}</p>
      {input.flag && <p>{t("País")} {input.flag.name}</p>}
    </section>
  );
}
