"use client";

/**
 * PACK WALKOUT · PROTOTIPO 0.2 (`/design-system/pack-walkout`; 0.2 = persona humana riggeada, ver human3d.ts). 404 en producción (middleware `qaHarnessBlocked`),
 * salvo `NEXUS_QA_HARNESS=1`. Abrir en local: `npm run dev` → http://localhost:3000/design-system/pack-walkout
 *
 * DEMO: cartas REALES del catálogo (las de mayor media de cada edición) convertidas con `walkoutInputFromCard`. Nada de
 * servidor, sobres, probabilidades, economía, inventario ni cuentas: esta página no hace ni una petición de juego.
 * Los ajustes del panel (rol, bandera, equipo, media) cambian SOLO lo que enseñan las piezas; la carta final es la del
 * fixture. La intensidad la elige el panel (no hay regla media → intensidad).
 *
 * Parámetros de QA: ?fx=base|future-star|champions-s|record-breaker|moments|masters-l|masters-sdc
 *   &i=STANDARD|RARE|WALKOUT|MEGA_WALKOUT  &t=<segundos> (congela ese instante)  &reduced=0|1  &stage=2d|3d
 *   &autoplay=1  &panel=0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCard, getPlayer } from "@/data/catalog";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { packArtwork } from "@/data/packArtwork";
import { flagSrc } from "@/lib/assets";
import { ROLE_ABBR } from "@/lib/flags";
import { WALKOUT_INTENSITIES, buildTimeline, type WalkoutIntensity } from "@/domain/walkout/timeline";
import { applyDevOverrides, editionPreset, walkoutIdentityFromCard, type WalkoutInput } from "@/domain/walkout/input";
import type { RoleId } from "@/domain/cards/types";
import type { StageKind } from "@/lib/walkout/stageChoice";
import { WalkoutDirector, walkoutCueOptions, type WalkoutHandle } from "@/components/walkout/WalkoutDirector";
import { CUE_OF_BEAT, WalkoutAudio } from "@/lib/walkout/audio";
import { CELEBRATIONS, celebrationForIntensity, enabledCelebrations, type CelebrationChoice, type CelebrationId } from "@/domain/walkout/celebration";

/** Fixtures: la carta de mayor media de cada edición REAL del catálogo diseñado. «Icon» es una clase de sobre, no una edición. */
const FIXTURES = [
  { id: "base", label: "Base", cardId: "f0rsaken__base", pack: "estandar" },
  { id: "future-star", label: "Future Star", cardId: "lar0k__future-star", pack: "oro" },
  { id: "champions-s", label: "Champions", cardId: "slowly__champions-s", pack: "oro" },
  { id: "record-breaker", label: "Record Breaker", cardId: "marteen__record-breaker", pack: "prime" },
  { id: "moments", label: "Moments", cardId: "mada__moments", pack: "prime" },
  { id: "masters-l", label: "Masters Londres", cardId: "primmie__masters-l", pack: "premium" },
  { id: "masters-sdc", label: "Masters SDC", cardId: "marteen__masters-sdc", pack: "premium" },
  // 0.3 · temas de país con jugadores REALES del catálogo (su nacionalidad canónica): Japón y Estados Unidos
  { id: "japan", label: "Japón · Absol (ZETA)", cardId: "absol__future-star", pack: "oro" },
  // 0.4 · Turquía (la referencia `puente.png`): Lar0k, BBL Esports — nacionalidad canónica TR en el catálogo
  { id: "turkey", label: "Turquía · Lar0k (BBL)", cardId: "lar0k__future-star", pack: "oro" },
  // carta con nacionalidad desconocida (VLR «UN»): tema REGIONAL, nunca un país
  { id: "unknown", label: "Sin país · suygetsu (KC)", cardId: "suygetsu__base", pack: "estandar" },
  { id: "usa", label: "EE. UU. · trent (G2)", cardId: "trent__masters-l", pack: "premium" },
] as const;

const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const FLAGS = [{ iso: "ES", name: "España" }, { iso: "JP", name: "Japón" }, { iso: "US", name: "Estados Unidos" }, { iso: "BR", name: "Brasil" }, { iso: "KR", name: "Corea del Sur" }];
/**
 * Banderas de VISTA PREVIA (solo este panel DEV): ningún jugador del catálogo es español, así que «España» se puede ver
 * en la arena, pero nunca sale de una carta. Copia sin modificar de flag-icons 7.5.0 (ver public/walkout/flags/README.md).
 */
