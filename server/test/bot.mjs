/* A stand-in opponent for trying the game by hand against `wrangler dev`.
 *   node test/bot.mjs            → joins the random queue
 *   node test/bot.mjs ABCDE      → joins that friend room
 * Options (env): BASE=http://localhost:8787  DELAY=1500 (ms per move)  REMATCH=1
 */
import '../../js/engine.js';

const PZ = globalThis.PZ;
const BASE = process.env.BASE || 'http://localhost:8787';
const DELAY = +(process.env.DELAY || 1500);
const pid = 'bot-' + Math.random().toString(36).slice(2, 12);

let code = process.argv[2];
if (!code) code = (await (await fetch(BASE + '/match', { method: 'POST' })).json()).code;

function join(room) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/room/${room}/ws?pid=${pid}`);
  let seat = 0, state = null, n = 0;
  const play = () => {
    if (!state || state.over || state.turn !== seat) return;
    const moves = PZ.legalMoves(state);
    const pit = moves[(Math.random() * moves.length) | 0];
    setTimeout(() => ws.send(JSON.stringify({ t: 'move', pit, n })), DELAY);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello' || m.t === 'start') {
      ({ seat, state, n } = m);
      console.log(`[${room}] ${m.t}: seat ${seat}, game ${m.game}, move ${n}`);
      play();
    } else if (m.t === 'move') {
      state = PZ.applyMove(state, m.pit, false).state;
      n = m.n;
      console.log(`[${room}] move ${n}: seat ${m.by} pit ${m.pit} → ${state.store.join('-')}${state.over ? ' (over)' : ''}`);
      if (state.over && process.env.REMATCH) ws.send(JSON.stringify({ t: 'rematch' }));
      play();
    } else if (m.t === 'rematch') ws.send(JSON.stringify({ t: 'rematch' }));
    else if (m.t === 'goto') { console.log(`[${room}] sent to ${m.code}`); join(m.code); }
    else if (m.t === 'left' || m.t === 'err') { console.log(`[${room}] ${m.t} ${m.code || ''}`); process.exit(0); }
    else console.log(`[${room}]`, e.data);
  };
  ws.onclose = () => console.log(`[${room}] socket closed`);
}
join(code);
