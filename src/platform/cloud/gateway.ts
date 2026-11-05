/**
 * GATEWAY · SESSION ROUTER · API GATEWAY (Online Fase 7/7).
 *
 * Punto de entrada AUTORITATIVO: handshake con protocolo VERSIONADO (reutiliza `PROTOCOL_VERSION`/
 * `isProtocolCompatible` del Online Core, no inventa otro) → auth (JWT-like determinista) → rate
 * limiting (token bucket, reloj lógico) → routing a la instancia (Session Router sobre el Instance
 * Manager). Expone una API pública/privada gated por rol. Sin wall-clock. Cero estados imposibles.
 */
import {
  PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL, isProtocolCompatible, incompatibilityReason, localHandshake,
  type Handshake as NetHandshake,
} from "@/online";
import type { Region } from "@/domain/cards/types";
import {
  fnv1a, idFrom, hasRank, type Principal, type PlatformRole, type PlatformSession,
  type PlatformTransportKind,
} from "./types";
import type { InstanceManager } from "./servers";
import { ns } from "@/i18n/runtime";

const tr = ns("platform");

// ───────────────────────────── Protocol Registry ─────────────────────────────

/** Registro de versiones de protocolo soportadas (reutiliza la negociación del Online Core). */
export class ProtocolRegistry {
  readonly current = PROTOCOL_VERSION;
  private local: NetHandshake = localHandshake("system", "gateway");
  private remote(client: number): NetHandshake {
    return { protocol: client, minProtocol: MIN_COMPATIBLE_PROTOCOL, build: "", appVersion: "", kind: "player", name: "client" };
  }
  compatible(client: number): boolean { return isProtocolCompatible(this.local, this.remote(client)); }
  reason(client: number): string | null { return incompatibilityReason(this.local, this.remote(client)); }
}

// ───────────────────────────── JWT-like auth (determinista) ─────────────────────────────

export interface Token { sub: string; role: PlatformRole; region?: Region; iat: number; exp: number; sig: string }

/** Firma determinista (FNV sobre payload+secret) — mismo patrón de firma que el resto del proyecto. */
function sign(payload: string, secret: string): string { return fnv1a(`${payload}::${secret}`).toString(36); }

export class AuthService {
  constructor(private secret = "drl-platform") {}
  /** Emite un token (JWT-like). `now`/`ttl` en reloj lógico. */
  issue(p: Principal, now: number, ttl = 3600): Token {
    const body = `${p.id}|${p.role}|${p.region ?? ""}|${now}|${now + ttl}`;
    return { sub: p.id, role: p.role, region: p.region, iat: now, exp: now + ttl, sig: sign(body, this.secret) };
  }
  /** Verifica firma + expiración. */
  verify(t: Token, now: number): boolean {
    const body = `${t.sub}|${t.role}|${t.region ?? ""}|${t.iat}|${t.exp}`;
    return t.sig === sign(body, this.secret) && now <= t.exp;
  }
  principal(t: Token): Principal { return { id: t.sub, role: t.role, region: t.region }; }
}

// ───────────────────────────── Rate limiting (token bucket) ─────────────────────────────

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity = 20, private refillPerTick = 2) {}
  /** ¿Se permite una llamada de `key` en `now`? Consume un token. Determinista. */
  allow(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    const refill = Math.max(0, now - b.at) * this.refillPerTick;
    b.tokens = Math.min(this.capacity, b.tokens + refill);
    b.at = now;
    if (b.tokens < 1) { this.buckets.set(key, b); return false; }
    b.tokens -= 1; this.buckets.set(key, b);
    return true;
  }
}

// ───────────────────────────── Handshake / Gateway ─────────────────────────────

export interface Handshake {
  principal: Principal;
  transport: PlatformTransportKind;
  protocol: number;
  token: Token | null;
  region: Region;
}

export interface RouteResult { ok: boolean; session: PlatformSession; instanceId: string | null; reason?: string }

/** Gateway: valida protocolo+auth+rate-limit y ENRUTA la sesión a una instancia (Session Router). */
export class Gateway {
  readonly protocols = new ProtocolRegistry();
  readonly auth = new AuthService();
  private limiter = new RateLimiter();
  private sessions = new Map<string, PlatformSession>();
  private seq = 0;

  constructor(private instances: InstanceManager) {}

  /** Abre y enruta una sesión de forma autoritativa. */
  open(h: Handshake, now: number): RouteResult {
    const id = idFrom("sess", h.principal.id, now, this.seq++);
    const base: PlatformSession = {
      id, principal: h.principal, transport: h.transport, protocol: h.protocol,
      state: "handshaking", instanceId: null, openedAt: now,
    };
    // 1) Protocolo versionado.
    if (!this.protocols.compatible(h.protocol)) {
      return this.reject(base, this.protocols.reason(h.protocol) ?? "protocolo incompatible");
    }
    // 2) Rate limiting por principal.
    if (!this.limiter.allow(h.principal.id, now)) return this.reject(base, "rate limit");
    // 3) Auth (JWT) — jugadores/roles necesitan token válido salvo el sistema.
    if (h.principal.role !== "system") {
      if (!h.token || !this.auth.verify(h.token, now) || h.token.sub !== h.principal.id) {
        return this.reject(base, tr("auth inválida"));
      }
    }
    base.state = "authenticated";
    // 4) Routing a instancia (más cercana / menos cargada).
    const alloc = this.instances.allocate(id, h.region);
    if (!alloc) return this.reject(base, tr("sin capacidad (backpressure)"));
    base.state = "routed"; base.instanceId = alloc.instance.id;
    this.sessions.set(id, base);
    return { ok: true, session: base, instanceId: alloc.instance.id };
  }

  private reject(s: PlatformSession, reason: string): RouteResult {
    s.state = "rejected"; s.reason = reason;
    this.sessions.set(s.id, s);
    return { ok: false, session: s, instanceId: null, reason };
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.instanceId) this.instances.release(id);
    s.state = "closed"; s.instanceId = null;
  }

  session(id: string): PlatformSession | null { return this.sessions.get(id) ?? null; }
  active(): PlatformSession[] { return [...this.sessions.values()].filter((s) => s.state === "routed"); }
}

// ───────────────────────────── API Gateway (pública / privada) ─────────────────────────────

export type ApiScope = "public" | "private";
export interface ApiRoute { method: string; scope: ApiScope; minRole: PlatformRole }

/** Superficie de API declarativa: cada método exige un scope y un rol mínimo. */
export class ApiGateway {
  private routes = new Map<string, ApiRoute>();
  private limiter = new RateLimiter(60, 5);
  register(r: ApiRoute): void { this.routes.set(r.method, r); }
  /** ¿Autorizada la llamada `method` por `caller` en `now`? */
  authorize(method: string, caller: Principal, now: number): { ok: boolean; reason?: string } {
    const r = this.routes.get(method);
    if (!r) return { ok: false, reason: tr("método desconocido") };
    if (!this.limiter.allow(`${caller.id}:${method}`, now)) return { ok: false, reason: "rate limit" };
    if (r.scope === "private" && !hasRank(caller.role, r.minRole)) return { ok: false, reason: "permiso insuficiente" };
    if (r.scope === "public" && !hasRank(caller.role, r.minRole)) return { ok: false, reason: "permiso insuficiente" };
    return { ok: true };
  }
  known(method: string): boolean { return this.routes.has(method); }
}
