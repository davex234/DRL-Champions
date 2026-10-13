"use client";

/**
 * FASE 41 · LLAMADA A LA ACCIÓN DE LA FICHA DE SOBRE (presentación pura).
 *
 * Extraída de `/packs/[packId]` para que la ficha y el arnés `/design-system/fase41` pinten EXACTAMENTE lo mismo. No
 * compra ni decide nada: recibe saldo, sobres poseídos y, para el Sobre Inicial, la oferta que traduce la respuesta del
 * servidor (`starterOffer`). Cuando falta saldo ya no manda a una tienda de créditos (cerrada): señala cómo se ganan.
 */
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { formatCredits } from "@/lib/format";
import type { PackDef } from "@/domain/packs/types";
import type { StarterOffer } from "@/lib/economy/starterOffer";

export type PackCtaKind = "buy" | "event" | string;

export function packCtaState(i: { pack: Pick<PackDef, "price">; cta: PackCtaKind; credits: number; owned: number; offer: StarterOffer | null }) {
  const gratis = i.pack.price <= 0;
  const insufficient = i.cta === "buy" && !gratis && i.credits < i.pack.price && i.owned === 0;
  const label = i.offer ? i.offer.cta
    : i.cta === "event" ? "Ver en eventos"
    : i.owned > 0 ? "Abrir sobre"
    : gratis ? "Abrir gratis"
    : insufficient ? "Créditos insuficientes"
    : "Comprar y abrir";
  const disabled = insufficient || (i.offer !== null && !i.offer.enabled);
  return { gratis, insufficient, label, disabled, missing: insufficient ? i.pack.price - i.credits : 0 };
}

export function PackPurchaseCta(props: {
  pack: Pick<PackDef, "price">; cta: PackCtaKind; credits: number; owned: number; offer: StarterOffer | null; busy: boolean; onAction: () => void;
}) {
  const s = packCtaState(props);
  return (
    <div className="mt-7" data-testid="pack-cta" data-state={props.offer?.kind ?? (s.insufficient ? "insufficient" : props.owned > 0 ? "owned" : props.cta)}>
      {/* F86.2 · sin sesión, «Inicia sesión» lleva a la cuenta (antes era un botón desactivado: una llamada muerta). */}
      {props.offer?.kind === "offline" ? (
        <NxButton variant="primary" size="lg" href="/cuenta" data-testid="pack-cta-login">{s.label}</NxButton>
      ) : (
        <NxButton variant="primary" size="lg" onClick={props.onAction} disabled={props.busy || s.disabled} aria-busy={props.busy}>
          {props.busy ? "Procesando…" : s.label}
        </NxButton>
      )}
      {props.offer?.note && (
        <p className="mt-2 max-w-md text-caption text-ink-muted" data-testid="starter-offer-note" data-kind={props.offer.kind}>{props.offer.note}</p>
      )}
      {s.insufficient && (
        <p className="mt-2 max-w-md text-caption text-ink-muted" data-testid="pack-insufficient">
          Te faltan {formatCredits(s.missing)} créditos. Se ganan jugando: partidas, misiones, logros y eventos.{" "}
          <Link href="/logros" className="nx-focus text-cyan-300 underline">Ver misiones</Link>
        </p>
      )}
      {props.cta === "event" && (
        <p className="mt-2 text-caption text-ink-muted">Este sobre se obtiene en el Centro de Eventos, no se compra aquí.</p>
      )}
    </div>
  );
}
