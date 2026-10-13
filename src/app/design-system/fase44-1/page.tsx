"use client";

/**
 * ARNÉS QA · FASE 44.1 — `/design-system/fase44-1?scene=<escena>` · IMMERSION, WORLD, AUDIO & INPUT (solo revisión).
 *
 * Sin escena: índice por secciones. Con escena: el mundo de la escena detrás (GameEnvironment real) y las piezas reales
 * de la fase con datos QA SYNTHETIC. La música y los efectos solo suenan tras pulsar algo (política de autoplay). Nada
 * se escribe ni se envía.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { GameEnvironment } from "@/components/visual/GameEnvironment";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { focusEnvironment } from "@/components/dailyLoop/LobbyPlayStage";
import { CollectionHero } from "@/components/collectionRoom/CollectionHero";
import { ShopHero } from "@/components/shop/ShopHero";
import { AudioSettingsPanel } from "@/components/ui/game/AudioSettingsPanel";
import { GameModal, GameSheet } from "@/components/ui/game/GameOverlay";
import { NxButton } from "@/components/ui/NxButton";
import { ENVIRONMENTS, dimEnvironment, type EnvironmentFocus } from "@/design/environment";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { SCENES as LOBBY } from "@/app/design-system/fase36/fixtures";
import { CARDS, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import { buildCollectionSnapshot, rarityOf } from "@/domain/collection/room";
import { SOUND_EVENTS, playSound, type SoundEvent } from "@/lib/sound";
import { crossfadeMs, MUSIC_CONTEXTS, MUSIC_THEMES, type MusicContext } from "@/lib/audio/music";
import { duckMusic, musicDebug, pushMusicOverride, setMusicRoute, unlockMusic } from "@/lib/audio/musicEngine";
import { scrollLockCount } from "@/lib/gameExperience/scrollLock";
import { FASE441_SCENES, SECTIONS_441, type Fase441Scene } from "./fixtures";

const noop = () => {};

export default function Fase441QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  if (scene === null) return null;
  if (!scene) return <Index />;
  const s = FASE441_SCENES.find((x) => x.id === scene);
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE441_SCENES.map((x) => x.id).join(", ")}</p>;
  return (
    <div className="space-y-4" data-scene={s.id} data-section={s.section} data-world={s.world}>
      <GameEnvironment variant={s.world} />
      <p className="nx-clip-sm inline-block border border-drl-gold/30 bg-black/40 px-3 py-1.5 text-[12px] text-drl-gold/90" data-synthetic="true">
        QA SYNTHETIC · {s.section} · {s.note}
      </p>
      <Scene s={s} />
    </div>
  );
}

function Index() {
  return (
    <div className="space-y-6" data-testid="fase44-1-index">
      <header>
        <p className="nx-label text-drl">Arnés QA · Fase 44.1</p>
        <h1 className="font-display text-[44px] font-bold uppercase leading-none text-white">Immersion, World, Audio &amp; Input</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/60">Mundos detrás de la interfaz, bóveda, cámara de sobres, música original procedural, efectos y scroll.</p>
      </header>
      {SECTIONS_441.map((sec) => (
        <section key={sec} aria-labelledby={`sec-${sec}`}>
          <h2 id={`sec-${sec}`} className="nx-label mb-2">{sec}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FASE441_SCENES.filter((s) => s.section === sec).map((s) => (
              <li key={s.id}>
                <Link href={`/design-system/fase44-1?scene=${s.id}`} className="nx-clip-sm block min-h-[56px] border border-white/10 bg-black/30 px-3 py-2 hover:border-white/30">
                  <b className="block font-display text-[15px] uppercase text-white">{s.id}</b>
                  <span className="block text-[12.5px] text-white/55">{s.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Scene({ s }: { s: Fase441Scene }) {
  if (s.section === "AMBIENT WORLDS" || ["loadout", "campaign", "draft", "ranked", "season"].includes(s.id)) return <WorldCard s={s} />;
  if (s.id === "lobby") return <Lobby />;
  if (s.id.startsWith("lobby-focus-")) return <Lobby focus={s.id.replace("lobby-focus-", "") as Exclude<EnvironmentFocus, null>} />;
  if (s.id.startsWith("vault-")) return <Vault rarity={s.id.replace("vault-", "")} />;
  if (s.id === "chamber") return <Chamber dim={false} />;
  if (s.id === "chamber-dim") return <Chamber dim />;
  if (s.id === "music") return <MusicLab />;
  if (s.id === "sfx") return <SfxLab />;
  if (s.id === "scroll") return <ScrollLab />;
  if (s.id === "reduced") return <WorldCard s={s} reducedNote />;
  return null;
}

/* ───────────── mundos ───────────── */

