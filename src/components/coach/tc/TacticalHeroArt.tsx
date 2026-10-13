/**
 * FASE 51 · EL ARTE DEL HERO DEL TACTICAL COACH. SVG propio: una planta abstracta de mapa (no es
 * ninguno de los doce, es geometría NEXUS), la retícula de la sala, las rutas de ejecución que se
 * dibujan solas, cinco fichas cian del equipo y dos marcas magenta del rival. Decorativo
 * (`aria-hidden`), sin imágenes ni arte de terceros. Con movimiento reducido queda quieto y entero.
 */
export function TacticalHeroArt({ className }: { className?: string }) {
  const nuestros = [
    { x: 520, y: 330 }, { x: 560, y: 360 }, { x: 600, y: 320 }, { x: 640, y: 350 }, { x: 580, y: 395 },
  ];
  return (
    <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" aria-hidden className={className}>
      <defs>
        <linearGradient id="tc-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#050a16" stopOpacity="1" />
          <stop offset="0.42" stopColor="#050a16" stopOpacity="0.6" />
          <stop offset="1" stopColor="#050a16" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="tc-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2fe0ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#2fe0ff" stopOpacity="0" />
        </radialGradient>
        <pattern id="tc-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0v24" fill="none" stroke="#2fe0ff" strokeOpacity="0.07" />
        </pattern>
      </defs>

      <rect width="1000" height="500" fill="url(#tc-grid)" />
      <circle cx="700" cy="250" r="260" fill="url(#tc-glow)" />

      {/* La planta: pasillos y sitios de un mapa que no existe. */}
      <g fill="none" stroke="#7fdcff" strokeOpacity="0.55" strokeWidth="2">
        <path d="M430 90h160v70h120v-60h160v150h-90v90h90v150H700v-70H600v70H430V330h60V250h-60z" />
        <path d="M590 160v90h110M600 330v-80M700 250v80" strokeOpacity="0.35" />
        <rect x="740" y="120" width="110" height="80" strokeOpacity="0.8" />
        <rect x="460" y="360" width="100" height="70" strokeOpacity="0.8" />
      </g>
      <g fontFamily="inherit" fontWeight="800" fontSize="34" fill="#7fdcff" fillOpacity="0.55">
        <text x="780" y="173">A</text>
        <text x="497" y="408">B</text>
      </g>

      {/* Rutas de ejecución: dos que se dibujan y una discontinua que avanza. */}
      <g fill="none" strokeWidth="3" strokeLinecap="round">
        <path className="nx-coach-route-draw" d="M560 360C600 300 680 260 760 190" stroke="#2fe0ff" />
        <path className="nx-coach-route-draw" style={{ animationDelay: "0.9s" }} d="M520 330C520 250 580 200 640 150" stroke="#347cff" />
        <path className="nx-coach-route" d="M640 350C700 330 760 300 820 230" stroke="#2fe0ff" strokeOpacity="0.6" />
      </g>
      <g fill="#2fe0ff">
        <path d="m760 190-15 4 8 10z" />
      </g>

      {/* Humo y utilidad, en círculos translúcidos. */}
      <circle cx="700" cy="215" r="34" fill="#9fb4ff" fillOpacity="0.12" stroke="#9fb4ff" strokeOpacity="0.4" strokeDasharray="4 5" />
      <circle cx="655" cy="175" r="22" fill="#2fe0ff" fillOpacity="0.1" stroke="#2fe0ff" strokeOpacity="0.45" />

      {/* Nuestro equipo: cinco fichas cian. */}
      {nuestros.map((f, i) => (
        <g key={i}>
          <circle className="nx-coach-pulse" style={{ animationDelay: `${i * 0.35}s` }} cx={f.x} cy={f.y} r="16" fill="#2fe0ff" fillOpacity="0.16" />
          <circle cx={f.x} cy={f.y} r="9" fill="#06121f" stroke="#2fe0ff" strokeWidth="2.5" />
        </g>
      ))}
      {/* El rival: dos marcas magenta, pocas: contraste, no protagonismo. */}
      {[{ x: 805, y: 150 }, { x: 830, y: 205 }].map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y} r="8" fill="#12050c" stroke="#ff2e8c" strokeWidth="2.5" />
          <path d={`M${f.x - 4} ${f.y - 4}l8 8M${f.x + 4} ${f.y - 4}l-8 8`} stroke="#ff2e8c" strokeWidth="1.6" />
        </g>
      ))}

      <rect width="1000" height="500" fill="url(#tc-fade)" />
    </svg>
  );
}
