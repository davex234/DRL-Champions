/** Instrumento: compra (sin abrir) un sobre para la persona QA. */
import { token, api } from "../_fase68-lib";
const t = await token(process.argv[2]!); const r = await api(t, "/api/game/packs", { action: "buy", packId: process.argv[3]!, ref: `p31-b-${Date.now()}` }, true);
console.log("buy", process.argv[3], r.status, JSON.stringify(r.json).slice(0, 120));