function WorldCard({ s, reducedNote = false }: { s: Fase441Scene; reducedNote?: boolean }) {
  const spec = ENVIRONMENTS[s.world];
  return (
    <div className="flex min-h-[72vh] items-end" data-testid="world-card">
      <div className="nx-clip-sm max-w-md border border-white/10 bg-black/45 px-5 py-4 backdrop-blur-sm">
        <p className="nx-label">{spec.place}</p>
        <p className="mt-1 font-display text-[28px] font-bold uppercase leading-none text-white">{spec.variant}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-white/70">
          <dt>Arquitectura</dt><dd>{spec.architecture}</dd>
          <dt>Movimiento</dt><dd>{spec.motion.join(" · ")}</dd>
          <dt>Parallax</dt><dd>{spec.parallax} px</dd>
          <dt>Partículas</dt><dd>≤ {spec.particles}</dd>
          <dt>Atenuado</dt><dd>{spec.dim}</dd>
        </dl>
        {reducedNote && <p className="mt-3 text-[13px] text-warn">Con «reducir movimiento»: sin deriva, barrido, parallax ni partículas en movimiento.</p>}
      </div>
    </div>
  );
}

/* ───────────── lobby ───────────── */

function Lobby({ focus }: { focus?: Exclude<EnvironmentFocus, null> }) {
  const snap = useMemo(() => buildDailyLoop(LOBBY.claim.facts!), []);
  useEffect(() => {
    if (!focus) return;
    const id = window.setTimeout(() => focusEnvironment(focus), 50);
    return () => { window.clearTimeout(id); focusEnvironment(null); };
  }, [focus]);
  return <DailyLobby snap={snap} now={LOBBY.claim.facts!.now} />;
}

/* ───────────── bóveda ───────────── */

function Vault({ rarity }: { rarity: string }) {
  const { def, snap } = useMemo(() => {
    const d = CARDS.filter((c) => rarityOf(c) === rarity).sort((a, b) => b.ovr - a.ovr)[0] ?? CARDS[0];
    const serial = getVariant(d.variantId).serialized ? 7 : null;
    const sn = buildCollectionSnapshot(CARDS, getPlayer, {
      instances: [{ uid: "qa-1", cardId: d.id, serial, mintedVersion: 1 }, ...CARDS.slice(0, 40).map((c, i) => ({ uid: `qa-f${i}`, cardId: c.id, serial: null, mintedVersion: 1 }))],
      favorites: [], showcaseUids: [], decks: [],
    });
    return { def: d, snap: sn };
  }, [rarity]);
  const best = snap.best ? CARDS.find((c) => c.id === snap.best!.cardId) ?? def : def;
  return <CollectionHero snap={snap} bestDef={best} mode="server" />;
}

/* ───────────── cámara ───────────── */

function Chamber({ dim }: { dim: boolean }) {
  const pack = getPack("premium") ?? getPack("standard");
  useEffect(() => {
    if (!dim) return;
    const id = window.setTimeout(() => dimEnvironment(0.7), 50);
    return () => { window.clearTimeout(id); dimEnvironment(0); };
  }, [dim]);
  if (!pack) return null;
  return <ShopHero pack={pack} owned={1} credits={6410} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />;
}

/* ───────────── música ───────────── */

