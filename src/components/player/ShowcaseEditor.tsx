"use client";

/**
 * EDITAR PERFIL (Fase 31 · F82 insignias · F89 equipo favorito): vitrina, logros destacados, insignias, equipo
 * favorito y avatar, en una hoja accesible (móvil: hoja
 * inferior; escritorio: diálogo). Todo con botones reales —subir, bajar, quitar—, sin arrastrar.
 *
 * Las cartas salen de la colección REAL del jugador a través del motor existente
 * (`CollectionEngine.ownedViews` + `applyFilter` + `instancesOf`): no hay una segunda colección.
 * Si una carta tiene varias copias, se abre el selector de instancia para elegir CUÁL se expone
 * (serie, variante, fecha de obtención). El guardado lo valida el servidor: propiedad de cada UID,
 * logros reclamados y versión (dos pestañas no se pisan).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CollectionEngine, applyFilter } from "@/collection";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { OwnedCard, RoleId, VariantId } from "@/domain/cards/types";
import { bucketForRank, BUCKET_LABEL, type RarityBucket } from "@/domain/packs/types";
import { instancesOf } from "@/domain/collection/showcase";
import { SHOWCASE_MAX, FEATURED_MAX, sameList, type AchievementFact } from "@/domain/profile/identity";
import { AVATARS } from "@/domain/profile/avatars";
import { CardThumb } from "@/components/cards/CardThumb";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ProfileButton, fmtDay, serialText, RARITY_TONE, TeamMark } from "./bits";
import { playerMessage } from "@/components/ui/game/GameStates";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import type { BadgeFact } from "@/domain/collectionSets/badges";
import type { FavoriteTeamFact } from "@/domain/profile/favoriteTeam";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("player");

const BADGES_MAX = 3;

export type EditorTab = "cards" | "achievements" | "badges" | "team" | "avatar";

export interface ShowcaseEditorProps {
  open: boolean;
  tab: EditorTab;
  onTab: (t: EditorTab) => void;
  onClose: () => void;
  owned: OwnedCard[];
  initialUids: string[];
  claimed: AchievementFact[];
  initialFeatured: string[];
  avatar: string;
  busy: boolean;
  error: string | null;
  onSaveShowcase: (uids: string[]) => void;
  onSaveFeatured: (ids: string[]) => void;
  onSaveAvatar: (avatar: string) => void;
  /** F82 · insignias propias (solo desbloqueadas) y las destacadas (hasta 3, en orden). */
  badges?: BadgeFact[];
  initialBadges?: string[];
  onSaveBadges?: (ids: string[]) => void;
  /** F89 · equipo favorito: opciones REALES (identidades de equipo del catálogo), el actual y el guardado. */
  teamOptions?: FavoriteTeamFact[];
  initialTeam?: string | null;
  onSaveTeam?: (teamId: string | null) => void;
  /** Solo arnés QA: abre el selector de instancia de esta carta. */
  initialPicker?: string | null;
}

const ROLES: RoleId[] = ["Duelista", "Iniciador", "Controlador", "Centinela", "Flex"];
const BUCKETS: RarityBucket[] = ["legendary", "epic", "rare", "uncommon", "common"];
const PAGE = 48;