const PREVIEW_FLAGS: Readonly<Record<string, string>> = { ES: "/walkout/flags/es.svg" };
const CELEBRATION_OPTIONS: { id: CelebrationChoice; label: string }[] = [{ id: "RANDOM", label: "Aleatoria" }, ...enabledCelebrations().map((id) => ({ id, label: CELEBRATIONS[id].label }))];
const TEAMS = [{ id: "fnatic", name: "Fnatic" }, { id: "g2", name: "G2" }, { id: "team-heretics", name: "Team Heretics" }, { id: "100t", name: "100T" }];

function baseInput(fx: string): WalkoutInput | null {
  const f = FIXTURES.find((x) => x.id === fx) ?? FIXTURES[0];
  const card = getCard(f.cardId);
  if (!card) return null;
  return walkoutIdentityFromCard(card, getPlayer(card.playerId));
}

export default function PackWalkoutPrototype() {
  const [boot, setBoot] = useState<{ fx: string; i: WalkoutIntensity; t: number | null; reduced: boolean; stage: StageKind | null; autoplay: boolean; panel: boolean; cele: CelebrationChoice; flag: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const i = (q.get("i") ?? "WALKOUT") as WalkoutIntensity;
    const sysReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setBoot({
      fx: q.get("fx") ?? "future-star",
      i: WALKOUT_INTENSITIES.includes(i) ? i : "WALKOUT",
      t: q.has("t") ? Number(q.get("t")) : null,
      reduced: q.has("reduced") ? q.get("reduced") === "1" : sysReduced,
      stage: q.get("stage") === "2d" || q.get("stage") === "3d" ? (q.get("stage") as StageKind) : null,
      autoplay: q.get("autoplay") === "1",
      panel: q.get("panel") !== "0",
      // 0.3 · QA: ?cele=SHUSH|HYPE_JUMP|ARMS_CROSSED|POINT_SKY|RANDOM · ?flag=ES|JP|US… (ajuste DEV del país)
      cele: CELEBRATION_OPTIONS.some((o) => o.id === q.get("cele")) ? (q.get("cele") as CelebrationChoice) : "RANDOM",
      flag: /^[A-Z]{2}$|^none$/.test(q.get("flag") ?? "") ? (q.get("flag") as string) : "",
    });
  }, []);
  if (!boot) return <div className="fixed inset-0 bg-[#030409]" />;
  return <Prototype boot={boot} />;
}

