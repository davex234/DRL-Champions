/** FASE 51.2 · Los doce grafos de navegación, uno por mapa del catálogo (generados). */
import type { MapNavigationGraph } from "../types";
import { ABYSS_NAV } from "./abyss";
import { ASCENT_NAV } from "./ascent";
import { BIND_NAV } from "./bind";
import { BREEZE_NAV } from "./breeze";
import { CORRODE_NAV } from "./corrode";
import { FRACTURE_NAV } from "./fracture";
import { HAVEN_NAV } from "./haven";
import { ICEBOX_NAV } from "./icebox";
import { LOTUS_NAV } from "./lotus";
import { PEARL_NAV } from "./pearl";
import { SPLIT_NAV } from "./split";
import { SUNSET_NAV } from "./sunset";

export const NAV_GRAPHS: Readonly<Record<string, MapNavigationGraph>> = {
  abyss: ABYSS_NAV,
  ascent: ASCENT_NAV,
  bind: BIND_NAV,
  breeze: BREEZE_NAV,
  corrode: CORRODE_NAV,
  fracture: FRACTURE_NAV,
  haven: HAVEN_NAV,
  icebox: ICEBOX_NAV,
  lotus: LOTUS_NAV,
  pearl: PEARL_NAV,
  split: SPLIT_NAV,
  sunset: SUNSET_NAV,
};
