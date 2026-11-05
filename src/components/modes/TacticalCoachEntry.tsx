/**
 * FASE 51 · EL CENTRO TÁCTICO EN `/jugar`.
 *
 * `/jugar` es el selector de los modos de DUELO de cartas, y el entrenador no es uno de ellos —no
 * se juega con el mazo ni tiene rival de cartas—. Por eso no entra como sexto modo: va aparte,
 * DESPUÉS de los modos, como una sala distinta del mismo juego. Antes solo se llegaba desde el
 * desplegable «Más» de la barra (y a partir de 1024 px): desde la pantalla donde uno elige qué
 * hacer, el entrenador no existía.
 *
 * Su botón NO es la acción dominante de la pantalla (`data-cta` no es «primary»): esa sigue siendo
 * la del modo destacado o la partida en curso.
 */
import Link from "next/link";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";

const CAPACIDADES = ["Composiciones", "Pizarra táctica", "Plan de partido", "Presentación"] as const;

export function TacticalCoachEntry({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="play-hub-coach-title"
      data-testid="play-hub-coach"
      className={`nx-clip relative isolate overflow-hidden px-5 py-6 sm:px-8 ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(60% 120% at 100% 50%, rgba(47,224,255,0.16), transparent 65%)," +
          "linear-gradient(160deg, rgba(7,14,28,0.92), rgba(4,8,16,0.95))",
        boxShadow: "inset 0 0 0 1px rgba(47,224,255,0.22), inset 0 1px 0 rgba(47,224,255,0.5)",
      }}
    >
      {/* Retícula de plano y una ruta: la sala se reconoce antes de leer. Decorativo. */}
      <svg aria-hidden viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-[62%] opacity-60">
        <defs>
          <pattern id="tce-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0v20" fill="none" stroke="#2fe0ff" strokeOpacity="0.1" /></pattern>
          <linearGradient id="tce-fade" x1="0" x2="1"><stop offset="0" stopColor="#050a16" /><stop offset="0.55" stopColor="#050a16" stopOpacity="0" /></linearGradient>
        </defs>
        <rect width="400" height="200" fill="url(#tce-grid)" />
        <path d="M170 40h90v40h60v80H250v-30h-60v30h-40V90h20z" fill="none" stroke="#7fdcff" strokeOpacity="0.5" strokeWidth="1.5" />
        <path className="nx-coach-route" d="M190 150C220 120 260 100 300 70" fill="none" stroke="#2fe0ff" strokeWidth="2" style={{ strokeDasharray: "5 6" }} />
        {[[190, 150], [205, 140], [180, 132], [220, 152], [200, 160]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5" fill="#06121f" stroke="#2fe0ff" strokeWidth="1.8" />
        ))}
        <rect width="400" height="200" fill="url(#tce-fade)" />
      </svg>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-[640px]">
          <p className="font-display text-[10.5px] font-bold uppercase tracking-[0.28em] text-[#2fe0ff]">Centro táctico · no es un modo de duelo</p>
          <h2 id="play-hub-coach-title" className="mt-2 flex items-center gap-3 font-display text-[clamp(26px,3.4vw,40px)] font-extrabold uppercase leading-none text-white">
            <span aria-hidden className="text-[#2fe0ff]" style={{ filter: "drop-shadow(0 0 8px rgba(47,224,255,0.7))" }}><CoachIcon name="hub" size={30} /></span>
            Tactical Coach
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-white/65">
            Prepara composiciones, diseña jugadas, planifica partidos y presenta estrategias a tu equipo.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Qué incluye">
            {CAPACIDADES.map((c) => (
              <li key={c} className="px-2.5 py-1 font-display text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/75 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.25)]">{c}</li>
            ))}
          </ul>
        </div>
        <Link
          href="/entrenador"
          data-cta="coach"
          data-testid="play-hub-coach-cta"
          className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 px-6 font-display text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#021420] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{
            background: "linear-gradient(180deg, #7af2ff 0%, #2fc8f4 55%, #1a8ed6 100%)",
            clipPath: "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)",
          }}
        >
          Abrir Tactical Coach →
        </Link>
      </div>
    </section>
  );
}
