/**
 * FASE 41 · CÓMO SE ENSEÑA EL SOBRE INICIAL GRATIS (presentación pura).
 *
 * La decisión la toma el servidor (`GET /api/game/packs?starter=1` → `readStarterStatus`). Aquí solo se traduce a una
 * llamada a la acción honesta: nunca se ofrece «gratis» algo que el servidor va a rechazar, y si ya no hace falta se
 * dice por qué y se señala la ruta que sí existe (sobres de pago con créditos ganados jugando).
 */
import type { StarterStatus } from "@/server/services/starter";
import { STARTER_COPY } from "@/domain/economy/starter";
import { ns, td } from "@/i18n/runtime";

const t = ns("economy");

export type StarterOfferKind = "open-owned" | "claim" | "not-needed" | "has-unopened" | "cap" | "checking" | "offline";

export interface StarterOffer {
  kind: StarterOfferKind;
  /** Texto del botón. */
  cta: string;
  /** ¿Se puede pulsar? */
  enabled: boolean;
  /** Frase bajo el botón (o `null`). */
  note: string | null;
  /** Precio que se enseña (el Sobre Inicial nunca se vende: o es gratis por asistencia, o no está disponible). */
  priceLabel: string;
}

export function starterOffer(input: { owned: number; online: boolean; status: StarterStatus | null | undefined }): StarterOffer {
  if (input.owned > 0) {
    return { kind: "open-owned", cta: t("Abrir sobre"), enabled: true, note: null, priceLabel: "Gratis" };
  }
  if (!input.online) {
    return { kind: "offline", cta: t("Inicia sesión"), enabled: false, note: t("El Sobre Inicial gratis lo concede el servidor a cuentas que aún no pueden formar su plantilla."), priceLabel: "Gratis" };
  }
  const s = input.status;
  if (s === undefined) return { kind: "checking", cta: t("Comprobando…"), enabled: false, note: null, priceLabel: "Gratis" };
  if (s === null) return { kind: "checking", cta: t("No disponible ahora"), enabled: false, note: t("No se pudo comprobar si te corresponde. Vuelve a intentarlo."), priceLabel: "Gratis" };
  if (s.eligible) {
    const missing = s.missingRoles.map((r) => `${r.role} ${r.have}/${r.need}`).join(" · ");
    return { kind: "claim", cta: t("Conseguir Sobre Inicial gratis"), enabled: true, note: `${STARTER_COPY.collect}${missing ? t(" Te faltan: {missing}.", { missing: td(missing) }) : ""}`, priceLabel: "Gratis" };
  }
  switch (s.reason) {
    case "HAS_UNOPENED_STARTER": return { kind: "has-unopened", cta: t("Abrir sobre"), enabled: true, note: STARTER_COPY.claimed, priceLabel: "Gratis" };
    case "CLAIM_CAP": return { kind: "cap", cta: t("No disponible"), enabled: false, note: t("{cap} Consigue créditos jugando y abre un Sobre Estándar.", { cap: td(STARTER_COPY.cap) }), priceLabel: t("No disponible") };
    default: return { kind: "not-needed", cta: t("Ya no es necesario"), enabled: false, note: STARTER_COPY.notNeeded, priceLabel: t("No disponible") };
  }
}
