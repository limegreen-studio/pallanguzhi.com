/* Pallanguzhi multiplayer: one Worker, one Durable Object per room, one lobby for random matches.
 *
 *   POST /room            → { code }   new friend room
 *   POST /match           → { code }   a room with someone waiting, or a fresh one to wait in
 *   GET  /room/:code/ws?pid=…&name=…   WebSocket for that room (name is optional, shown to the other player)
 *
 * The room is the referee. It runs the same rules engine as the browser (js/engine.js), so a
 * move on the wire is just a pit index. Seats are canonical: seat 0 owns pits 0..6, seat 1 owns
 * 7..13. Each browser rotates the board so its own row is at the bottom.
 *
 * Server → client: hello | start (full snapshot), move, peer, rematch, left, timeout, goto, err
 * Client → server: move, rematch, leave, sync
 *
 * Abuse limits: Turnstile proves a person is starting the game (when TURNSTILE_SECRET is set),
 * per-IP rate limits cap new games and socket joins, each socket is throttled, and a random
 * match gives each move one minute.
 */
import { DurableObject } from 'cloudflare:workers';
import '../../js/engine.js';

const PZ = globalThis.PZ;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CODE_RE = /^[A-Z2-9]{5}$/;
const PID_RE = /^[\w-]{8,64}$/;
const IDLE_TTL = 2 * 60 * 60 * 1000; // an empty room is deleted after this
const FORFEIT_MS = 45 * 1000; // random match: how long a dropped player has to come back
const CLOSED_TTL = 60 * 1000;
const TURN_MS = 60 * 1000; // random match: time to make a move
const MSG_BURST = 40; // messages one socket may send per 10 s
const NAME_MAX = 16;

// A player's display name: plain text only, so neither side ever has to escape it.
const cleanName = (s) => Array.from(String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim())
  .slice(0, NAME_MAX).join('').trim();

// Extra time on top of TURN_MS so the clock only bites after the previous move has finished
// animating on the mover's screen (about a quarter second per seed dropped).
const animTime = (drops) => Math.min(45000, 4000 + drops * 300);

async function limited(binding, key) {
  if (!binding) return false;
  return !(await binding.limit({ key })).success;
}

// Turnstile: the request body is the token the browser widget produced.
async function human(req, env, ip) {
  if (!env.TURNSTILE_SECRET) return true; // not configured: nothing to check against
  const token = (await req.text()).slice(0, 4096);
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return (await r.json()).success === true;
  } catch (e) {
    return false;
  }
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const room = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));
const lobby = (env) => env.LOBBY.get(env.LOBBY.idFromName('lobby'));

async function createRoom(env, kind) {
  for (let tries = 0; tries < 5; tries++) {
    const code = newCode();
    if (await room(env, code).create(kind, code)) return code;
  }
  throw new Error('no free room code');
}

function originAllowed(origin, env) {
  if (!origin) return true; // not a browser; the header is trivially forged there anyway
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!originAllowed(origin, env)) return new Response('forbidden origin', { status: 403 });
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const json = (data, status = 200) => Response.json(data, { status, headers: cors });

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' },
      });
    }

    const ip = req.headers.get('CF-Connecting-IP') || 'local';

    if (req.method === 'POST' && (url.pathname === '/room' || url.pathname === '/match')) {
      if (await limited(env.CREATE_LIMIT, ip)) return json({ error: 'slow' }, 429);
      if (!(await human(req, env, ip))) return json({ error: 'human' }, 403);
      if (url.pathname === '/room') return json({ code: await createRoom(env, 'friend') });
      const waiting = await lobby(env).match();
      return json({ code: waiting || (await createRoom(env, 'random')) });
    }

    const ws = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (ws && req.method === 'GET') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!CODE_RE.test(ws[1]) || !PID_RE.test(url.searchParams.get('pid') || '')) {
        return new Response('bad room or player id', { status: 400 });
      }
      if (await limited(env.JOIN_LIMIT, ip)) return new Response('too many connections', { status: 429 });
      return room(env, ws[1]).fetch(req);
    }

    if (url.pathname === '/') return new Response('pallanguzhi-mp ok', { headers: cors });
    return new Response('not found', { status: 404, headers: cors });
  },
};

