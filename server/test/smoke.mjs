/* End-to-end check against a running `wrangler dev` (default http://localhost:8787).
 *   node test/smoke.mjs [baseUrl]
 */
import assert from 'node:assert/strict';
import '../../js/engine.js';

const PZ = globalThis.PZ;
const BASE = process.argv[2] || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');

const post = async (path) => (await fetch(BASE + path, { method: 'POST' })).json();

function client(code, pid) {
  const ws = new WebSocket(`${WS}/room/${code}/ws?pid=${pid}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.test(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    // next message of type t (already received or yet to come)
    next(t, ms = 4000) {
      const test = (m) => m.t === t;
      const i = inbox.findIndex(test);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ test, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for "${t}" (${pid})`)), ms);
      });
    },
    close: () => ws.close(),
  };
}

const pid = (name) => `${name}-${Math.random().toString(36).slice(2, 10)}`;

async function friendGame() {
  const { code } = await post('/room');
  assert.match(code, /^[A-Z2-9]{5}$/);

  const a = client(code, pid('alice'));
  const ha = await a.next('hello');
  assert.equal(ha.seat, 0);
  assert.equal(ha.state, null);

  const b = client(code, pid('bobby'));
  const hb = await b.next('hello');
  const sa = await a.next('start');
  assert.equal(hb.seat, 1);
  assert.deepEqual(hb.state, sa.state);
  assert.equal(sa.peer, true);

  const c = client(code, pid('carol'));
  assert.equal((await c.next('err')).code, 'full');

  const seats = [a, b];
  let state = sa.state;
  let n = 0;

  // an illegal move (wrong turn) is answered with the truth and changes nothing
  seats[1 - state.turn].send({ t: 'move', pit: (1 - state.turn) * 7, n });
  assert.equal((await seats[1 - state.turn].next('hello')).n, 0);

  while (!state.over) {
    const moves = PZ.legalMoves(state);
    const pit = moves[(Math.random() * moves.length) | 0];
    seats[state.turn].send({ t: 'move', pit, n });
    const [ma, mb] = await Promise.all([a.next('move'), b.next('move')]);
    assert.deepEqual(ma, mb);
    assert.equal(ma.pit, pit);
    state = PZ.applyMove(state, pit, false).state;
    n++;
    assert.equal(ma.n, n);
  }

  a.send({ t: 'sync' });
  const end = await a.next('hello');
  assert.deepEqual(end.state, state, 'server and local engine agree on the final board');
  assert.equal(end.state.store[0] + end.state.store[1], 70);

  // reconnecting with the same pid keeps the seat and the board
  const bPid = new URL(b.ws.url).searchParams.get('pid');
  b.close();
  assert.equal((await a.next('peer')).on, false);
  const b2 = client(code, bPid);
  const hb2 = await b2.next('hello');
  assert.equal(hb2.seat, 1);
  assert.deepEqual(hb2.state, state);
  assert.equal((await a.next('peer')).on, true);

  // rematch: needs both, and the other player starts
  a.send({ t: 'rematch' });
  await b2.next('rematch');
  b2.send({ t: 'rematch' });
  const [ra, rb] = await Promise.all([a.next('start'), b2.next('start')]);
  assert.equal(ra.game, 2);
  assert.equal(ra.state.turn, 1 - sa.state.turn);
  assert.deepEqual(ra.state, rb.state);

  // leaving closes the room for both
  a.send({ t: 'leave' });
  await b2.next('left');
  const late = client(code, pid('dave'));
  assert.equal((await late.next('err')).code, 'gone');
  console.log(`friend game ok: ${n} moves, final ${state.store.join('-')}`);
}

async function randomMatch() {
  const first = await post('/match');
  const a = client(first.code, pid('rand-a'));
  assert.equal((await a.next('hello')).state, null);

  const second = await post('/match');
  assert.equal(second.code, first.code, 'second player is sent to the waiting room');
  const b = client(second.code, pid('rand-b'));
  const [sa, hb] = await Promise.all([a.next('start'), b.next('hello')]);
  assert.equal(sa.kind, 'random');
  assert.deepEqual(sa.state, hb.state);

  // nobody is waiting now, so the next player gets a fresh room
  const third = await post('/match');
  assert.notEqual(third.code, first.code);
  const c = client(third.code, pid('rand-c'));
  await c.next('hello');

  // if the waiting player goes away, the room must not be handed out
  c.close();
  await new Promise((r) => setTimeout(r, 300));
  const fourth = await post('/match');
  assert.notEqual(fourth.code, third.code, 'abandoned room is not handed out');

  // a new waiting player is matched as usual afterwards
  const d = client(fourth.code, pid('rand-d'));
  await d.next('hello');
  const { code: lonely } = await post('/match');
  assert.equal(lonely, fourth.code);
  const e = client(lonely, pid('rand-e'));
  await Promise.all([d.next('start'), e.next('hello')]);

  a.send({ t: 'leave' });
  d.send({ t: 'leave' });
  console.log('random match ok');
}

await friendGame();
await randomMatch();
process.exit(0);
