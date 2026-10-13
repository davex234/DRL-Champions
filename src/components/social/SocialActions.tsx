"use client";

/**
 * ACCIONES SOCIALES EN EL PERFIL DE UN JUGADOR (Fase 29). Se cuelga del perfil competitivo de la
 * Fase 28 y se alimenta solo de `GET /api/game/social?player=`: relación (AÑADIR AMIGO ·
 * SOLICITUD ENVIADA · ACEPTAR · ELIMINAR AMIGO · RETAR · BLOQUEAR), presencia, cara a cara
 * RANKED / PRIVADO / TOTAL y el reto pendiente entre los dos. Cada botón manda un id; el
 * servidor decide y aquí se vuelve a leer.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { h2hText, RELATION_LABEL } from "@/domain/social/social";
import {
  fetchSocialPlayer, sendFriendRequest, acceptFriend, declineFriend, removeFriend, blockUser, unblockUser,
  createChallenge, acceptChallenge, declineChallenge, cancelChallengeReq, SocialError, announceSocialChange, type SocialPlayerView,
} from "@/lib/social/client";
import { trackSocial } from "@/lib/social/telemetry";
import { fetchDuelDecks } from "@/lib/duel/client";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { PresenceDot, RowButton, remainingText } from "./bits";
import { ChallengeSheet } from "./ChallengeSheet";
import { ConfirmSheet } from "./ConfirmSheet";
import { ns, td, tdIn, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("social");

export function SocialActions({ playerId, enabled, showH2H = true }: { playerId: string; enabled: boolean; /** Fase 31: el perfil de jugador ya pinta su cara a cara; aquí se omite para no duplicarlo. */ showH2H?: boolean }) {
  const [view, setView] = useState<SocialPlayerView | null>(null);
  const load = useCallback(async () => {
    try { setView(await fetchSocialPlayer(playerId)); } catch { /* el perfil competitivo sigue */ }
  }, [playerId]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  if (!view || view.relation === "SELF") return null;
  return <SocialActionsPanel view={view} onChanged={load} showH2H={showH2H} />;
}

type Sheet = { kind: "challenge"; previousMatchId: string | null } | { kind: "accept" } | { kind: "unfriend" } | { kind: "block" } | null;

/** Panel puro (también en el arnés). `onChanged` se llama tras cada acción con éxito. */
export function SocialActionsPanel({ view, onChanged, now = Date.now(), harness = false, showH2H = true }: { view: SocialPlayerView; onChanged: () => void | Promise<void>; now?: number; harness?: boolean; showH2H?: boolean }) {
  useLocale();
  const router = useRouter();
  const { toast, notify } = useToast(2600);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [menu, setMenu] = useState(false);
  const p = view.player;
  const a = view.actions;
  const pending = view.pendingChallenge;

  const run = useCallback(async (fn: () => Promise<unknown>, okMsg: string) => {
    if (busy || harness) return false;
    setBusy(true);
    try { await fn(); notify(okMsg, true); announceSocialChange(); await onChanged(); return true; }
    catch (e) { notify(e instanceof Error ? e.message : t("No se pudo completar"), false); return false; }
    finally { setBusy(false); }
  }, [busy, harness, notify, onChanged]);

  const ensureDecks = useCallback(async () => {
    if (decks || harness) return;
    try { const d = await fetchDuelDecks(); setDecks(d.decks); }
    catch (e) { setSheetError(e instanceof Error ? e.message : t("No se pudieron leer tus equipos")); }
  }, [decks, harness]);

  const confirmSheet = useCallback(async (deckId: string) => {
    if (!sheet || busy || harness) return;
    setBusy(true); setSheetError(null);
    try {
      if (sheet.kind === "challenge") {
        await createChallenge(p.userId, deckId, sheet.previousMatchId);
        trackSocial("challenge_sent");
        notify(t("Reto enviado a {username}", { username: p.username }), true);
        setSheet(null); announceSocialChange(); await onChanged();
      } else if (sheet.kind === "accept" && pending) {
        const r = await acceptChallenge(pending.id, deckId);
        trackSocial("challenge_accept");
        setSheet(null);
        if (r.matchId) router.push(`/duelos/pvp?match=${r.matchId}`); else await onChanged();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("No se pudo completar");
      setSheetError(msg);
      if (e instanceof SocialError && ["EXPIRED", "NOT_PENDING", "BUSY", "IN_QUEUE", "UNAVAILABLE", "INCOMING_PENDING"].includes(e.code ?? "")) { setSheet(null); notify(msg, false); await onChanged(); }
    } finally { setBusy(false); }
  }, [sheet, busy, harness, p, pending, notify, onChanged, router]);

  const confirmDanger = useCallback(async () => {
    if (!sheet) return;
    const ok = sheet.kind === "unfriend" ? await run(() => removeFriend(p.userId), t("{username} ya no es tu amigo", { username: p.username }))
      : sheet.kind === "block" ? await run(() => blockUser(p.userId), t("{username} bloqueado", { username: p.username })) : false;
    if (ok) setSheet(null);
  }, [sheet, run, p]);

  return (
    <Plate className="p-4" data-testid="social-actions" data-relation={view.relation}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {view.presence && <PresenceDot presence={view.presence} />}
          <Badge tone={view.relation === "FRIENDS" ? "ok" : "muted"} data-testid="relation-badge">{view.relation === "FRIENDS" ? t("Amigos") : view.relation === "BLOCKED_BY_ME" ? t("Bloqueado") : RELATION_LABEL[view.relation] === "Añadir amigo" ? t("Sin relación") : tdIn("social", RELATION_LABEL[view.relation])}</Badge>
          {view.friendsSince !== null && <span className="text-[11px] text-white/40">{t("amigos desde {fecha}", { fecha: new Date(view.friendsSince).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" }) })}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {a.add && <RowButton tone="primary" onClick={() => void run(async () => { await sendFriendRequest(p.userId); trackSocial("friend_request"); }, t("Solicitud enviada a {username}", { username: p.username }))} data-action="add">{t("Añadir amigo")}</RowButton>}
          {view.relation === "OUTGOING" && <><span className="nx-label self-center text-white/45" data-action="sent">{t("Solicitud enviada")}</span><RowButton onClick={() => void run(() => removeFriend(p.userId), t("Solicitud retirada"))}>{t("Retirar")}</RowButton></>}
          {a.accept && <RowButton tone="primary" onClick={() => void run(async () => { await acceptFriend(p.userId); trackSocial("friend_accept"); }, t("Ahora sois amigos: {username}", { username: p.username }))} data-action="accept">{t("Aceptar")}</RowButton>}
          {a.decline && <RowButton onClick={() => void run(() => declineFriend(p.userId), t("Solicitud rechazada"))}>{t("Rechazar")}</RowButton>}
          {a.challenge && !pending && <RowButton tone="primary" onClick={() => { setSheetError(null); setSheet({ kind: "challenge", previousMatchId: null }); void ensureDecks(); }} data-action="challenge">{t("Retar")}</RowButton>}
          {a.unblock && <RowButton onClick={() => void run(() => unblockUser(p.userId), t("{username} desbloqueado", { username: p.username }))} data-action="unblock">{t("Desbloquear")}</RowButton>}
          {view.relation !== "BLOCKED_BY_ME" && <a href={`/social/comparar?id=${p.userId}`} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/15 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/70 hover:bg-white/[0.08]" data-action="compare">{t("Comparar")}</a>}
          {/* F85 · lo destructivo va en un menú contextual, no como botón grande. */}
          {(a.unfriend || a.block) && (
            <div className="relative">
              <RowButton aria-haspopup="menu" aria-expanded={menu} aria-label={t("Más opciones con {username}", { username: p.username })} onClick={() => setMenu((m) => !m)} className="w-11 px-0" data-action="more">…</RowButton>
              {menu && (
                <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[180px] border border-white/12 bg-[#0b0e17] p-1 shadow-2xl">
                  {a.unfriend && <button role="menuitem" type="button" className="nx-focus block min-h-[44px] w-full px-3 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06]" onClick={() => { setMenu(false); setSheet({ kind: "unfriend" }); }} data-action="unfriend">{t("Eliminar amigo")}</button>}
                  {a.block && <button role="menuitem" type="button" className="nx-focus block min-h-[44px] w-full px-3 py-2 text-left text-[13px] text-drl-red hover:bg-drl-red/10" onClick={() => { setMenu(false); setSheet({ kind: "block" }); }} data-action="block">{t("Bloquear")}</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-3" data-testid="pending-challenge" data-direction={pending.direction}>
          <span className="text-caption text-white/80">
            {pending.direction === "INCOMING" ? t("{username} te ha retado a un duelo amistoso", { username: p.username }) : t("Esperando respuesta de {username}…", { username: p.username })} · {remainingText(pending.expiresAt, now)}
          </span>
          <div className="flex gap-2">
            {pending.actions.accept && <RowButton tone="primary" onClick={() => { setSheetError(null); setSheet({ kind: "accept" }); void ensureDecks(); }}>{t("Aceptar reto")}</RowButton>}
            {pending.actions.decline && <RowButton onClick={() => void run(() => declineChallenge(pending.id), t("Reto rechazado"))}>{t("Rechazar")}</RowButton>}
            {pending.actions.cancel && <RowButton onClick={() => void run(() => cancelChallengeReq(pending.id), t("Reto cancelado"))}>{t("Cancelar reto")}</RowButton>}
          </div>
        </div>
      )}

      {showH2H && (<>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-3" data-testid="h2h-split" data-total={`${view.h2h.total.wins}-${view.h2h.total.losses}-${view.h2h.total.draws}`}>
        <H2HCell id="ranked" label={t("Ranked")} h={view.h2h.ranked} />
        <H2HCell id="privados" label={t("Privados")} h={view.h2h.private} />
        <H2HCell id="total" label={t("Total")} h={view.h2h.total} strong />
      </div>
      <p className="mt-1 text-[11px] text-white/35">{t("Tus victorias – las suyas. Los duelos privados no cuentan para el rating.")}</p>
      </>)}

      {showH2H && view.recentPrivate.length > 0 && (
        <ol className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.08] text-[12px]" aria-label={t("Últimos duelos privados")}>
          {view.recentPrivate.map((m) => (
            <li key={m.matchId} className="flex items-center gap-3 py-1.5">
              <Badge tone={m.letter === "W" ? "ok" : m.letter === "L" ? "bad" : "muted"} className="w-[2.2rem] justify-center">{m.letter ?? "—"}</Badge>
              <span className="flex-1 text-white/70">{t("Duelo privado")}</span>
              <span className="nx-readout text-white/70">{m.scoreYou}–{m.scoreRival}</span>
              <time className="text-[11px] text-white/35">{new Date(m.at).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" })}</time>
            </li>
          ))}
        </ol>
      )}

      <ChallengeSheet
        open={sheet?.kind === "challenge" || sheet?.kind === "accept"}
        mode={sheet?.kind === "accept" ? "accept" : "send"}
        target={p}
        decks={decks}
        busy={busy}
        error={td(sheetError)}
        rematch={sheet?.kind === "challenge" ? sheet.previousMatchId !== null : pending?.previousMatchId != null}
        onConfirm={confirmSheet}
        onClose={() => { if (!busy) setSheet(null); }}
      />
      <ConfirmSheet open={sheet?.kind === "unfriend"} title={t("¿Eliminar amigo?")} body={t("{username} dejará de ser tu amigo. Vuestro historial de partidas se conserva.", { username: p.username })} confirmLabel={t("Eliminar amigo")} busy={busy} onConfirm={confirmDanger} onClose={() => { if (!busy) setSheet(null); }} />
      <ConfirmSheet open={sheet?.kind === "block"} title={t("¿Bloquear jugador?")} body={t("{username} no podrá enviarte solicitudes ni retos. Sus retos pendientes se cancelan.", { username: p.username })} confirmLabel={t("Bloquear")} busy={busy} onConfirm={confirmDanger} onClose={() => { if (!busy) setSheet(null); }} />
      <Toast toast={toast} />
    </Plate>
  );
}

function H2HCell({ id, label, h, strong }: { id: "ranked" | "privados" | "total"; label: string; h: { wins: number; losses: number; draws: number; matches: number }; strong?: boolean }) {
  useLocale();
  return (
    <div className="text-center">
      <span className="nx-label">{td(label)}</span>
      <span className={`nx-readout mt-1 block text-[20px] ${strong ? "text-white" : "text-white/75"}`} data-h2h={id}>{h.matches === 0 ? "—" : h2hText(h)}</span>
      <span className="text-[11px] text-white/35">{h.matches} {h.matches === 1 ? t("partida") : t("partidas")}</span>
    </div>
  );
}
