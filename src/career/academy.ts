/**
 * MANAGER CAREER ENGINE · Fase 3 — academia del club.
 *
 * Cada temporada aparecen jóvenes con edad/región/rol/potencial/personalidad/ADN. NO se
 * inventa otro sistema: REUTILIZA el Player Development Engine (`deriveInnate`/`freshDevState`/
 * `scoutPlayer`/`progress`) y la valoración del mundo (`playerValue`). La calidad de la
 * cantera escala con la instalación de Academia. Determinista (Rng sembrado). Puro.
 */
import type { Region, RoleId } from "@/domain/cards/types";
import type { WorldPlayer } from "@/world";
import { deriveInnate, freshDevState, scoutPlayer, progress } from "@/development";
import { playerValue } from "@/world";
import type { ClubManagement, AcademyProspect, StaffProspect, StaffRoleId } from "./types";
import { facilityEffects } from "./facilities";
import { STAFF_PERSONALITIES } from "./staff";
import type { Rng } from "./rng";
import { ns } from "@/i18n/runtime";

const t = ns("career");

const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
/** La academia NO solo produce jugadores: también forma cuerpo técnico (Fase 5). */
const STAFF_GRADUATE_ROLES: StaffRoleId[] = ["assistant_coach", "analyst", "scout", "sporting_director"];
const SYL_A = ["zy", "ax", "ne", "vi", "kr", "lo", "ta", "qu", "ze", "mi", "ra", "su", "no", "ka", "fy", "ji"];
const SYL_B = ["ro", "ex", "us", "ko", "an", "il", "ow", "en", "ar", "ix", "om", "yn", "el", "ur", "ai", "ov"];

function genNick(rng: Rng): string {
  const n = SYL_A[rng.int(0, SYL_A.length - 1)] + SYL_B[rng.int(0, SYL_B.length - 1)];
  return n.charAt(0).toUpperCase() + n.slice(1) + (rng.chance(0.4) ? String(rng.int(10, 99)) : "");
}

/** Construye un WorldPlayer mínimo para valorar (reusa `playerValue`). */
function valueOfProspect(p: AcademyProspect): number {
  const wp: WorldPlayer = {
    id: p.id, nick: p.name, region: p.region, role: p.role, teamId: null,
    innate: p.innate, dev: p.dev, contract: null, status: "active",
    value: 0, titles: 0, mvps: 0, origin: "academy", prevValue: 0,
  };
  return playerValue(wp);
}

/** Genera la hornada de cantera de una temporada. Calidad ↑ con la instalación de Academia. */
export function generateAcademyIntake(mgmt: ClubManagement, region: Region, season: number, rng: Rng): AcademyProspect[] {
  const fx = facilityEffects(mgmt.facilities);
  const count = 1 + Math.floor(mgmt.facilities.academy / 2); // 1..3 según nivel
  const out: AcademyProspect[] = [];
  for (let i = 0; i < count; i++) {
    const id = `acad:${mgmt.clubId}:${season}:${i}`;
    const innate = deriveInnate(id);
    innate.startAge = 16 + rng.int(0, 2);
    // La academia sube el SUELO de potencial: mejores instalaciones ⇒ mejores promesas.
    innate.potential = Math.min(99, 60 + rng.int(0, 30) + Math.round(fx.academyQuality * 12));
    innate.growthRate = Math.round((0.8 + rng.next() * 0.7) * 100) / 100;
    innate.peakAge = 23 + rng.int(0, 3);
    innate.declineAge = innate.peakAge + 4 + rng.int(0, 2);
    const dev = freshDevState(innate);
    dev.age = innate.startAge;
    const prospect: AcademyProspect = {
      id, name: genNick(rng), age: innate.startAge, region,
      role: ROLES[rng.int(0, ROLES.length - 1)],
      innate, dev, scout: scoutPlayer(innate, dev),
      potential: innate.potential, rating: Math.round(progress(dev)), value: 0, signedSeason: season,
    };
    prospect.value = valueOfProspect(prospect);
    out.push(prospect);
  }
  return out;
}

/** Promociona una promesa al primer equipo: la quita de la academia y la devuelve. */
export function promoteProspect(mgmt: ClubManagement, prospectId: string): { management: ClubManagement; prospect: AcademyProspect } | null {
  const prospect = mgmt.academy.find((p) => p.id === prospectId);
  if (!prospect) return null;
  return { management: { ...mgmt, academy: mgmt.academy.filter((p) => p.id !== prospectId) }, prospect };
}

const STAFF_NAMES = ["Ivanov", "Choi", "Weber", "Ortiz", "Nord", "Aziz", "Blom", "Cruz", "Yun", "Rask"];

/**
 * La academia forma CUERPO TÉCNICO (Fase 5): coaches, analistas, scouts, directores deportivos.
 * Cantidad/calidad escalan con la instalación de Academia. Determinista.
 */
export function generateAcademyStaff(mgmt: ClubManagement, season: number, rng: Rng): StaffProspect[] {
  const fx = facilityEffects(mgmt.facilities);
  // Solo con academia decente aparecen técnicos (0..2 por temporada).
  const count = mgmt.facilities.academy >= 3 ? 1 + (rng.chance(fx.academyQuality * 0.6) ? 1 : 0) : rng.chance(0.35) ? 1 : 0;
  const out: StaffProspect[] = [];
  for (let i = 0; i < count; i++) {
    const role = STAFF_GRADUATE_ROLES[rng.int(0, STAFF_GRADUATE_ROLES.length - 1)];
    const rating = 40 + rng.int(0, 25) + Math.round(fx.academyQuality * 15);
    out.push({
      id: `acadstaff:${mgmt.clubId}:${season}:${i}`,
      name: STAFF_NAMES[rng.int(0, STAFF_NAMES.length - 1)],
      role,
      rating: Math.min(85, rating),
      potential: Math.min(99, rating + rng.int(10, 35)),
      personality: STAFF_PERSONALITIES[rng.int(0, STAFF_PERSONALITIES.length - 1)],
      signedSeason: season,
    });
  }
  return out;
}

/** Asciende un técnico de la academia al staff del club (barato, con salario de proyección). */
export function promoteStaffProspect(mgmt: ClubManagement, prospectId: string): { management: ClubManagement; member: import("./types").StaffMember } | null {
  const p = (mgmt.academyStaff ?? []).find((x) => x.id === prospectId);
  if (!p) return null;
  const member = {
    id: `staff:${p.role}:${p.id}`, role: p.role, name: p.name, rating: p.rating,
    salary: Math.round(600 + p.rating * 22), experience: 10, specialty: t("cantera propia"),
    personality: p.personality, potential: p.potential, prestige: Math.round(p.rating * 0.5),
    contractYears: 3, history: [t("Formado en la academia (T{signedSeason})", { signedSeason: p.signedSeason })],
  };
  return { management: { ...mgmt, academyStaff: (mgmt.academyStaff ?? []).filter((x) => x.id !== prospectId) }, member };
}