function MusicLab() {
  const [snap, setSnap] = useState(() => musicDebug());
  const [override, setOverride] = useState<(() => void) | null>(null);
  const [duck, setDuck] = useState<(() => void) | null>(null);
  useEffect(() => { const id = window.setInterval(() => setSnap(musicDebug()), 400); return () => window.clearInterval(id); }, []);
  const pick = (c: MusicContext) => { unlockMusic(); setMusicRoute(c); };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]" data-testid="music-lab">
      <section className="nx-clip border border-white/10 bg-black/45 p-5">
        <p className="nx-label">Contextos · pulsa para oír (el primer toque desbloquea el audio)</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MUSIC_CONTEXTS.map((c) => (
            <button key={c} type="button" onClick={() => pick(c)} data-music-context={c} aria-pressed={snap.plan.context === c}
              className="nx-clip-sm min-h-[64px] border border-white/15 bg-white/[0.04] px-3 py-2 text-left hover:border-white/40 aria-pressed:border-drl-cyan aria-pressed:bg-drl-cyan/10">
              <b className="block font-display text-[15px] uppercase text-white">{c}</b>
              <span className="block text-[11.5px] text-white/55">{MUSIC_THEMES[c].bpm} bpm · {MUSIC_THEMES[c].mood}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <NxButton size="md" variant={duck ? "primary" : "secondary"} onClick={() => { if (duck) { duck(); setDuck(null); } else { unlockMusic(); setDuck(() => duckMusic()); } }} data-testid="music-duck">{duck ? "Soltar duck" : "Duck (sobre)"}</NxButton>
          <NxButton size="md" variant={override ? "primary" : "secondary"} onClick={() => { if (override) { override(); setOverride(null); } else { unlockMusic(); setOverride(() => pushMusicOverride("RESULT")); } }} data-testid="music-override">{override ? "Quitar RESULT" : "Forzar RESULT"}</NxButton>
          <NxButton size="md" variant="secondary" onClick={() => { unlockMusic(); setMusicRoute(null); }}>Silencio de sala</NxButton>
        </div>
        <p className="mt-4 text-[12.5px] text-white/50">Fundidos: LOBBY→COLLECTION {crossfadeMs("LOBBY", "COLLECTION")} ms · LOBBY→MATCH {crossfadeMs("LOBBY", "MATCH")} ms · MATCH→RESULT {crossfadeMs("MATCH", "RESULT")} ms. Música original generada en el navegador; sin ficheros ni pistas de terceros.</p>
      </section>
      <section className="nx-clip border border-white/10 bg-black/45 p-5 font-mono text-[12px] text-white/75" data-testid="music-state">
        <p className="nx-label mb-2">Estado del motor</p>
        <pre className="whitespace-pre-wrap">{JSON.stringify(snap, null, 2)}</pre>
      </section>
    </div>
  );
}

/* ───────────── efectos ───────────── */

function SfxLab() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]" data-testid="sfx-lab">
      <section className="nx-clip border border-white/10 bg-black/45 p-5">
        <p className="nx-label">Catálogo de efectos (los de paso limitados a uno cada 90 ms)</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(SOUND_EVENTS) as SoundEvent[]).map((k) => (
            <button key={k} type="button" data-sfx={k} onClick={() => { unlockMusic(); playSound(k); }} onMouseEnter={() => SOUND_EVENTS[k].hover && playSound(k)}
              className="nx-clip-sm min-h-[52px] border border-white/15 bg-white/[0.04] px-3 py-2 text-left hover:border-white/40">
              <b className="block font-display text-[14px] text-white">{k}</b>
              <span className="block text-[11px] text-white/50">nivel {SOUND_EVENTS[k].level}{SOUND_EVENTS[k].hover ? " · paso" : ""}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="nx-clip border border-white/10 bg-black/45 p-5"><AudioSettingsPanel /></section>
    </div>
  );
}

/* ───────────── scroll ───────────── */

function ScrollLab() {
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);
  const [locks, setLocks] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setLocks(scrollLockCount()), 200); return () => window.clearInterval(id); }, []);
  return (
    <div data-testid="scroll-lab">
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 bg-black/60 p-3 backdrop-blur">
        <NxButton size="md" onClick={() => setSheet(true)} data-testid="scroll-open-sheet">Abrir hoja</NxButton>
        <NxButton size="md" variant="secondary" onClick={() => setModal(true)} data-testid="scroll-open-modal">Abrir diálogo</NxButton>
        <span className="nx-readout text-[14px] text-white/75" data-testid="scroll-locks" data-locks={locks}>Cerrojos activos: {locks}</span>
      </div>
      {Array.from({ length: 40 }, (_, i) => (
        <p key={i} className="nx-clip-sm my-3 border border-white/10 bg-black/35 px-4 py-6 text-white/70" data-row={i}>Fila {i + 1} · la rueda, el teclado y el trackpad tienen que mover esta página.</p>
      ))}
      <GameSheet open={sheet} onClose={() => setSheet(false)} title="Hoja de prueba" eyebrow="Scroll">
        <p className="text-white/70">Mientras está abierta, la página de detrás no se desplaza. Al cerrar, vuelve.</p>
        <NxButton size="md" className="mt-3" onClick={() => setModal(true)}>Abrir diálogo encima</NxButton>
      </GameSheet>
      <GameModal open={modal} onClose={() => setModal(false)} title="Diálogo de prueba" actions={<NxButton size="md" onClick={() => setModal(false)} data-testid="scroll-close-modal">Cerrar</NxButton>}>
        <p className="text-white/70">Diálogo anidado: el scroll vuelve solo al cerrar el último.</p>
      </GameModal>
    </div>
  );
}
