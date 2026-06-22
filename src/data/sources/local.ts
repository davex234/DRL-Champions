import type { PlayerSource } from "./types";
import { PLAYERS } from "@/data/players";

/** Fuente por defecto: datos semilla curados incluidos en el repositorio. */
export const localSource: PlayerSource = {
  id: "local",
  label: "Datos semilla",
  load: async () => PLAYERS,
};