/* ---------------- Room: two seats, one game, the referee ---------------- */
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.g = null;
    this.rate = new WeakMap(); // per-socket message counts; fine to lose when the object sleeps
    ctx.blockConcurrencyWhile(async () => {
      this.g = (await ctx.storage.get('g')) || null;
    });
    // keepalive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  save() {
    this.ctx.storage.put('g', this.g);
  }

  socks(seat, except) {
    return this.ctx.getWebSockets('s' + seat).filter((w) => w !== except && w.readyState === 1);
  }

  allSocks(except) {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === 1);
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* socket already gone */ }
  }

  toSeat(seat, msg) {
    for (const w of this.socks(seat)) this.send(w, msg);
  }

  snap(seat, t = 'hello') {
    const g = this.g;
    return {
      t, seat, kind: g.kind, code: g.code, game: g.game, n: g.n, state: g.state,
      peer: this.socks(1 - seat).length > 0, rematch: g.rematch, names: g.names || ['', ''],
      left: g.due ? Math.max(0, g.due - Date.now()) : 0, // ms the player to move has left; 0 = untimed
    };
  }

  // Called by the Worker (friend) or the lobby path (random). False if the code is taken.
  async create(kind, code) {
    if (this.g) return false;
    this.g = {
      code, kind, seats: [null, null], names: ['', ''], state: null, n: 0, game: 0, first: 0,
      rematch: [false, false], away: [0, 0], due: 0, closed: false, idleAt: Date.now(),
    };
    this.save();
    await this.arm();
    return true;
  }

  // Asked by the lobby: is there one connected player here still waiting for an opponent?
  async isWaiting() {
    const g = this.g;
    return !!g && !g.closed && !g.state && g.seats[1] === null && this.socks(0).length > 0;
  }

  begin() {
    const g = this.g;
    g.game++;
    g.first = g.game === 1 ? crypto.getRandomValues(new Uint8Array(1))[0] & 1 : 1 - g.first;
    g.state = PZ.newState(5, g.first);
    g.n = 0;
    g.rematch = [false, false];
    g.due = g.kind === 'random' ? Date.now() + TURN_MS + 6000 : 0; // + the deal animation
  }

  // One alarm serves every timer: it is set to whichever is due first.
  async arm(closing) {
    const g = this.g;
    if (!g) return;
    const now = Date.now();
    let at = Infinity;
    if (g.closed) at = now + CLOSED_TTL;
    else {
      for (const since of g.away) if (since) at = Math.min(at, since + FORFEIT_MS);
      if (g.due) at = Math.min(at, g.due);
      if (this.allSocks(closing).length === 0) at = Math.min(at, g.idleAt + IDLE_TTL);
    }
    if (at === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, now + 50));
  }

  close(notice) {
    const g = this.g;
    g.closed = true;
    this.save();
    for (const w of this.allSocks()) {
      if (notice) this.send(w, notice);
      try { w.close(1000, 'closed'); } catch (e) { /* gone */ }
    }
    this.arm();
  }

  // A lone player in a random room puts the room on offer. If someone else is already
  // waiting, this player is sent to that room instead.
  async offer(ws) {
    const g = this.g;
    if (g.kind !== 'random' || g.state || g.closed) return;
    const other = await lobby(this.env).offer(g.code);
    if (!other) return;
    this.send(ws, { t: 'goto', code: other });
    this.close();
  }

  async fetch(req) {
    const params = new URL(req.url).searchParams;
    const pid = params.get('pid');
    const [client, server] = Object.values(new WebSocketPair());
    const g = this.g;

    let seat = -1;
    let err = null;
    if (!g) err = 'gone';
    else if (g.closed) err = 'gone';
    else {
      seat = g.seats.indexOf(pid);
      if (seat < 0) seat = g.seats.indexOf(null);
      if (seat < 0) err = 'full';
    }
    if (err) {
      server.accept();
      server.send(JSON.stringify({ t: 'err', code: err }));
      server.close(4000, err);
      return new Response(null, { status: 101, webSocket: client });
    }

    const old = this.socks(seat);
    this.ctx.acceptWebSocket(server, ['s' + seat]);
    server.serializeAttachment({ seat });
    for (const w of old) {
      // same player opened the game somewhere else: the newest tab wins
      this.send(w, { t: 'err', code: 'dup' });
      try { w.close(4001, 'dup'); } catch (e) { /* gone */ }
    }

    g.seats[seat] = pid;
    g.names = g.names || ['', ''];
    g.names[seat] = cleanName(params.get('name'));
    g.away[seat] = 0;
    let started = false;
    if (!g.state && g.seats[0] !== null && g.seats[1] !== null) {
      this.begin();
      started = true;
    }
    this.save();

    this.send(server, this.snap(seat));
    this.toSeat(1 - seat, started ? this.snap(1 - seat, 'start') : { t: 'peer', on: true, name: g.names[seat] });
    await this.arm();
    if (!started) await this.offer(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 200) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const g = this.g;
    const att = ws.deserializeAttachment();
    if (!g || g.closed || !att || !m) return;
    const seat = att.seat;

    // a real player sends a handful of messages a minute; a flood is cut off
    const now = Date.now();
    const used = this.rate.get(ws) || { since: now, n: 0 };
    if (now - used.since > 10000) { used.since = now; used.n = 0; }
    this.rate.set(ws, used);
    if (++used.n > MSG_BURST) {
      try { ws.close(4008, 'slow down'); } catch (e) { /* gone */ }
      return;
    }

    if (m.t === 'move') {
      const s = g.state;
      const legal = s && !s.over && m.n === g.n && s.turn === seat &&
        Number.isInteger(m.pit) && PZ.owner(m.pit) === seat && s.pits[m.pit] > 0;
      // a stale or illegal move gets the truth back; the client resyncs from it
      if (!legal) return this.send(ws, this.snap(seat));
      const r = PZ.applyMove(s, m.pit, false);
      g.state = r.state;
      g.n++;
      g.due = g.kind === 'random' && !r.state.over ? now + TURN_MS + animTime(r.drops) : 0;
      this.save();
      const out = { t: 'move', pit: m.pit, by: seat, n: g.n, left: g.due ? g.due - now : 0 };
      for (const w of this.allSocks()) this.send(w, out);
      await this.arm();
    } else if (m.t === 'rematch') {
      if (!g.state || !g.state.over) return;
      g.rematch[seat] = true;
      if (g.rematch[0] && g.rematch[1]) {
        this.begin();
        this.save();
        for (const k of [0, 1]) this.toSeat(k, this.snap(k, 'start'));
        await this.arm();
      } else {
        this.save();
        this.toSeat(1 - seat, { t: 'rematch' });
      }
    } else if (m.t === 'leave') {
      for (const w of this.socks(1 - seat)) this.send(w, { t: 'left' });
      this.close();
    } else if (m.t === 'sync') {
      this.send(ws, this.snap(seat));
      await this.offer(ws);
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    const g = this.g;
    const att = ws.deserializeAttachment();
    if (!g || g.closed || !att) return;
    const seat = att.seat;
    if (this.socks(seat, ws).length > 0) return; // they still have another socket open

    this.toSeat(1 - seat, { t: 'peer', on: false });
    if (g.kind === 'random' && !g.state) return this.close(); // nobody is waiting here any more

    if (g.kind === 'random' && !g.state.over) g.away[seat] = Date.now();
    if (this.allSocks(ws).length === 0) g.idleAt = Date.now();
    this.save();
    await this.arm(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const g = this.g;
    const now = Date.now();
    if (!g || g.closed || (this.allSocks().length === 0 && now - g.idleAt >= IDLE_TTL - 500)) {
      this.g = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    // the player to move ran out of time: they lose the game
    if (g.due && now >= g.due - 500 && g.state && !g.state.over) {
      this.toSeat(g.state.turn, { t: 'timeout' });
      this.toSeat(1 - g.state.turn, { t: 'left', why: 'timeout' });
      return this.close();
    }
    // a player who dropped off never came back
    for (const seat of [0, 1]) {
      if (!g.away[seat]) continue;
      if (this.socks(seat).length > 0) g.away[seat] = 0;
      else if (now - g.away[seat] >= FORFEIT_MS - 500) {
        this.toSeat(1 - seat, { t: 'left' });
        return this.close();
      }
    }
    this.save();
    await this.arm();
  }
}

/* ---------------- Lobby: remembers the one room with a player waiting ---------------- */
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.waiting = null;
    ctx.blockConcurrencyWhile(async () => {
      this.waiting = (await ctx.storage.get('w')) || null;
    });
  }

  set(code) {
    this.waiting = code;
    if (code) this.ctx.storage.put('w', code);
    else this.ctx.storage.delete('w');
  }

  // Hands out the waiting room, if its player is still there. Returns null when nobody waits.
  async match() {
    while (this.waiting) {
      const code = this.waiting;
      this.set(null);
      if (await room(this.env, code).isWaiting()) return code;
    }
    return null;
  }

  // A room with one connected player registers itself. If a different room is already
  // waiting, that code is returned so the two players end up together.
  async offer(code) {
    while (this.waiting && this.waiting !== code) {
      const other = this.waiting;
      this.set(null);
      if (await room(this.env, other).isWaiting()) return other;
    }
    this.set(code);
    return null;
  }
}
