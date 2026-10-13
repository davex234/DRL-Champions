"use client";

/**
 * MIS EQUIPOS (Fase 32) — el hub: ACTIVO arriba, OTROS debajo, CREAR siempre a mano.
 *
 * El estado de cada equipo lo decidió el servidor (`valid`, `status`, `errors`, `active`). La vista
 * previa son las TRES cartas de mayor OVR (DuelCard ligera; Card3D solo en el equipo activo) y la
 * composición por rol en pips: no se pintan diez cartas ricas por equipo.
 *
 * Los textos «+ Nuevo equipo», «Crear mi primer equipo» y «Listo para duelo» son los que leen las
 * verificaciones en navegador.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "@/domain/cardgame";
import { getVariant } from "@/domain/cards/variants";
import { roleCount } from "@/domain/deckBuilder/builder";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { deckReadiness } from "@/lib/duel/gameplayUx";
import { Card3D } from "@/components/visual/Card3D";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Stage, Plate } from "@/components/ui/Surface";
import { DuelCard } from "../DuelCard";
import { fmtEdited } from "./bits";

export interface TeamHubProps {
  decks: DuelDeckDTO[];
  activeDeckId: string | null;
  activeSupported: boolean;
  maxDecks: number;
  collectionCount: number;
  unopenedPacks: number;
  now: number;
  busyId: string | null;
  onCreate: () => void;
  onEdit: (d: DuelDeckDTO) => void;
  onActivate: (d: DuelDeckDTO) => void;
  onDuplicate: (d: DuelDeckDTO) => void;
  onRename: (d: DuelDeckDTO) => void;
  onDelete: (d: DuelDeckDTO) => void;
  /** Fase 43 · comparar dos equipos propios (sin ganador). */
  onCompare?: () => void;
}

const RULES = `${DUEL_DECK_SIZE} cartas · ${DUEL_ROLES.map((r) => roleCount(DUEL_COMPOSITION[r], r)).join(", ")} · sin repetir jugador`;

const top3 = (d: DuelDeckDTO) => [...d.cards].sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick)).slice(0, 3);
const avgOvr = (d: DuelDeckDTO) => (d.cards.length ? Math.round((d.cards.reduce((s, c) => s + c.ovr, 0) / d.cards.length) * 10) / 10 : null);
const statusLabel = (d: DuelDeckDTO) => (d.valid ? "Listo para duelo" : d.status === "INCOMPLETE" || d.status === "EMPTY" ? "Incompleto" : "Revisar");

