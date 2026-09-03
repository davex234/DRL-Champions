"use client";

/**
 * FONDO DINÁMICO (Fase 9B).
 *
 * El fondo de un videojuego no es una imagen: es una atmósfera que responde a dónde estás.
 * Aquí hay dos capas y una regla.
 *
 *   · Capa 1 — luz. Gradientes radiales teñidos por la sección activa. Es pura CSS y no
 *     cuesta nada; la transición entre secciones es del propio `background`.
 *   · Capa 2 — partículas. Un campo de puntos a la deriva en un `<canvas>`. Solo en las
 *     variantes que lo piden: en una tabla de clasificación estorbaría.
 *   · La regla — el fondo NUNCA compite con el contenido. Opacidades bajas, sin
 *     movimiento rápido, y se apaga entero con `prefers-reduced-motion`.
 *
 * Rendimiento (§9J): el bucle se DETIENE cuando la pestaña está oculta. En la Fase 8.5 se
 * comprobó que Chrome estrangula `requestAnimationFrame` en segundo plano; dejar el bucle
 * vivo solo sirve para gastar batería y para que al volver se acumulen fotogramas.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";

export type BackgroundVariant =
  | "home"
  | "collection"
  | "packs"
  | "ranking"
  | "profile"
  | "duels"
  | "tournaments"
  | "world";

interface VariantSpec {
  /** Tinte principal, en componentes RGB sueltos para poder modular la opacidad. */
  tint: [number, number, number];
  /** Tinte secundario del segundo foco de luz. */
  accent: [number, number, number];
  /** Densidad del campo de partículas. 0 = sin canvas. */
  particles: number;
  /** Velocidad de deriva, en px/segundo. */
  drift: number;
  /** Rejilla técnica de fondo. */
  grid: boolean;
}

/**
 * Cada variante es una decisión, no una paleta al azar:
 * competir tira a magenta, coleccionar a violeta, comprar a oro, progresar a cian.
 */
const VARIANTS: Record<BackgroundVariant, VariantSpec> = {
  home:        { tint: [255, 46, 99],  accent: [25, 227, 255], particles: 26, drift: 5,  grid: true },
  duels:       { tint: [255, 46, 99],  accent: [255, 92, 138], particles: 34, drift: 9,  grid: true },
  tournaments: { tint: [255, 138, 61], accent: [255, 211, 92], particles: 20, drift: 6,  grid: true },
  collection:  { tint: [123, 92, 255], accent: [25, 227, 255], particles: 16, drift: 3,  grid: false },
  packs:       { tint: [255, 211, 92], accent: [255, 46, 99],  particles: 40, drift: 11, grid: false },
  ranking:     { tint: [25, 227, 255], accent: [63, 192, 122], particles: 0,  drift: 0,  grid: true },
  profile:     { tint: [25, 227, 255], accent: [123, 92, 255], particles: 12, drift: 3,  grid: true },
  world:       { tint: [63, 192, 122], accent: [25, 227, 255], particles: 18, drift: 4,  grid: true },
};

const rgb = (c: [number, number, number]) => `${c[0]}, ${c[1]}, ${c[2]}`;

export function DynamicGameBackground({
  variant = "home",
  intensity = 1,
  className,
}: {
  variant?: BackgroundVariant;
  /** 0..1. Las pantallas muy densas lo bajan para que el fondo no compita. */
  intensity?: number;
  className?: string;
}) {
  const spec = VARIANTS[variant] ?? VARIANTS.home;
  const k = Math.max(0, Math.min(1, intensity));

  return (
    <div
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
      aria-hidden
      data-variant={variant}
    >
      {/* Capa 1 — luz. */}
      <div
        className="absolute inset-0 transition-[background] duration-slow ease-out"
        style={{
          background: `
            radial-gradient(1100px 540px at 50% -10%, rgba(${rgb(spec.tint)}, ${0.16 * k}), transparent 62%),
            radial-gradient(780px 480px at 92% 6%, rgba(${rgb(spec.accent)}, ${0.09 * k}), transparent 58%),
            radial-gradient(900px 620px at 2% 98%, rgba(${rgb(spec.tint)}, ${0.06 * k}), transparent 60%),
            #06070d`,
        }}
      />

      {spec.grid && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,${0.026 * k}) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,${0.026 * k}) 1px, transparent 1px)`,
            backgroundSize: "44px 44px",
            maskImage: "linear-gradient(to bottom, black, transparent 78%)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent 78%)",
          }}
        />
      )}

      {/* Capa 2 — partículas. */}
      {spec.particles > 0 && k > 0.2 && (
        <ParticleField count={Math.round(spec.particles * k)} drift={spec.drift} tint={spec.tint} />
      )}

      {/* Viñeta: asienta el contenido y evita que las esquinas se vayan en luz. */}
      <div
        className="absolute inset-0"
        style={{ boxShadow: "inset 0 0 220px 60px rgba(6,7,13,0.85)" }}
      />
    </div>
  );
}

/**
 * Campo de puntos. Sin librería y sin física: posiciones, una deriva y un parpadeo lento.
 * Se redibuja a resolución del dispositivo para que no se vean cuadrados en pantallas HiDPI.
 */
function ParticleField({
  count, drift, tint,
}: {
  count: number;
  drift: number;
  tint: [number, number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Quien pide menos movimiento no recibe una versión lenta: recibe una estática.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const dots: { x: number; y: number; r: number; vx: number; vy: number; phase: number }[] = [];

    const seed = () => {
      dots.length = 0;
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.7 + Math.random() * 1.6,
          vx: (Math.random() - 0.5) * drift,
          vy: -(0.25 + Math.random()) * drift * 0.5,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (dots.length === 0) seed();
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      // Se acota el delta: al volver de una pestaña oculta el primer salto sería enorme.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);

      for (const d of dots) {
        if (!reduced) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.y < -8) { d.y = height + 8; d.x = Math.random() * width; }
          if (d.x < -8) d.x = width + 8;
          if (d.x > width + 8) d.x = -8;
        }
        const twinkle = reduced ? 0.5 : 0.35 + 0.35 * Math.sin(now / 1400 + d.phase);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.32 * twinkle})`;
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // El bucle se para con la pestaña oculta y se reanuda al volver (§9J).
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [count, drift, tint]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

/** Sección de navegación → variante de fondo. Un solo sitio decide el ambiente. */
export function variantForSection(sectionId: string | null | undefined, pathname: string): BackgroundVariant {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/duelos")) return "duels";
  if (pathname.startsWith("/torneos")) return "tournaments";
  if (pathname.startsWith("/tienda") || pathname.startsWith("/abrir") || pathname.startsWith("/eventos")) return "packs";
  if (pathname.startsWith("/ranking")) return "ranking";
  if (pathname.startsWith("/cuenta")) return "profile";
  switch (sectionId) {
    case "coleccion": return "collection";
    case "progreso": return "profile";
    case "mundo": return "world";
    case "tienda": return "packs";
    case "jugar": return "duels";
    default: return "home";
  }
}