function Prototype({ boot }: { boot: { fx: string; i: WalkoutIntensity; t: number | null; reduced: boolean; stage: StageKind | null; autoplay: boolean; panel: boolean; cele: CelebrationChoice; flag: string } }) {
  const [fx, setFx] = useState(boot.fx);
  const [intensity, setIntensity] = useState<WalkoutIntensity>(boot.i);
  const [reduced, setReduced] = useState(boot.reduced);
  const [stage, setStage] = useState<StageKind | null>(boot.stage);
  const [audioOn, setAudioOn] = useState(true);
  const [role, setRole] = useState<RoleId | "">("");
  const [flag, setFlag] = useState<string>(boot.flag);
  const [cele, setCele] = useState<CelebrationChoice>(boot.cele);
  const [team, setTeam] = useState<string>("");
  const [ovr, setOvr] = useState<string>("");
  const [panel, setPanel] = useState(boot.panel);
  const [info, setInfo] = useState({ status: "idle", t: 0, stage: null as StageKind | null, stageWhy: "" });
  const ref = useRef<WalkoutHandle>(null);

  // 0.4 · la carta manda: identidad canónica de la carta; los ajustes DEV pasan por `applyDevOverrides` (quedan anotados
  // y la escena los rotula «DEV · FORZADO»)
  const input = useMemo<WalkoutInput | null>(() => {
    const b = baseInput(fx);
    if (!b) return null;
    return applyDevOverrides(b, {
      flag: flag === "none" ? "none" : flag ? { iso: flag, src: flagSrc(flag) ?? PREVIEW_FLAGS[flag] ?? "", name: FLAGS.find((x) => x.iso === flag)?.name ?? flag } : null,
      team: team === "nologo" ? { ...b.team, logoSrc: null } : team ? { name: TEAMS.find((x) => x.id === team)?.name ?? team, tag: team.toUpperCase(), logoSrc: hintTeamLogoSrc(team) } : null,
      role: role ? { role, abbr: ROLE_ABBR[role] ?? role.slice(0, 3).toUpperCase() } : null,
      ovr: ovr ? Number(ovr) : null,
    });
  }, [fx, role, flag, team, ovr]);

  const packArt = useMemo(() => packArtwork((FIXTURES.find((x) => x.id === fx) ?? FIXTURES[0]).pack), [fx]);

  // Instante congelado (QA por beats): se aplica cuando la escena ya está montada.
  useEffect(() => {
    if (boot.t === null) return;
    const id = window.setTimeout(() => ref.current?.seek(boot.t!), 400);
    return () => window.clearTimeout(id);
  }, [boot.t, fx, intensity, reduced]);

  // El panel no se repinta en cada fotograma (con el 3D pesado, un setState por fotograma desde un efecto encadenaba
  // renders hasta el aviso «Maximum update depth»): solo cuando cambia el estado, el escenario o t avanza ≥ 0,1 s.
  const onStatus = useCallback((s: typeof info) => setInfo((p) => (p.status === s.status && p.stage === s.stage && p.stageWhy === s.stageWhy && Math.abs(p.t - s.t) < 0.1 ? p : s)), []);

  // Arnés: la QA congela instantes sin recargar (vídeo por fotogramas). Solo en esta página interna.
  useEffect(() => {
    const w = window as Window & { __walkout?: WalkoutHandle | null };
    w.__walkout = { play: () => ref.current?.play(), skip: () => ref.current?.skip(), replay: () => ref.current?.replay(), seek: (t) => ref.current?.seek(t) };
    return () => { w.__walkout = null; };
  }, []);

  // QA de audio (solo esta página interna): la mezcla ENTERA de una reproducción renderizada sin altavoces
  // (OfflineAudioContext, cada cue en el instante de su beat con los mismos parámetros que la escena) → WAV + medidas.
  useEffect(() => {
    const w = window as Window & { __walkoutAudioRender?: (i: WalkoutIntensity, cel: CelebrationId | null, fxId: string) => Promise<{ wav: string; seconds: number; peak: number; rms: number[]; cues: { beat: string; at: number }[] }> };
    w.__walkoutAudioRender = async (i, cel, fxId) => {
      const b = baseInput(fxId); if (!b) throw new Error(`fixture ${fxId}`);
      const tl = buildTimeline(i, { reduced: false });
      const rate = 44100, seconds = Math.ceil(tl.duration + 3.5);
      const ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const audio = new WalkoutAudio(() => ctx as unknown as AudioContext); audio.setEnabled(true);
      const opts = walkoutCueOptions(tl, celebrationForIntensity(i, cel ?? "ARMS_CROSSED"), editionPreset(b.edition.id).revealIntensity);
      const cues: { beat: string; at: number }[] = [];
      for (const beat of tl.beats) {
        const cue = CUE_OF_BEAT[beat.id]; if (!cue) continue;
        const at = Math.round(beat.at * 128) / 128;                 // suspend() cae en fronteras de 128 muestras
        cues.push({ beat: beat.id, at });
        void ctx.suspend(at).then(() => { audio.play(cue, opts); return ctx.resume(); });
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let peak = 0; const rms: number[] = []; const win = rate / 2;
      for (let s = 0; s < L.length; s += win) { let acc = 0; for (let k = s; k < Math.min(L.length, s + win); k++) { const v = (L[k] + R[k]) / 2; acc += v * v; peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k])); } rms.push(+Math.sqrt(acc / win).toFixed(4)); }
      // WAV PCM 16 bits estéreo
      const n = L.length, data = new DataView(new ArrayBuffer(44 + n * 4));
      const str = (o: number, t: string) => { for (let k = 0; k < t.length; k++) data.setUint8(o + k, t.charCodeAt(k)); };
      str(0, "RIFF"); data.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); str(36, "data"); data.setUint32(40, n * 4, true);
      for (let k = 0; k < n; k++) { data.setInt16(44 + k * 4, Math.max(-1, Math.min(1, L[k])) * 32767, true); data.setInt16(46 + k * 4, Math.max(-1, Math.min(1, R[k])) * 32767, true); }
      const bytes = new Uint8Array(data.buffer); let bin = ""; for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      return { wav: btoa(bin), seconds, peak: +peak.toFixed(4), rms, cues };
    };
    return () => { delete w.__walkoutAudioRender; };
  }, []);

  if (!input) return <p className="p-6 text-white">Fixture sin carta en el catálogo.</p>;
  const sel = "rounded-sm border border-white/20 bg-black/70 px-2 py-1 text-xs text-white";
  const btn = "rounded-sm border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div data-testid="walkout-prototype">
      <WalkoutDirector
        key={`${fx}|${intensity}|${reduced}|${stage}`}
        ref={ref}
        input={input}
        intensity={intensity}
        reduced={reduced}
        packArt={packArt}
        forceStage={stage}
        audioOn={audioOn}
        autoPlay={boot.autoplay && boot.t === null}
        onStatus={onStatus}
        celebration={cele}
      />
      {panel ? (
        <aside className="fixed left-3 top-3 z-[80] w-[min(300px,calc(100vw-24px))] space-y-2 rounded-md border border-white/15 bg-black/75 p-3 text-xs text-white/85 backdrop-blur" data-testid="walkout-dev-panel" aria-label="Panel DEV del walkout">
          <div className="flex items-center justify-between">
            <p className="font-bold uppercase tracking-[0.2em] text-white">Walkout 0.2 · DEV</p>
            <button type="button" className="text-white/60 hover:text-white" onClick={() => setPanel(false)} aria-label="Ocultar panel">✕</button>
          </div>
          <p className="text-[10px] text-white/50">DEMO local · sin servidor ni economía</p>
          <label className="flex items-center justify-between gap-2">Intensidad
            <select className={sel} value={intensity} onChange={(e) => setIntensity(e.target.value as WalkoutIntensity)}>{WALKOUT_INTENSITIES.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Edición (fixture)
            <select className={sel} value={fx} onChange={(e) => setFx(e.target.value)}>{FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Rol
            <select className={sel} value={role} onChange={(e) => setRole(e.target.value as RoleId | "")}><option value="">De la carta</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Celebración
            <select className={sel} value={cele} onChange={(e) => setCele(e.target.value as CelebrationChoice)} data-testid="dev-celebration">{CELEBRATION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Bandera (DEV)
            <select className={sel} value={flag} onChange={(e) => setFlag(e.target.value)}><option value="">De la carta</option><option value="none">Sin bandera (región)</option>{FLAGS.map((f) => <option key={f.iso} value={f.iso}>{f.name}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Equipo
            <select className={sel} value={team} onChange={(e) => setTeam(e.target.value)}><option value="">De la carta</option><option value="nologo">Sin logo (texto)</option>{TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Media
            <input className={`${sel} w-16`} inputMode="numeric" placeholder={String(baseInput(fx)?.ovr ?? "")} value={ovr} onChange={(e) => setOvr(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </label>
          <label className="flex items-center justify-between gap-2">Escenario
            <select className={sel} value={stage ?? ""} onChange={(e) => setStage((e.target.value || null) as StageKind | null)}><option value="">Auto</option><option value="3d">3D</option><option value="2d">2D</option></select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Movimiento reducido</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={audioOn} onChange={(e) => setAudioOn(e.target.checked)} /> Sonido</label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button type="button" className={btn} onClick={() => ref.current?.play()} data-testid="dev-play">Play</button>
            <button type="button" className={btn} onClick={() => ref.current?.replay()} data-testid="dev-replay">Repetir</button>
            <button type="button" className={btn} onClick={() => ref.current?.skip()} data-testid="dev-skip">Saltar</button>
          </div>
          <p className="font-mono text-[10px] text-white/50" data-testid="dev-info">{info.status} · t={info.t.toFixed(2)}s · {info.stage ?? "…"} ({info.stageWhy})</p>
        </aside>
      ) : null}
      {!panel && boot.panel && (
        <button type="button" className="fixed left-3 top-3 z-[80] rounded-sm bg-black/60 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70" onClick={() => setPanel(true)}>DEV</button>
      )}
      {info.status === "idle" && boot.t === null && (
        <button type="button" onClick={() => ref.current?.play()} data-testid="walkout-start" className="fixed left-1/2 top-1/2 z-[75] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/40 bg-black/60 px-8 py-4 font-display text-sm font-black uppercase tracking-[0.4em] text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          Abrir sobre
        </button>
      )}
    </div>
  );
}