export function TeamHub(p: TeamHubProps) {
  const active = p.decks.find((d) => d.id === p.activeDeckId) ?? null;
  const others = p.decks.filter((d) => d.id !== active?.id);
  const ready = p.decks.filter((d) => d.valid).length;
  const atMax = p.decks.length >= p.maxDecks;

  return (
    <div className="mx-auto max-w-6xl" data-scene="team-hub">
      <header className="mb-5">
        <Link href="/duelos" className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition hover:bg-white/[0.06] hover:text-white">
          ‹ Duelos
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <span className="nx-label">Nexus Team Builder</span>
            <h1 className="font-display text-[clamp(28px,4.6vw,44px)] font-bold uppercase leading-none text-white">Mis equipos</h1>
            <p className="mt-1.5 text-body text-ink-muted">{RULES}</p>
          </div>
          {p.decks.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              <Plate className="flex items-center gap-4 px-4 py-2.5">
                <span className="text-caption text-ink-muted">Equipos <b className="nx-readout text-[18px] text-white">{p.decks.length}</b>/{p.maxDecks}</span>
                <span className="text-caption text-ink-muted">Listos <b className="nx-readout text-[18px] text-ok">{ready}</b></span>
              </Plate>
              {p.onCompare && <NxButton variant="secondary" size="md" onClick={p.onCompare} data-testid="compare-decks">Comparar equipos</NxButton>}
              <NxButton variant="secondary" size="md" onClick={p.onCreate} disabled={atMax}>+ Nuevo equipo</NxButton>
            </div>
          )}
        </div>
        {atMax && <p className="mt-2 text-caption text-drl-gold">Has llegado al máximo de {p.maxDecks} equipos. Borra o reutiliza uno para crear otro.</p>}
      </header>

      {p.decks.length === 0 ? (
        <FirstTeam collectionCount={p.collectionCount} unopenedPacks={p.unopenedPacks} onCreate={p.onCreate} />
      ) : (
        <>
          {active ? (
            <ActiveSpotlight deck={active} now={p.now} busy={p.busyId === active.id} onEdit={p.onEdit} onDuplicate={p.onDuplicate} onRename={p.onRename} onDelete={p.onDelete} />
          ) : (
            <Plate className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-l-drl-gold px-4 py-3" role="status" data-testid="no-active">
              <span aria-hidden className="text-lg text-drl-gold">◎</span>
              <p className="min-w-0 flex-1 text-body text-ink-secondary">
                {!p.activeSupported
                  ? "Elegir equipo activo todavía no está disponible en este servidor. Mientras, al jugar se propone tu primer equipo listo."
                  : ready > 0
                    ? "No tienes equipo activo. Activa uno listo y será el que propongan la pre-partida, el PvP y los retos."
                    : "Aún no tienes equipo activo: cuando completes un equipo podrás activarlo."}
              </p>
            </Plate>
          )}

          <section aria-labelledby="teams-others">
            <h2 id="teams-others" className="mb-2 font-display text-h3 font-bold uppercase tracking-wide text-white">
              {active ? "Otros equipos" : "Tus equipos"}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {others.map((d) => (
                <DeckTile
                  key={d.id}
                  deck={d}
                  now={p.now}
                  busy={p.busyId === d.id}
                  canActivate={p.activeSupported && d.valid}
                  onEdit={p.onEdit}
                  onActivate={p.onActivate}
                  onDuplicate={p.onDuplicate}
                  onRename={p.onRename}
                  onDelete={p.onDelete}
                />
              ))}
              {!atMax && (
                <button
                  type="button"
                  onClick={p.onCreate}
                  className="nx-focus nx-clip flex min-h-[180px] flex-col items-center justify-center gap-2 border-2 border-dashed border-white/15 bg-white/[0.015] p-4 text-center transition hover:border-drl-cyan/60 hover:bg-drl-cyan/[0.04]"
                >
                  <span aria-hidden className="font-display text-4xl leading-none text-drl-cyan">+</span>
                  <span className="font-display text-body font-bold uppercase tracking-wide text-white">Crear equipo</span>
                  <span className="text-caption text-ink-faint">{p.decks.length}/{p.maxDecks} usados</span>
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FirstTeam({ collectionCount, unopenedPacks, onCreate }: { collectionCount: number; unopenedPacks: number; onCreate: () => void }) {
  const enough = collectionCount >= DUEL_DECK_SIZE;
  const steps = [
    { n: 1, title: "Consigue cartas", body: enough ? `Tienes ${collectionCount}: suficientes para un equipo.` : `Tienes ${collectionCount} de ${DUEL_DECK_SIZE}.`, done: enough },
    { n: 2, title: "Crea tu equipo", body: "Diez huecos, agrupados por rol.", done: false },
    { n: 3, title: "Completa los roles", body: DUEL_ROLES.map((r) => roleCount(DUEL_COMPOSITION[r], r)).join(" · "), done: false },
    { n: 4, title: "Juega", body: "PvE, PvP o un reto a un amigo.", done: false },
  ];
  return (
    <Stage className="flex flex-col items-center gap-4 px-6 py-10 text-center" data-testid="first-team">
      <p className="font-display text-h2 font-bold uppercase tracking-wide text-white">Todavía no tienes ningún equipo</p>
      <ol className="grid w-full max-w-3xl gap-2 text-left sm:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className={cn("nx-clip-sm border px-3 py-2.5", s.done ? "border-ok/40 bg-ok/[0.06]" : "border-white/10 bg-white/[0.03]")}>
            <span className={cn("font-display text-[12px] font-bold", s.done ? "text-ok" : "text-drl-cyan")}>{s.done ? "✓" : s.n}</span>
            <p className="font-display text-[13px] font-bold uppercase text-white">{s.title}</p>
            <p className="text-[11.5px] leading-snug text-ink-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <NxButton variant="primary" size="lg" onClick={onCreate}>Crear mi primer equipo</NxButton>
      {!enough && (
        <Link href={unopenedPacks > 0 ? "/inventario" : "/tienda"} className="nx-action inline-flex min-h-[44px] items-center">
          {unopenedPacks > 0 ? `Abrir mis ${unopenedPacks} ${unopenedPacks === 1 ? "sobre" : "sobres"} →` : "Conseguir un sobre →"}
        </Link>
      )}
    </Stage>
  );
}

function RolePips({ deck }: { deck: DuelDeckDTO }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Composición por rol">
      {DUEL_ROLES.map((r) => {
        const have = deck.roleCounts[r] ?? 0;
        const need = DUEL_COMPOSITION[r];
        return (
          <span key={r} className="flex items-center gap-1" title={`${r}: ${have}/${need}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{r.slice(0, 3)}</span>
            {Array.from({ length: need }, (_, i) => (
              <i key={i} aria-hidden className={cn("h-1.5 w-3 rounded-full", i < have ? (have > need ? "bg-bad" : "bg-ok") : "bg-white/12")} />
            ))}
            <span className="sr-only">{r} {have} de {need}</span>
          </span>
        );
      })}
    </div>
  );
}

function ActiveSpotlight({ deck, now, busy, onEdit, onDuplicate, onRename, onDelete }: {
  deck: DuelDeckDTO; now: number; busy: boolean;
  onEdit: (d: DuelDeckDTO) => void; onDuplicate: (d: DuelDeckDTO) => void; onRename: (d: DuelDeckDTO) => void; onDelete: (d: DuelDeckDTO) => void;
}) {
  const r = deckReadiness(deck);
  const avg = avgOvr(deck);
  return (
    <Stage tone={deck.valid ? "success" : "neutral"} className="mb-5 p-4 sm:p-6" data-testid="active-team" data-deck={deck.id}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info" solid>Equipo activo</Badge>
            <Badge tone={deck.valid ? "ok" : "warn"}>{statusLabel(deck)}</Badge>
          </div>
          <h2 className="mt-2 truncate font-display text-[clamp(24px,3.6vw,36px)] font-bold uppercase leading-none text-white">{deck.name}</h2>
          <p className="mt-1 text-caption text-ink-muted">
            <span className="nx-readout text-ink-secondary">{deck.cardUids.length}</span>/{DUEL_DECK_SIZE} cartas · OVR medio <span className="nx-readout text-ink-secondary">{avg ?? "—"}</span> · {fmtEdited(deck.updatedAt, now)}
          </p>
          {!deck.valid && <p className="mt-1 text-caption text-drl-gold">{r.summary}. Mientras no esté listo no se propondrá para jugar.</p>}
          <div className="mt-3"><RolePips deck={deck} /></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Fase 44 · JUGAR CON ESTE EQUIPO es la única acción dominante del hub (nuevo equipo y activar pasan a secundarias). */}
            {deck.valid && <NxButton variant="primary" size="lg" href={`/duelos/jugar?deck=${deck.id}`} data-cta="primary" aria-label={`Jugar con ${deck.name}`}>Jugar</NxButton>}
            <NxButton variant={deck.valid ? "secondary" : "primary"} size="md" onClick={() => onEdit(deck)} disabled={busy}>Editar equipo</NxButton>
            <NxButton variant="ghost" size="md" onClick={() => onDuplicate(deck)} disabled={busy}>Duplicar</NxButton>
            <NxButton variant="ghost" size="md" onClick={() => onRename(deck)} disabled={busy}>Renombrar</NxButton>
            <NxButton variant="ghost" size="md" onClick={() => onDelete(deck)} disabled={busy} aria-label={`Eliminar ${deck.name}`}>Eliminar</NxButton>
          </div>
        </div>
        <div className="flex justify-center gap-2 sm:gap-3" aria-label="Cartas destacadas">
          {top3(deck).map((c) => (
            <Card3D key={c.uid} mode="hover" tilt={8} glow={getVariant(c.variantId).palette.primary} className="w-[88px] sm:w-[116px]">
              <DuelCard card={c} size="md" className="!w-full" />
            </Card3D>
          ))}
          {deck.cards.length === 0 && <span className="text-caption text-ink-faint">Sin cartas todavía</span>}
        </div>
      </div>
    </Stage>
  );
}

function DeckTile({ deck, now, busy, canActivate, onEdit, onActivate, onDuplicate, onRename, onDelete }: {
  deck: DuelDeckDTO; now: number; busy: boolean; canActivate: boolean;
  onEdit: (d: DuelDeckDTO) => void; onActivate: (d: DuelDeckDTO) => void; onDuplicate: (d: DuelDeckDTO) => void;
  onRename: (d: DuelDeckDTO) => void; onDelete: (d: DuelDeckDTO) => void;
}) {
  const r = deckReadiness(deck);
  const lost = deck.errors.some((e) => e.code === "CARD_NOT_OWNED" || e.code === "CARD_NOT_FOUND");
  return (
    <article
      data-deck={deck.id}
      data-valid={deck.valid}
      className={cn("nx-clip flex flex-col border p-4", deck.valid ? "border-ok/30 bg-ok/[0.035]" : "border-white/10 bg-white/[0.03]")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-h3 font-bold uppercase tracking-wide text-white">{deck.name}</h3>
          <p className="text-caption text-ink-faint">
            <span className="nx-readout text-ink-secondary">{deck.cardUids.length}</span>/{DUEL_DECK_SIZE} cartas · {fmtEdited(deck.updatedAt, now)}
          </p>
        </div>
        <span className="shrink-0"><Badge tone={deck.valid ? "ok" : "warn"}>{statusLabel(deck)}</Badge></span>
      </div>

      <div className="mt-3 flex gap-2">
        {top3(deck).map((c) => (
          <span key={c.uid} className="w-[64px] shrink-0"><DuelCard card={c} size="sm" className="!w-full" /></span>
        ))}
        {Array.from({ length: Math.max(0, 3 - deck.cards.length) }, (_, i) => (
          <span key={`e-${i}`} aria-hidden className="block aspect-[5/7] w-[64px] shrink-0 rounded-xl border border-dashed border-white/12" />
        ))}
      </div>
      <div className="mt-3"><RolePips deck={deck} /></div>
      {!deck.valid && (
        <p className={cn("mt-2 text-[12px]", lost ? "text-drl-gold" : "text-ink-secondary")}>
          {lost ? "Una carta de este equipo ya no está disponible." : r.summary}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        <NxButton variant={deck.valid ? "secondary" : "primary"} size="sm" onClick={() => onEdit(deck)} disabled={busy}>Editar</NxButton>
        {canActivate && <NxButton variant="secondary" size="sm" onClick={() => onActivate(deck)} disabled={busy} aria-busy={busy}>Activar</NxButton>}
        {deck.valid && <NxButton variant="ghost" size="sm" href={`/duelos/jugar?deck=${deck.id}`}>Jugar</NxButton>}
        <NxButton variant="ghost" size="sm" onClick={() => onDuplicate(deck)} disabled={busy}>Duplicar</NxButton>
        <NxButton variant="ghost" size="sm" onClick={() => onRename(deck)} disabled={busy}>Renombrar</NxButton>
        <NxButton variant="ghost" size="sm" onClick={() => onDelete(deck)} disabled={busy} aria-label={`Eliminar ${deck.name}`}>Eliminar</NxButton>
      </div>
    </article>
  );
}
