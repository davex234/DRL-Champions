/**
 * MANAGER CAREER ENGINE · Fase 3 — staff del club.
 *
 * Cada miembro del staff aporta un MODIFICADOR REAL (no cosmético): assistant→entrenamiento,
 * analyst→info, psychologist→mental, scout→scouting, performance→fatiga, manager→ingresos.
 * Mercado de staff determinista (Rng sembrado). Puro.
 */
import type { StaffRoleId, StaffMember, StaffEffects, StaffPersonality } from "./types";
import type { Rng } from "./rng";

/** Roles de la ORGANIZACIÓN completa (Fase 5). El Head Coach es el propio usuario. */
export const STAFF_ROLES: StaffRoleId[] = [
  "ceo", "sporting_director", "assistant_coach", "analyst", "scout",
  "psychologist", "performance", "content_manager", "marketing_manager", "community_manager",
];

export const STAFF_LABEL: Record<StaffRoleId, string> = {
  ceo: "CEO",
  sporting_director: "Director deportivo",
  assistant_coach: "Entrenador asistente",
  analyst: "Analista",
  scout: "Ojeador",
  psychologist: "Psicólogo",
  performance: "Preparador físico",
  content_manager: "Content Manager",
  marketing_manager: "Marketing Manager",
  community_manager: "Community Manager",
  manager: "Mánager general",
};

export const STAFF_PERSONALITIES: StaffPersonality[] = ["ambitious", "loyal", "innovative", "methodical", "charismatic", "demanding"];
const SPECIALTY: Record<StaffRoleId, string> = {
  ceo: "visión de negocio", sporting_director: "gestión deportiva", assistant_coach: "táctica y drills",
  analyst: "vídeo y datos", scout: "ojeo internacional", psychologist: "gestión mental",
  performance: "preparación física", content_manager: "producción de contenido",
  marketing_manager: "estrategia comercial", community_manager: "comunidad y redes", manager: "operaciones",
};

const NAMES = ["Vega", "Sato", "Ruiz", "Kane", "Niko", "Park", "Lund", "Cole", "Adler", "Moss", "Reyes", "Oni", "Faye", "Dorn", "Halu", "Wren"];

/** Modificadores agregados del staff contratado (0..~1 cada uno). Fase 5 amplía la organización. */
export function staffEffects(staff: StaffMember[]): StaffEffects {
  const e: StaffEffects = { trainingBoost: 0, infoBoost: 0, mentalBoost: 0, scoutBoost: 0, fatigueBoost: 0, incomeBoost: 0, contentBoost: 0, marketingBoost: 0, communityBoost: 0, commercialBoost: 0 };
  for (const m of staff) {
    const w = m.rating / 100 * 0.4; // un crack aporta hasta 0.4
    switch (m.role) {
      case "assistant_coach": e.trainingBoost += w; break;
      case "analyst": e.infoBoost += w; break;
      case "psychologist": e.mentalBoost += w; break;
      case "scout": e.scoutBoost += w; break;
      case "performance": e.fatigueBoost += w; break;
      case "manager": e.incomeBoost += w; break;
      case "content_manager": e.contentBoost += w; break;
      case "marketing_manager": e.marketingBoost += w; break;
      case "community_manager": e.communityBoost += w; break;
      case "sporting_director": e.commercialBoost += w * 0.6; e.scoutBoost += w * 0.4; break;
      case "ceo": e.commercialBoost += w; e.incomeBoost += w * 0.5; break;
    }
  }
  return e;
}

export function staffSalaries(staff: StaffMember[]): number {
  return staff.reduce((a, m) => a + m.salary, 0);
}

/** Genera candidatos de staff (uno por rol) deterministas para una temporada. Fase 5: perfil rico. */
export function generateStaffCandidates(seed: number, season: number, rng: Rng): StaffMember[] {
  return STAFF_ROLES.map((role, i) => {
    const rating = 45 + rng.int(0, 50);
    const potential = Math.min(99, rating + rng.int(0, 25));
    const seniorRoles: StaffRoleId[] = ["ceo", "sporting_director", "manager"];
    return {
      id: `staff:${role}:${season}:${seed % 1000}-${i}`,
      role,
      name: `${NAMES[rng.int(0, NAMES.length - 1)]} ${seniorRoles.includes(role) ? "Sr." : ""}`.trim(),
      rating,
      salary: Math.round((800 + rating * 30) * (seniorRoles.includes(role) ? 1.8 : 1)),
      experience: rng.int(0, 100),
      specialty: SPECIALTY[role],
      personality: STAFF_PERSONALITIES[rng.int(0, STAFF_PERSONALITIES.length - 1)],
      potential,
      prestige: Math.round(rating * 0.6 + rng.int(0, 30)),
      contractYears: 1 + rng.int(0, 2),
      history: [],
    };
  });
}

/** Contrata a un miembro (reemplaza al del mismo rol si existía). */
export function hireStaff(staff: StaffMember[], member: StaffMember): StaffMember[] {
  return [...staff.filter((m) => m.role !== member.role), member];
}
