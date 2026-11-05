/**
 * TACTICAL INTELLIGENCE ENGINE — Vocabulario de conceptos.
 *
 * La "biblioteca" que hace que la IA CONOZCA los conceptos de Valorant. Es DATA
 * declarativa: el planner compone estrategias a partir de estos átomos, y añadir un
 * concepto nuevo en el futuro = añadir una ficha aquí + (si hace falta) un assigner.
 * No hay estrategias completas hardcodeadas.
 */
import type { ConceptId, ConceptInfo } from "./types";

export const CONCEPTS: Record<ConceptId, ConceptInfo> = {
  // — Ataque —
  default: { id: "default", label: "Default", phase: "attack", summary: "Tomar control y espacio lentamente antes de comprometer." },
  contact: { id: "contact", label: "Contact play", phase: "attack", summary: "Avanzar a un carril a sacar info por contacto, sin util previa." },
  explode: { id: "explode", label: "Explode", phase: "attack", summary: "Comprometer a todo el equipo a un carril, rápido y con util." },
  split: { id: "split", label: "Split", phase: "attack", summary: "Atacar el sitio por dos carriles a la vez para coger crossfires." },
  fake: { id: "fake", label: "Fake", phase: "attack", summary: "Fingir un carril (cuerpos+util) y golpear por otro." },
  rehit: { id: "rehit", label: "Re-hit", phase: "attack", summary: "Tras un intento fallido, volver a golpear por otro ángulo." },
  lurk: { id: "lurk", label: "Lurk", phase: "attack", summary: "Un jugador se separa al flanco para cortar rotaciones / coger picks." },
  map_control: { id: "map_control", label: "Map control", phase: "attack", summary: "Ganar y mantener zonas neutrales (mid) antes del hit." },
  play_picks: { id: "play_picks", label: "Jugar para picks", phase: "attack", summary: "Pasivo: buscar una ventaja numérica antes de comprometer." },
  eco_rush: { id: "eco_rush", label: "Eco rush", phase: "attack", summary: "En eco, apilar un carril y entrar de golpe a corta distancia." },
  save: { id: "save", label: "Save", phase: "attack", summary: "Conservar armas: replegarse y no forzar una ronda perdida." },
  // — Defensa —
  spread: { id: "spread", label: "Spread", phase: "defense", summary: "Repartir holders por todos los carriles (default defensivo)." },
  stack: { id: "stack", label: "Stack", phase: "defense", summary: "Concentrar jugadores en un carril concreto (anti-strat)." },
  crossfire: { id: "crossfire", label: "Crossfire", phase: "defense", summary: "Dos holders cubriendo el mismo ángulo." },
  aggro_info: { id: "aggro_info", label: "Aggro info", phase: "defense", summary: "Asomar agresivo a un choke para sacar info temprana." },
  rotate: { id: "rotate", label: "Rotate", phase: "defense", summary: "Reaccionar al carril de contacto moviendo holders hacia él." },
  retake: { id: "retake", label: "Retake", phase: "defense", summary: "Recuperar el sitio tras el plant, de forma coordinada." },
  anchor: { id: "anchor", label: "Anchor", phase: "defense", summary: "Un jugador ancla el sitio y no rota pase lo que pase." },
  // — Economía / meta —
  force: { id: "force", label: "Force buy", phase: "economy", summary: "Compra forzada con poco dinero para no regalar la ronda." },
  bonus: { id: "bonus", label: "Bonus", phase: "economy", summary: "Ronda con armas conservadas tras un save." },
  anti_eco: { id: "anti_eco", label: "Anti-eco", phase: "economy", summary: "Vs eco rival: distancias largas, sin regalar duelos cortos." },
  conditioning: { id: "conditioning", label: "Conditioning", phase: "meta", summary: "Repetir un look para condicionar al rival y romperlo después." },
  anti_strat: { id: "anti_strat", label: "Anti-strat", phase: "meta", summary: "Contrarrestar el patrón detectado del rival." },
  adapt: { id: "adapt", label: "Adaptación", phase: "meta", summary: "Cambiar el plan en caliente según lo que funciona o falla." },
  timeout: { id: "timeout", label: "Timeout", phase: "meta", summary: "Parón táctico: reordenar el plan tras una mala racha." },
  trade: { id: "trade", label: "Trading", phase: "meta", summary: "Entrar en parejas para vengar (refrag) cada baja." },
  pick: { id: "pick", label: "Pick", phase: "meta", summary: "Forzar un duelo favorable para abrir la ronda." },
};

export const ATTACK_CONCEPTS: ConceptId[] = ["default", "contact", "explode", "split", "fake", "lurk", "eco_rush", "play_picks"];
export const DEFENSE_CONCEPTS: ConceptId[] = ["spread", "stack", "crossfire", "aggro_info", "anchor"];

export const conceptInfo = (id: ConceptId): ConceptInfo => CONCEPTS[id];
