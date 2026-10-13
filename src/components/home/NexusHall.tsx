"use client";

/**
 * EL VESTÍBULO NEXUS — la escena que vive detrás del menú principal.
 *
 * ────────────────────────── ARQUITECTURA DE VÍDEO (y por qué el fallback no es un parche) ──────────────────────────
 *
 * El objetivo final es un vídeo cinemático a sangre. Esa arquitectura está montada ENTERA:
 *
 *     <video>  /video/nexus-lobby.webm  →  /video/nexus-lobby.mp4  →  poster  →  escena 2.5D
 *
 * El vídeo va en la capa más baja, `autoplay muted loop playsInline`, con `poster` para que nunca
 * haya un destello negro mientras carga. Las capas 2.5D de encima NO son un sustituto del vídeo:
 * son el sombreado de la escena (bruma, acentos, viñeta) y siguen funcionando igual cuando el
 * vídeo exista. Por eso poner el fichero mañana no obliga a rehacer nada.
 *
 * **BACKGROUND VIDEO ASSET PENDING**: hoy no existe `public/video/nexus-lobby.*`. `onError` marca
 * el vídeo como no disponible y la escena 2.5D pasa a ser el fondo, que es lo que se ve ahora.
 *
 * ────────────────────────── LA ESCENA, POR CAPAS ──────────────────────────
 *
 *     cielo → arquitectura → haces → bruma → horizonte → suelo → charco → acentos
 *           → monolito → cartas → PACK → hero card → motas → viñeta
 *
 * Todo son gradientes, `clip-path` y transformaciones. Ni WebGL, ni canvas, ni Three.js, ni blur
 * animado: lo único que se mueve son `transform` y `opacity`, y las motas son DIECISÉIS, contadas
 * aquí. Con `prefers-reduced-motion: reduce` no se mueve nada (la regla vive en la hoja de estilo).
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No lee la partida, no llama al servidor y no decide nada. Recibe cartas YA elegidas por quien la
 * monta y las pinta. Si se borra este fichero, NEXUS se juega igual: sólo se entra por una puerta
 * más fea.
 */
import { PlayerCard } from "@/components/cards/PlayerCard";
import type { CardDef } from "@/domain/cards/types";
import { cn } from "@/lib/format";

/**
 * F63 · ¿EXISTE EL VÍDEO? Hasta que `public/video/nexus-lobby.*` exista, el `<video>` NO se monta: montarlo pedía tres
 * ficheros inexistentes (poster, webm y mp4) y cada visita a la portada —lo primero que ve un jugador nuevo— dejaba tres
 * 404 en la consola (heredados de F46). Poner el fichero = cambiar esto a `true`; un test lo compara con `public/video`.
 */
export const LOBBY_VIDEO_READY = false;

/** Dieciséis. No «las que hagan falta»: dieciséis. */
const MOTAS = Array.from({ length: 16 }, (_, i) => i);

export type HallAccent = "play" | "vault" | "store" | null;

/*
 * Colocación de cada carta que vuela: sitio, escala y su inclinación. Fijas, no aleatorias, para que
 * la escena sea la misma en cada carga.
 *
 * La `escala` se aplica sobre una carta REAL renderizada con la pieza canónica (`PlayerCard`), no
 * sobre una miniatura: `CardThumb` está hecho para 44 px —un bloque de color con dos iniciales— y a
 * tamaño grande se lee exactamente como lo que el encargo prohíbe, «cartas que parecen thumbnails».
 */
const VUELO = [
  { left: "52%", top: "16%", escala: 0.92, rx: "7deg", ry: "-16deg", rz: "-9deg", d: "14s", delay: "0s", blur: 0, z: 3 },
  { left: "70%", top: "36%", escala: 0.76, rx: "5deg", ry: "12deg", rz: "7deg", d: "17s", delay: "-3s", blur: 0.8, z: 2 },
  { left: "46%", top: "52%", escala: 0.62, rx: "9deg", ry: "-9deg", rz: "-14deg", d: "15s", delay: "-6s", blur: 1.6, z: 2 },
  { left: "62%", top: "64%", escala: 0.54, rx: "4deg", ry: "17deg", rz: "11deg", d: "19s", delay: "-9s", blur: 2.2, z: 1 },
  { left: "44%", top: "74%", escala: 0.44, rx: "8deg", ry: "-13deg", rz: "-17deg", d: "16s", delay: "-12s", blur: 3, z: 1 },
] as const;

