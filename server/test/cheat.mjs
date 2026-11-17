/* Tries to cheat, and checks the paths smoke.mjs does not reach. Needs `wrangler dev` running.
 *   node test/cheat.mjs [baseUrl]
 * The forfeit check waits out the real 45 s timer, so this takes about a minute.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import '../../js/engine.js';

const PZ = globalThis.PZ;
const BASE = process.argv[2] || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path) => (await fetch(BASE + path, { method: 'POST' })).json();
const pid = (name) => `${name}-${Math.random().toString(36).slice(2, 10)}`;

// HTTP status of a WebSocket handshake (fetch cannot send an Upgrade header)
function handshake(path, origin) {
  return new Promise((resolve, reject) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };
    if (origin) headers.Origin = origin;
    const req = http.get(BASE + path, { headers });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('error', reject);
  });
}

function client(code, id) {
  const ws = new WebSocket(`${WS}/room/${code}/ws?pid=${id}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.t === m.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  const c = {
    ws, id, inbox,
    raw: (s) => ws.send(s),
    send: (m) => ws.send(JSON.stringify(m)),
    next(t, ms = 4000) {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ t, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for "${t}" (${id})`)), ms);
      });
    },
    // the server's current truth for this player
    async truth() {
      await sleep(150); // let replies to earlier messages land, so they are not mistaken for this one
      inbox.length = 0;
      c.send({ t: 'sync' });
      return c.next('hello');
    },
    close: () => ws.close(),
  };
  return c;
}

async function startedRoom() {
  const { code } = await post('/room');
  const a = client(code, pid('alice'));
  await a.next('hello');
  const b = client(code, pid('bobby'));
  const hb = await b.next('hello');
  await a.next('start');
  return { code, seats: [a, b], state: hb.state };
}

async function badMoves() {
  const { code, seats, state } = await startedRoom();
  const me = state.turn, them = 1 - state.turn;
  const mover = seats[me], waiter = seats[them];
  const before = JSON.stringify(state);

  // every one of these must leave the board untouched
  const attempts = [
    [waiter, { t: 'move', pit: them * 7, n: 0 }, 'moving out of turn'],
    [mover, { t: 'move', pit: them * 7, n: 0 }, 'sowing from the other player’s row'],
    [mover, { t: 'move', pit: 14, n: 0 }, 'pit off the board'],
    [mover, { t: 'move', pit: -1, n: 0 }, 'negative pit'],
    [mover, { t: 'move', pit: 1.5, n: 0 }, 'fractional pit'],
    [mover, { t: 'move', pit: String(me * 7), n: 0 }, 'pit as a string'],
    [mover, { t: 'move', pit: me * 7, n: 5 }, 'move number from the future'],
    [mover, { t: 'move', pit: me * 7 }, 'no move number'],
    [mover, { t: 'move', pit: me * 7, n: 0, state: { store: [70, 0] }, store: [70, 0] }, 'smuggled score'],
    [mover, { t: 'state', state: { pits: [], store: [70, 0], turn: me, over: true } }, 'made-up message type'],
    [mover, { t: 'rematch' }, 'rematch before the game is over'],
  ];
  for (const [who, msg, what] of attempts) {
    who.send(msg);
    const t = await who.truth();
    // the smuggled-score move is a legal move with extra fields: it may play, but only as a normal move
    if (what === 'smuggled score') {
      assert.equal(t.n, 1, what);
      assert.deepEqual(t.state, PZ.applyMove(state, me * 7, false).state, 'extra fields are ignored');
      continue;
    }
    assert.equal(t.n, what === 'made-up message type' || what === 'rematch before the game is over' ? 1 : 0, what);
    if (t.n === 0) assert.equal(JSON.stringify(t.state), before, what);
    assert.equal(t.game, 1, what);
  }

  // garbage on the wire must not crash the room
  mover.raw('not json');
  mover.raw('null');
  mover.raw('[]');
  mover.raw(JSON.stringify({ t: 'move', pit: 0, n: 1, pad: 'x'.repeat(500) }));
  let t = await mover.truth();
  assert.equal(t.n, 1, 'garbage changed nothing');

  // replaying an old move, or sending the same move twice, plays it at most once
  const s1 = t.state;
  const next = seats[s1.turn];
  const pit = PZ.legalMoves(s1)[0];
  next.send({ t: 'move', pit, n: 1 });
  next.send({ t: 'move', pit, n: 1 });
  next.send({ t: 'move', pit: me * 7, n: 0 });
  t = await next.truth();
  assert.equal(t.n, 2, 'duplicate and replayed moves are dropped');
  assert.deepEqual(t.state, PZ.applyMove(s1, pit, false).state);

  // an empty pit cannot be played
  const s2 = t.state;
  if (!s2.over) {
    const row = [...Array(7).keys()].map((k) => s2.turn * 7 + k);
    const empty = row.find((i) => s2.pits[i] === 0);
    if (empty !== undefined) {
      seats[s2.turn].send({ t: 'move', pit: empty, n: 2 });
      assert.equal((await seats[s2.turn].truth()).n, 2, 'empty pit');
    }
  }
  seats.forEach((c) => c.close());
  console.log('bad moves ok: 11 kinds of illegal move, garbage, duplicates and replays all rejected');
  return code;
}

async function seats() {
  const { code, seats: [a, b] } = await startedRoom();

  // a stranger who knows the room code cannot sit down, watch, or move
  const eve = client(code, pid('eve'));
  assert.equal((await eve.next('err')).code, 'full');
  await sleep(200);
  assert.equal(eve.ws.readyState, 3, 'stranger is disconnected');

  // nothing the server sends reveals the other player's id (the id is what proves a seat)
  const all = JSON.stringify([...a.inbox, ...b.inbox, await a.truth(), await b.truth()]);
  assert.ok(!all.includes(a.id) && !all.includes(b.id), 'player ids never leave the server');

  // malformed ids and codes are refused before reaching a room
  for (const path of [`/room/${code}/ws?pid=x`, `/room/${code}/ws`, '/room/abcde/ws?pid=12345678', '/room/TOOLONG/ws?pid=12345678']) {
    assert.equal(await handshake(path), 400, path);
  }

  // a browser on some other website is refused outright
  const evil = await fetch(BASE + '/room', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(await handshake(`/room/${code}/ws?pid=12345678`, 'https://evil.example'), 403);
  assert.equal(await handshake(`/room/${code}/ws?pid=12345678`, 'https://www.pallanguzhi.com'), 101, 'the real site is let in (and then told the room is full)');

  // a room code that was never created does not exist
  const ghost = client('ZZZZZ', pid('ghost'));
  assert.equal((await ghost.next('err')).code, 'gone');

  a.close();
  b.close();
  console.log('seats ok: no third player, no leaked ids, bad ids and foreign origins refused');
}

async function simultaneousRandom() {
  // both ask before either has connected, so both are given a fresh room…
  const [r1, r2] = [await post('/match'), await post('/match')];
  assert.notEqual(r1.code, r2.code);
  const a = client(r1.code, pid('sim-a'));
  await a.next('hello');
  // …and the second one to connect is sent over to the first
  const b = client(r2.code, pid('sim-b'));
  await b.next('hello');
  const go = await b.next('goto');
  assert.equal(go.code, r1.code);
  const b2 = client(go.code, b.id);
  const [sa, hb] = await Promise.all([a.next('start'), b2.next('hello')]);
  assert.deepEqual(sa.state, hb.state);
  console.log('simultaneous random players ok: brought into one room');
  return { a, b: b2 };
}

async function forfeit({ a, b }) {
  // a random-match player who drops and returns in time keeps the game
  b.close();
  assert.equal((await a.next('peer')).on, false);
  await sleep(3000);
  const back = client(new URL(b.ws.url).pathname.split('/')[2], b.id);
  assert.equal((await back.next('hello')).game, 1);
  assert.equal((await a.next('peer')).on, true);

  // one who stays away loses the game after 45 s
  back.close();
  assert.equal((await a.next('peer')).on, false);
  const t0 = Date.now();
  await a.next('left', 60000);
  const took = (Date.now() - t0) / 1000;
  assert.ok(took > 40 && took < 55, `forfeit after ${took.toFixed(0)} s`);
  console.log(`forfeit ok: opponent declared gone after ${took.toFixed(0)} s`);
}

async function flood() {
  const { seats: [a, b] } = await startedRoom();
  const closed = new Promise((resolve) => a.ws.addEventListener('close', (e) => resolve(e.code)));
  for (let i = 0; i < 80; i++) a.send({ t: 'sync' });
  assert.equal(await closed, 4008, 'a socket that floods the room is cut off');
  assert.equal((await b.truth()).n, 0, 'the room carries on for the other player');
  b.close();
  console.log('flood ok: 80 messages in a burst gets the socket closed');
}

async function moveClock() {
  // friend games are untimed
  const friend = await startedRoom();
  assert.equal((await friend.seats[0].truth()).left, 0);
  friend.seats.forEach((c) => c.close());

  // random games give each move a minute (plus time for the last move to finish animating)
  const { code } = await post('/match');
  const a = client(code, pid('clock-a'));
  await a.next('hello');
  assert.equal((await post('/match')).code, code);
  const b = client(code, pid('clock-b'));
  const [sa] = await Promise.all([a.next('start'), b.next('hello')]);
  assert.ok(sa.left > 60000 && sa.left <= 66000, `opening clock ${sa.left} ms`);

  const seats = [a, b];
  const mover = seats[sa.state.turn], other = seats[1 - sa.state.turn];
  mover.send({ t: 'move', pit: sa.state.turn * 7, n: 0 });
  const mv = await other.next('move');
  assert.ok(mv.left >= 64000 && mv.left <= 105000, `clock restarts for the other player: ${mv.left} ms`);

  // …and the player who then never moves loses
  const t0 = Date.now();
  const [slow, win] = await Promise.all([other.next('timeout', 120000), mover.next('left', 120000)]);
  const took = Date.now() - t0;
  assert.equal(win.why, 'timeout');
  assert.ok(slow && Math.abs(took - mv.left) < 3000, `timed out after ${took} ms, promised ${mv.left}`);
  const late = client(code, other.id);
  assert.equal((await late.next('err')).code, 'gone');
  console.log(`move clock ok: stalling player lost after ${(took / 1000).toFixed(0)} s; friend games untimed`);
}

async function rateLimit() {
  const codes = [];
  for (let i = 0; i < 30; i++) codes.push((await fetch(BASE + '/room', { method: 'POST' })).status);
  const ok = codes.filter((c) => c === 200).length, slow = codes.filter((c) => c === 429).length;
  assert.equal(ok + slow, 30);
  assert.ok(slow > 0 && ok <= 20, `30 rapid requests: ${ok} allowed, ${slow} refused`);
  console.log(`rate limit ok: 30 rapid new-game requests → ${ok} allowed, ${slow} refused`);
}

await badMoves();
await seats();
await flood();
await forfeit(await simultaneousRandom());
await moveClock();
await rateLimit(); // last: it uses up this machine's allowance for a minute
process.exit(0);
