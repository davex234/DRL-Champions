/**
 * FASE 51 · ICONOGRAFÍA DEL TACTICAL COACH. Trazos propios de NEXUS (sin arte de terceros): cada
 * módulo del centro de mando tiene su glifo, dibujado con el mismo grosor y la misma rejilla de 24.
 */
export type CoachIconName = "hub" | "board" | "comp" | "plan" | "match" | "maps" | "history" | "team" | "present" | "undo" | "redo" | "save";

export function CoachIcon({ name, size = 20, className }: { name: CoachIconName; size?: number; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      {name === "hub" && (<g {...p}><path d="M12 3 21 8v8l-9 5-9-5V8z" /><path d="M12 12 21 8M12 12 3 8M12 12v9" /></g>)}
      {name === "board" && (<g {...p}><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="15" r="1.6" /><circle cx="16" cy="9" r="1.6" /><path d="M9.5 13.6 14.3 10.2" strokeDasharray="2 2" /><path d="m13 9.6 1.6.5-.5 1.6" /></g>)}
      {name === "comp" && (<g {...p}><circle cx="12" cy="7" r="2.6" /><circle cx="5.5" cy="11" r="2.1" /><circle cx="18.5" cy="11" r="2.1" /><circle cx="8" cy="17.5" r="2.1" /><circle cx="16" cy="17.5" r="2.1" /></g>)}
      {name === "plan" && (<g {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 11h7M9 14.5h7M9 18h4" /></g>)}
      {name === "match" && (<g {...p}><path d="M4 20 20 4" /><path d="M4 4l6 6M14 14l6 6" /><path d="M15 4h5v5M4 15v5h5" /></g>)}
      {name === "maps" && (<g {...p}><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5M15 6.5V20" /></g>)}
      {name === "history" && (<g {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><path d="M12 8v4l3 2" /></g>)}
      {name === "team" && (<g {...p}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.2" /><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5" /></g>)}
      {name === "present" && (<g {...p}><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M12 16v4M8 20h8" /><path d="m10 8 4 2-4 2z" fill="currentColor" /></g>)}
      {name === "undo" && (<g {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></g>)}
      {name === "redo" && (<g {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></g>)}
      {name === "save" && (<g {...p}><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3M8 21v-6h8v6" /></g>)}
    </svg>
  );
}
