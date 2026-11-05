import { MAIN_PACK_LINE, mainPackDistribution } from "@/domain/packs/packClass";
for (const id of MAIN_PACK_LINE) console.log(id, JSON.stringify(Object.fromEntries(Object.entries(mainPackDistribution(id)!).map(([k, v]) => [k, (Math.round(v * 10) / 10).toLocaleString("es-ES")]))));
