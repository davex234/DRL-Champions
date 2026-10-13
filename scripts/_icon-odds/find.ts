import { CARDS, getPlayer } from "@/data/catalog";
for (const c of CARDS) if (["future-star","champions-s","record-breaker","moments"].includes(c.variantId)) { const p = getPlayer(c.playerId); console.log(c.id, c.variantId, c.ovr, p?.country); }
