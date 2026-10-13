/**
 * FASE 51 · TACTICAL COACH 4.0 — el marco común de todas las salas del entrenador: la hoja visual
 * del Coach (`coach.css`) y la navegación interna (`CoachFrame`). Las páginas siguen siendo las
 * mismas; esto solo las pone en la misma sala.
 */
import "./coach.css";
import { CoachFrame } from "@/components/coach/tc/CoachFrame";

export default function EntrenadorLayout({ children }: { children: React.ReactNode }) {
  return <CoachFrame>{children}</CoachFrame>;
}