const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export function ShowcaseEditor(props: ShowcaseEditorProps) {
  useLocale();
  const { open, tab, onTab, onClose, owned, busy, error } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [uids, setUids] = useState<string[]>(props.initialUids);
  const [featured, setFeatured] = useState<string[]>(props.initialFeatured);
  const [badgeSel, setBadgeSel] = useState<string[]>(props.initialBadges ?? []);
  const [favTeam, setFavTeam] = useState<string | null>(props.initialTeam ?? null);
  const [teamQuery, setTeamQuery] = useState("");
  const [text, setText] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState<RoleId | "">("");
  const [rarity, setRarity] = useState<RarityBucket | "">("");
  const [dups, setDups] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [picker, setPicker] = useState<string | null>(props.initialPicker ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUids(props.initialUids); setFeatured(props.initialFeatured); setBadgeSel(props.initialBadges ?? []); setFavTeam(props.initialTeam ?? null); setTeamQuery(""); setNotice(null);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (picker) setPicker(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const views = useMemo(() => new CollectionEngine(owned).ownedViews(), [owned]);
  const byUid = useMemo(() => new Map(owned.map((o) => [o.uid.toLowerCase(), o])), [owned]);
  const teams = useMemo(() => [...new Set(views.map((v) => v.team).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [views]);
  const filtered = useMemo(() => {
    const base = applyFilter(views, { text: text || undefined, roles: role ? [role] : undefined, owned: true });
    return base
      .filter((v) => (!team || v.team === team) && (!rarity || bucketForRank(v.rank) === rarity) && (!dups || v.count > 1))
      .sort((a, b) => b.rank - a.rank || b.ovr - a.ovr || a.nick.localeCompare(b.nick));
  }, [views, text, team, role, rarity, dups]);

  if (!open) return null;

  const selectedCards = new Set(uids.map((u) => byUid.get(u.toLowerCase())?.cardId).filter(Boolean));
  const toggleInstance = (uid: string, cardId: string) => {
    setNotice(null);
    const key = uid.toLowerCase();
    if (uids.some((u) => u.toLowerCase() === key)) { setUids(uids.filter((u) => u.toLowerCase() !== key)); return; }
    // Otra copia de la MISMA carta ya expuesta: se sustituye en su slot (una carta, una copia).
    const sameCardIdx = uids.findIndex((u) => byUid.get(u.toLowerCase())?.cardId === cardId);
    if (sameCardIdx >= 0) { const next = [...uids]; next[sameCardIdx] = uid; setUids(next); return; }
    if (uids.length >= SHOWCASE_MAX) { setNotice(tr("Tu vitrina ya tiene {SHOWCASE_MAX} cartas: quita una para añadir otra.", { SHOWCASE_MAX })); return; }
    setUids([...uids, uid]);
  };
  const onCard = (cardId: string) => {
    const copies = instancesOf(owned, cardId);
    if (copies.length === 1) toggleInstance(copies[0].uid, cardId);
    else if (copies.length > 1) setPicker(cardId);
  };

  const pickerDef = picker ? getCard(picker) : null;
  const pickerCopies = picker ? instancesOf(owned, picker) : [];

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} data-scene="profile-editor" data-tab={tab}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-editor-title"
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl border border-white/12 bg-[#0b0e17] shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[min(96vw,980px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-5 pb-3 pt-3 sm:px-7 sm:pt-5">
          <div>
            <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
            <span className="nx-label">{tr("Tu perfil de jugador")}</span>
            <h2 id="profile-editor-title" className="font-display text-h2 font-bold uppercase tracking-wide text-white">{tr("Editar perfil")}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={tr("Cerrar")} className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white">✕</button>
        </header>

        <div role="tablist" aria-label={tr("Qué editar")} className="flex gap-1 overflow-x-auto border-b border-white/[0.08] px-5 sm:px-7">
          {([["cards", tr("Vitrina")], ["achievements", tr("Logros")], ...(props.onSaveBadges ? [["badges", tr("Insignias")]] : []), ...(props.onSaveTeam ? [["team", tr("Equipo favorito")]] : []), ["avatar", tr("Avatar")]] as [EditorTab, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} data-tab={id}
              className={`nx-focus relative inline-flex min-h-[44px] items-center px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] ${tab === id ? "text-white" : "text-white/50 hover:text-white/80"}`}>
              {td(label)}{tab === id && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-drl" />}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7" role="tabpanel">
          {tab === "cards" && (
            <div className="space-y-4" data-testid="editor-cards">
              <ol className="grid gap-2 sm:grid-cols-3" aria-label={tr("Tus slots de vitrina")}>
                {Array.from({ length: SHOWCASE_MAX }, (_, i) => {
                  const inst = uids[i] ? byUid.get(uids[i].toLowerCase()) : undefined;
                  const def = inst ? getCard(inst.cardId) : null;
                  const variant = def ? getVariant(def.variantId as VariantId) : null;
                  return (
                    <li key={i} className={`nx-clip-sm flex items-center gap-3 border px-3 py-2 ${i === 0 ? "border-drl-gold/40 bg-drl-gold/[0.05]" : "border-white/10 bg-white/[0.02]"}`} data-slot={i + 1} data-uid={inst?.uid ?? ""}>
                      {def ? <CardThumb card={def} width={48} /> : <span aria-hidden className="grid h-[67px] w-12 place-items-center border border-dashed border-white/15 text-white/25">+</span>}
                      <div className="min-w-0 flex-1">
                        <span className="nx-label">{i === 0 ? tr("Slot 1 · destacada") : tr("Slot {v}", { v: i + 1 })}</span>
                        {def && inst ? (
                          <>
                            <span className="block truncate font-display text-[13px] font-bold uppercase text-white">{getPlayer(def.playerId)?.nick ?? def.playerId}</span>
                            <span className="block text-[11px] text-white/50">{td(variant?.label)} · {serialText(inst.serial ?? null, variant?.serialLimit ?? null)}</span>
                          </>
                        ) : <span className="block text-[12px] text-white/40">{tr("Vacío")}</span>}
                      </div>
                      {inst && (
                        <div className="flex flex-col gap-1">
                          <button type="button" onClick={() => setUids(move(uids, i, -1))} disabled={i === 0} aria-label={tr("Subir slot {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-white/70 disabled:opacity-30">↑</button>
                          <button type="button" onClick={() => setUids(move(uids, i, 1))} disabled={i >= uids.length - 1} aria-label={tr("Bajar slot {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-white/70 disabled:opacity-30">↓</button>
                        </div>
                      )}
                      {inst && <button type="button" onClick={() => setUids(uids.filter((_, k) => k !== i))} aria-label={tr("Quitar slot {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-drl">✕</button>}
                    </li>
                  );
                })}
              </ol>
              {notice && <p role="status" className="text-caption text-drl-gold">{td(notice)}</p>}

              <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]" data-testid="editor-filters">
                <label className="sr-only" htmlFor="showcase-search">{tr("Buscar carta")}</label>
                <input id="showcase-search" type="search" value={text} onChange={(e) => { setText(e.target.value); setShown(PAGE); }} placeholder={tr("Buscar jugador, equipo o variante…")} className="nx-focus nx-clip-sm min-h-[44px] border border-white/12 bg-white/[0.04] px-3 text-body text-white placeholder:text-white/30" />
                <label className="sr-only" htmlFor="showcase-team">{tr("Equipo")}</label>
                <select id="showcase-team" value={team} onChange={(e) => { setTeam(e.target.value); setShown(PAGE); }} className="nx-focus nx-clip-sm min-h-[44px] border border-white/12 bg-[#11151f] px-2 text-[13px] text-white">
                  <option value="">{tr("Todos los equipos")}</option>{teams.map((t) => <option key={t} value={t}>{td(t)}</option>)}
                </select>
                <label className="sr-only" htmlFor="showcase-role">{tr("Rol")}</label>
                <select id="showcase-role" value={role} onChange={(e) => { setRole(e.target.value as RoleId | ""); setShown(PAGE); }} className="nx-focus nx-clip-sm min-h-[44px] border border-white/12 bg-[#11151f] px-2 text-[13px] text-white">
                  <option value="">{tr("Todos los roles")}</option>{ROLES.map((r) => <option key={r} value={r}>{td(r)}</option>)}
                </select>
                <label className="sr-only" htmlFor="showcase-rarity">{tr("Rareza")}</label>
                <select id="showcase-rarity" value={rarity} onChange={(e) => { setRarity(e.target.value as RarityBucket | ""); setShown(PAGE); }} className="nx-focus nx-clip-sm min-h-[44px] border border-white/12 bg-[#11151f] px-2 text-[13px] text-white">
                  <option value="">{tr("Todas las rarezas")}</option>{BUCKETS.map((b) => <option key={b} value={b}>{td(BUCKET_LABEL[b])}</option>)}
                </select>
                <button type="button" aria-pressed={dups} onClick={() => { setDups(!dups); setShown(PAGE); }} className={`nx-focus nx-clip-sm min-h-[44px] border px-3 font-display text-[11px] font-bold uppercase tracking-[0.1em] ${dups ? "border-drl-cyan/60 text-drl-cyan" : "border-white/12 text-white/60"}`}>{tr("Duplicadas")}</button>
              </div>

              {owned.length === 0 ? (
                <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-6 text-center text-caption text-ink-muted">{tr("Aún no tienes cartas. Abre un sobre y vuelve para exponerlas.")}</p>
              ) : filtered.length === 0 ? (
                <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-6 text-center text-caption text-ink-muted">{tr("Ninguna carta de tu colección coincide con estos filtros.")}</p>
              ) : (
                <>
                  <p className="text-[11px] text-white/40">{tr("{n, plural, one {# carta} other {# cartas}} de tu colección", { n: filtered.length })}</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8" data-testid="editor-grid">
                    {filtered.slice(0, shown).map((v) => {
                      const def = getCard(v.cardId);
                      if (!def) return null;
                      const on = selectedCards.has(v.cardId);
                      const bucket = bucketForRank(v.rank);
                      return (
                        <li key={v.cardId}>
                          <button type="button" onClick={() => onCard(v.cardId)} aria-pressed={on} data-card={v.cardId} data-count={v.count}
                            aria-label={`${v.nick}, ${td(v.label)}, ${td(BUCKET_LABEL[bucket])}${v.count > 1 ? tr(", {n} copias", { n: v.count }) : ""}${on ? tr(", en tu vitrina") : ""}`}
                            className={`nx-focus flex w-full flex-col items-center gap-1 p-1.5 text-center transition hover:-translate-y-0.5 ${on ? "text-drl-cyan" : ""}`}>
                            {/* CARD ART = CARD VISUAL: la elegida brilla sobre su silueta; ni caja ni fondo alrededor. */}
                            <span className="block" style={on ? { filter: "drop-shadow(0 0 8px #19e3ff)" } : undefined}><CardThumb card={def} width={56} /></span>
                            <span className="w-full truncate text-[10px] font-bold uppercase text-white">{v.nick}</span>
                            <span className="flex flex-wrap justify-center gap-1">
                              {v.count > 1 && <span className="text-[9px] text-drl-cyan">×{v.count}</span>}
                              {v.bestSerial != null && <span className="text-[9px] text-white/50">#{v.bestSerial}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {shown < filtered.length && <button type="button" onClick={() => setShown(shown + PAGE)} className="nx-focus min-h-[44px] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{tr("Ver más cartas")}</button>}
                </>
              )}
            </div>
          )}

          {tab === "achievements" && (
            <div className="space-y-4" data-testid="editor-achievements">
              <p className="text-caption text-ink-muted">{tr("Elige hasta {max} logros que ya hayas conseguido. Se muestran en este orden.", { max: FEATURED_MAX })}</p>
              {props.claimed.length === 0 ? (
                <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-6 text-center text-caption text-ink-muted">{tr("Todavía no has conseguido ningún logro. Recoge uno en Logros y pase y vuelve.")}</p>
              ) : (
                <>
                  <ol className="grid gap-2 sm:grid-cols-3" aria-label={tr("Logros destacados, en orden")}>
                    {Array.from({ length: FEATURED_MAX }, (_, i) => {
                      const a = props.claimed.find((x) => x.id === featured[i]);
                      return (
                        <li key={i} className="nx-clip-sm flex items-center gap-2 border border-white/10 bg-white/[0.02] px-3 py-2" data-featured-slot={i + 1}>
                          <span aria-hidden className="grid h-10 w-10 place-items-center text-xl">{a?.icon ?? "·"}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-white">{a?.name ?? tr("Vacío")}</span>
                          {a && <>
                            <button type="button" onClick={() => setFeatured(move(featured, i, -1))} disabled={i === 0} aria-label={tr("Subir logro {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-white/70 disabled:opacity-30">↑</button>
                            <button type="button" onClick={() => setFeatured(featured.filter((_, k) => k !== i))} aria-label={tr("Quitar logro {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-drl">✕</button>
                          </>}
                        </li>
                      );
                    })}
                  </ol>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {props.claimed.map((a) => {
                      const on = featured.includes(a.id);
                      return (
                        <li key={a.id}>
                          <button type="button" aria-pressed={on} data-achievement={a.id}
                            onClick={() => setFeatured(on ? featured.filter((x) => x !== a.id) : featured.length >= FEATURED_MAX ? featured : [...featured, a.id])}
                            disabled={!on && featured.length >= FEATURED_MAX}
                            className={`nx-focus nx-clip-sm flex min-h-[56px] w-full items-center gap-3 border px-3 py-2 text-left disabled:opacity-40 ${on ? "border-drl-gold/60 bg-drl-gold/10" : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.06]"}`}>
                            <span aria-hidden className="text-2xl">{a.icon}</span>
                            <span className="min-w-0"><span className="block font-display text-[13px] font-bold uppercase text-white">{a.name}</span><span className="block truncate text-[11px] text-white/50">{td(a.description)}</span></span>
                            {on && <Badge tone="gold" className="ml-auto">{tr("Destacado")}</Badge>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === "badges" && (
            <div className="space-y-4" data-testid="editor-badges">
              <p className="text-caption text-ink-muted">{tr("Elige hasta {max} insignias desbloqueadas. Se muestran en tu perfil en este orden.", { max: BADGES_MAX })}</p>
              {(props.badges ?? []).length === 0 ? (
                <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-6 text-center text-caption text-ink-muted">{tr("Aún no tienes insignias. Completa una colección en la Sala de Trofeos.")}</p>
              ) : (
                <>
                  <ol className="grid gap-2 sm:grid-cols-3" aria-label={tr("Insignias destacadas, en orden")}>
                    {Array.from({ length: BADGES_MAX }, (_, i) => {
                      const b = (props.badges ?? []).find((x) => x.id === badgeSel[i]);
                      return (
                        <li key={i} className="nx-clip-sm flex items-center gap-2 border border-white/10 bg-white/[0.02] px-3 py-2" data-badge-slot={i + 1}>
                          {b ? <TrophyBadge badge={b} size="sm" /> : <span aria-hidden className="grid h-10 w-10 place-items-center text-white/30">·</span>}
                          <span className="min-w-0 flex-1 truncate text-[13px] text-white">{td(b?.label) ?? tr("Vacío")}</span>
                          {b && <>
                            <button type="button" onClick={() => setBadgeSel(move(badgeSel, i, -1))} disabled={i === 0} aria-label={tr("Subir insignia {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-white/70 disabled:opacity-30">↑</button>
                            <button type="button" onClick={() => setBadgeSel(move(badgeSel, i, 1))} disabled={i >= badgeSel.length - 1} aria-label={tr("Bajar insignia {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-white/70 disabled:opacity-30">↓</button>
                            <button type="button" onClick={() => setBadgeSel(badgeSel.filter((_, k) => k !== i))} aria-label={tr("Quitar insignia {v}", { v: i + 1 })} className="nx-focus grid h-11 w-11 place-items-center border border-white/10 text-drl">✕</button>
                          </>}
                        </li>
                      );
                    })}
                  </ol>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(props.badges ?? []).map((b) => {
                      const on = badgeSel.includes(b.id);
                      return (
                        <li key={b.id}>
                          <button type="button" aria-pressed={on} data-badge-option={b.id}
                            onClick={() => setBadgeSel(on ? badgeSel.filter((x) => x !== b.id) : badgeSel.length >= BADGES_MAX ? badgeSel : [...badgeSel, b.id])}
                            disabled={!on && badgeSel.length >= BADGES_MAX}
                            className={`nx-focus nx-clip-sm flex min-h-[56px] w-full items-center gap-3 border px-3 py-2 text-left disabled:opacity-40 ${on ? "border-drl-gold/60 bg-drl-gold/10" : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.06]"}`}>
                            <TrophyBadge badge={b} size="sm" />
                            <span className="min-w-0"><span className="block truncate font-display text-[13px] font-bold uppercase text-white">{td(b.label)}</span><span className="block truncate text-[11px] text-white/50">{td(b.caption)}</span></span>
                            {on && <Badge tone="gold" className="ml-auto">{tr("Destacada")}</Badge>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === "team" && props.onSaveTeam && (
            <div className="space-y-4" data-testid="editor-team">
              <p className="text-caption text-ink-muted">{tr("Elige tu equipo esports favorito. Solo equipos reales de Valorosters; el escudo es el oficial del producto.")}</p>
              <input type="search" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} placeholder={tr("Buscar equipo…")} aria-label={tr("Buscar equipo")}
                className="nx-focus w-full rounded-md bg-white/[0.05] px-3 py-2 text-[14px] text-white ring-1 ring-white/15 placeholder:text-white/40" />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={tr("Equipos")}>
                <li>
                  <button type="button" aria-pressed={favTeam === null} onClick={() => setFavTeam(null)} data-team-option=""
                    className={`nx-focus nx-clip-sm flex min-h-[56px] w-full items-center gap-3 border px-3 py-2 text-left ${favTeam === null ? "border-drl-cyan/60 bg-drl-cyan/10" : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.06]"}`}>
                    <span className="font-display text-[12px] font-bold uppercase tracking-wide text-white/70">{tr("Sin equipo favorito")}</span>
                  </button>
                </li>
                {(props.teamOptions ?? []).filter((t) => !teamQuery.trim() || `${t.name} ${t.tag}`.toLowerCase().includes(teamQuery.trim().toLowerCase())).map((t) => (
                  <li key={t.id}>
                    <button type="button" aria-pressed={favTeam === t.id} onClick={() => setFavTeam(t.id)} data-team-option={t.id}
                      className={`nx-focus nx-clip-sm flex min-h-[56px] w-full items-center gap-2 border px-2 py-2 text-left ${favTeam === t.id ? "border-drl-cyan/60 bg-drl-cyan/10" : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.06]"}`}>
                      <TeamMark team={t} />
                      <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-[0.12em] text-white/40">{td(t.region)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "avatar" && (
            <div className="space-y-3" data-testid="editor-avatar">
              <p className="text-caption text-ink-muted">{tr("Tu avatar se ve en tu perfil, en la escalera y en Social.")}</p>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((a) => (
                  <button key={a} type="button" onClick={() => props.onSaveAvatar(a)} disabled={busy} aria-pressed={props.avatar === a} aria-label={tr("Elegir avatar {a}", { a: td(a) })}
                    className={`nx-focus nx-clip-sm grid h-14 w-14 place-items-center border text-3xl transition ${props.avatar === a ? "border-drl-cyan/70 bg-drl-cyan/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]"}`}>{td(a)}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-5 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-7">
          {error ? <p role="alert" className="text-caption text-drl">{playerMessage(error)}</p> : <span className="text-[11px] text-white/35">{tr("Lo valida el servidor: solo tus cartas y tus logros conseguidos.")}</span>}
          <div className="flex gap-2">
            <NxButton variant="ghost" onClick={onClose} disabled={busy}>{tr("Cerrar")}</NxButton>
            {tab === "cards" && <NxButton variant="primary" onClick={() => props.onSaveShowcase(uids)} disabled={busy || sameList(uids, props.initialUids)} data-testid="save-showcase">{busy ? tr("Guardando…") : tr("Guardar vitrina")}</NxButton>}
            {tab === "badges" && props.onSaveBadges && <NxButton variant="primary" onClick={() => props.onSaveBadges?.(badgeSel)} disabled={busy || sameList(badgeSel, props.initialBadges ?? [])} data-testid="save-badges">{busy ? tr("Guardando…") : tr("Guardar insignias")}</NxButton>}
            {tab === "team" && props.onSaveTeam && <NxButton variant="primary" onClick={() => props.onSaveTeam?.(favTeam)} disabled={busy || favTeam === (props.initialTeam ?? null)} data-testid="save-team">{busy ? tr("Guardando…") : tr("Guardar equipo")}</NxButton>}
            {tab === "achievements" && <NxButton variant="primary" onClick={() => props.onSaveFeatured(featured)} disabled={busy || sameList(featured, props.initialFeatured)} data-testid="save-featured">{busy ? tr("Guardando…") : tr("Guardar logros")}</NxButton>}
          </div>
        </footer>

        {picker && pickerDef && (
          <div className="absolute inset-0 z-10 flex flex-col rounded-t-2xl bg-[#0b0e17] sm:rounded-2xl" data-testid="instance-picker" data-card={picker}>
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-5 py-3 sm:px-7">
              <div>
                <span className="nx-label">{tr("Elige la copia que quieres exponer")}</span>
                <h3 className="font-display text-h3 font-bold uppercase text-white">{td(getVariant(pickerDef.variantId as VariantId).label)} · {pickerCopies.length} {tr("copias")}</h3>
              </div>
              <button type="button" onClick={() => setPicker(null)} aria-label={tr("Volver a la colección")} className="nx-focus grid h-11 w-11 place-items-center rounded-full border border-white/15 text-white/70">✕</button>
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4 sm:px-7">
              {pickerCopies.map((c) => {
                const on = uids.some((u) => u.toLowerCase() === c.uid.toLowerCase());
                const v = getVariant(pickerDef.variantId as VariantId);
                const b = bucketForRank(v.rank);
                return (
                  <li key={c.uid} className={`nx-clip-sm flex flex-wrap items-center gap-3 border px-3 py-2 ${on ? "border-drl-cyan/60 bg-drl-cyan/10" : "border-white/10 bg-white/[0.02]"}`} data-instance={c.uid} data-serial={c.serial ?? "none"}>
                    <CardThumb card={pickerDef} width={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[15px] font-bold text-white">{serialText(c.serial ?? null, v.serialLimit ?? null)}</span>
                      <span className="block text-[11px] text-white/50">{fill(tr("{variante} · {rareza} · obtenida el {fecha}", { variante: td(v.label), ...slots("rareza"), fecha: fmtDay(c.obtainedAt) }), { rareza: <Badge tone={RARITY_TONE[b]}>{td(BUCKET_LABEL[b])}</Badge> })}</span>
                    </span>
                    <ProfileButton tone={on ? "primary" : "ghost"} aria-pressed={on} onClick={() => { toggleInstance(c.uid, c.cardId); setPicker(null); }}>{on ? tr("Quitar de la vitrina") : tr("Exponer esta copia")}</ProfileButton>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