export function NexusHall({
  cards, hero, accent = null, videoReady, onVideoError, className,
}: {
  /** Cartas REALES del catálogo. Las elige quien monta la escena; aquí sólo se pintan. */
  cards: CardDef[];
  /** La carta protagonista, también real. */
  hero: CardDef | null;
  /** Qué botón está apuntado: ilumina la escena sin cambiarla. */
  accent?: HallAccent;
  /** `false` cuando el vídeo no está disponible (no existe todavía, o falló al cargar). */
  videoReady: boolean;
  onVideoError: () => void;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      data-testid="nexus-hall"
      data-accent={accent ?? "none"}
      data-video={videoReady ? "on" : "off"}
      className={cn("nx-hall", className)}
      style={
        {
          "--hall-play": accent === "play" ? 1 : 0,
          "--hall-vault": accent === "vault" ? 1 : 0,
          "--hall-store": accent === "store" ? 1 : 0,
        } as React.CSSProperties
      }
    >
      {/*
        LA CAPA DEL VÍDEO. Va la primera y por debajo de todo. `poster` evita el destello negro; si
        el fichero no está, `onError` lo apaga y la escena 2.5D queda como fondo, sin hueco.
      */}
      {videoReady && <video
        className="h-full w-full object-cover"
        style={{ inset: 0, opacity: videoReady ? 1 : 0 }}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/video/nexus-lobby-poster.jpg"
        onError={onVideoError}
      >
        <source src="/video/nexus-lobby.webm" type="video/webm" />
        <source src="/video/nexus-lobby.mp4" type="video/mp4" />
      </video>}

      {/* ── FONDO ── */}
      <span className="nx-hall-sky" />
      <span className="nx-hall-arch-far" />
      <span className="nx-hall-arch" />
      <span className="nx-hall-beam nx-hall-beam-a" />
      <span className="nx-hall-beam nx-hall-beam-c" />
      <span className="nx-hall-beam nx-hall-beam-b" />
      <span className="nx-hall-horizon" />
      <span className="nx-hall-haze" />
      <span className="nx-hall-floor" />
      <span className="nx-hall-wet" />

      {/* Reacción al menú: tres tintes que sólo se encienden al apuntar. */}
      <span className="nx-hall-tint nx-hall-accent-play" />
      <span className="nx-hall-tint nx-hall-accent-vault" />
      <span className="nx-hall-tint nx-hall-accent-store" />

      {/*
        EL MONOLITO DEL FONDO. En la referencia hay una estructura central con la marca y los cuatro
        verbos del producto. Aquí se usa la marca REAL de NEXUS (el icono del proyecto), no un
        logotipo inventado, y se deja muy al fondo: se intuye, no se lee.
      */}
      <span
        className="left-[58%] top-[16%] h-[26vh] w-[14vw] -translate-x-1/2 opacity-[0.30]"
        style={{
          backgroundImage: "url(/branding/icon/icon-mono.svg)",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          filter: "drop-shadow(0 0 30px rgba(139,92,246,0.6))",
        }}
      />
      <span className="left-[58%] top-[43%] -translate-x-1/2 text-center font-display text-[10px] font-bold uppercase leading-[2.4] tracking-[0.5em] text-white/25">
        Play<br />Collect<br />Compete<br />Belong
      </span>

      {/* ── LAS CARTAS QUE VUELAN. Reales, del catálogo. ── */}
      {cards.slice(0, VUELO.length).map((card, i) => {
        const v = VUELO[i];
        return (
          <span
            key={`${card.id}-${i}`}
            className="nx-card-float"
            style={
              {
                left: v.left,
                top: v.top,
                zIndex: v.z,
                filter: v.blur ? `blur(${v.blur}px) drop-shadow(0 18px 28px rgba(0,0,0,0.8))` : undefined,
                "--c-rx": v.rx,
                "--c-ry": v.ry,
                "--c-rz": v.rz,
                "--c-d": v.d,
                "--c-delay": v.delay,
              } as React.CSSProperties
            }
          >
            <span className="block origin-top-left" style={{ transform: `scale(${v.escala})` }}>
              <PlayerCard card={card} size="sm" interactive={false} showStats={false} effects={false} />
            </span>
          </span>
        );
      })}

      {/*
        ── EL PACK ──

        La primera versión se leía como un rectángulo redondeado con una banda beige encima: justo
        el NO-GO del encargo. Tres cosas fallaban y las tres se arreglan aquí:

          · la caja no tenía CANTOS. Ahora son tres caras (frontal, lateral y tapa superior) con
            luminancias distintas, que es lo único que convierte una silueta en un volumen;
          · la luz salía por detrás de la caja en vez de por DENTRO. Ahora el estallido y los haces
            nacen en la boca, y el labio interior está sobreexpuesto;
          · la tapa no se veía abierta. Ahora está tumbada hacia atrás, en perspectiva y más oscura
            que la caja, porque le da la luz de canto.
      */}
      <span className="nx-pack left-[58%] top-[44%] h-[52vh] w-[34vw]">
        {/* Primero el objeto… */}
        <span className="nx-pack-burst" />
        <span className="nx-pack-lid" />
        <span className="nx-pack-mouth" />
        <span className="nx-pack-side" />
        <span className="nx-pack-body" />
        <span className="nx-pack-edge" />
        {/* …y DESPUÉS su luz, por delante: es lo que se ve de una caja abierta. */}
        <span className="nx-pack-lip" />
        <span className="nx-pack-rays" />
        <span className="nx-pack-veil" />
        <span className="nx-pack-core" />
        <span className="nx-pack-mark">
          <span
            className="h-[3.4vh] w-[3.4vh] opacity-90"
            style={{
              backgroundImage: "url(/branding/icon/icon-mono.svg)",
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
            }}
          />
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.42em] text-white/60">Nexus</span>
        </span>
      </span>

      {/* ── LA HERO CARD. Arriba a la derecha, la más grande y la única nítida del todo. ── */}
      {hero && (
        <span className="nx-hero-card right-[3%] top-[11%]">
          <span className="relative block">
            {/* La protagonista se dibuja ENTERA: con sus estadísticas y su tratamiento de rareza. */}
            <PlayerCard card={hero} size="lg" interactive={false} />
            <span className="nx-hero-frame" />
          </span>
        </span>
      )}

      {/* ── MOTAS ── */}
      <span className="nx-hall-motes">
        {MOTAS.map((i) => (
          <span
            key={i}
            className="nx-hall-mote"
            style={
              {
                "--m-x": `${(i * 6.3 + 38) % 62 + 36}%`,
                "--m-d": `${16 + (i % 5) * 4}s`,
                "--m-delay": `${i * -2.1}s`,
                "--m-s": `${1 + (i % 3) * 0.7}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </span>

      <span className="nx-hall-vignette" />
    </div>
  );
}
