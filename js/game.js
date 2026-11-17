/* Pallanguzhi — UI, animation, Ammachi's turns, tutorial and rules. */
(function () {
  const PZ = window.PZ;
  const A = PZ.art;
  const sfx = PZ.sfx;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const owner = PZ.owner;
  const seeds = (n) => (n === 1 ? '1 seed' : n + ' seeds');

  /* ---------------- settings ---------------- */
  const settings = Object.assign({ level: 'medium', seed: 'manjadi', speed: 1, sound: true }, load());
  function load() {
    try { return JSON.parse(localStorage.getItem('pz-settings')) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem('pz-settings', JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  /* ---------------- mount art ---------------- */
  const stage = $('#stage');
  $('#defs').innerHTML = A.DEFS;
  $('.paati-slot').innerHTML = A.paati();
  const paatiEl = $('.paati-slot .paati');
  const face = () => A.paati().replace('viewBox="0 0 300 340"', 'viewBox="76 30 148 148"');
  $('.t-face').innerHTML = face();
  $('.end-face').innerHTML = face();
  $$('.paati').forEach((p) => (p.dataset.mood = 'normal'));
  $('.lamp-slot.l1').innerHTML = A.lamp(30);
  $('.lamp-slot.l2').innerHTML = A.lamp(26);
  $('.t-icon.learn').innerHTML = A.boardIcon();
  const ORN = `<svg viewBox="0 0 54 54"><g fill="none" stroke="#8E3420" stroke-width="1.6" stroke-linecap="round">
    <path d="M10 50 V20 Q10 10 20 10 H50"/><path d="M16 50 V24 Q16 16 24 16 H50" stroke="#C8902E" stroke-width="1"/>
    <path d="M24 30 C24 24 30 22 33 26 C36 30 31 34 28 31"/></g>
    <g fill="#8E3420"><circle cx="10" cy="10" r="2.6"/><circle cx="22" cy="22" r="1.6"/><circle cx="50" cy="10" r="1.6"/><circle cx="10" cy="50" r="1.6"/></g></svg>`;
  $$('.orn').forEach((o) => (o.innerHTML = ORN));

  // Touch devices: skip the live SVG noise filters. Ammachi animates constantly, so a filter on her
  // means re-running the noise every frame, and the full-screen frame filter can push iOS Safari
  // past its graphics memory, which makes layers drop out and the mustard background flash through.
  const LITE = matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('lite', LITE);
  if (LITE) $$('.p-root[filter]').forEach((g) => g.removeAttribute('filter'));
  $('.t-icon.friends').innerHTML = `<svg viewBox="0 0 120 66"><g stroke="#1E1714" stroke-width="2.5" fill="#E7A33A"><circle cx="42" cy="22" r="13"/><path d="M18 62c2-16 12-24 24-24s22 8 24 24z"/></g><g stroke="#1E1714" stroke-width="2.5" fill="#B4462B"><circle cx="80" cy="22" r="13"/><path d="M56 62c2-16 12-24 24-24s22 8 24 24z"/></g></svg>`;


  /* ---------------- board geometry ---------------- */
  // BOARD = board padding-box origin in screen coords. In portrait the board stands
  // upright (rotated 90° clockwise, scaled by k), so board-local points go through toScreen.
  let PORT = false;
  let BOARD = { x: 87, y: 333, k: 1 };
  const toScreen = (x, y) => (PORT ? { x: BOARD.x - BOARD.k * y, y: BOARD.y + BOARD.k * x } : { x: BOARD.x + x, y: BOARD.y + y });
  const vec = (dx, dy) => (PORT ? { x: -BOARD.k * dy, y: BOARD.k * dx } : { x: dx, y: dy });
  const pitLocal = (i) => ({ x: 197 + (i < 7 ? i : 13 - i) * 114, y: i < 7 ? 180 : 72 });
  const pitAt = (i) => { const p = pitLocal(i); return toScreen(p.x, p.y); };
  const storeAt = (w) => toScreen(w === 1 ? 71 : 1009, 126);
  const orient = (land, port) => (PORT ? port : land);

  /* ---------------- stage scaling ---------------- */
  const viewportEl = $('#viewport');
  const boardEl = $('#board');
  let frameKey = '';
  function fit() {
    const vw = viewportEl.clientWidth || innerWidth, vh = viewportEl.clientHeight || innerHeight;
    PORT = vh > vw * 1.1;
    // portrait stage is 720 wide and as tall as the phone, so nothing is letterboxed
    const W = PORT ? 720 : 1280;
    const H = PORT ? Math.round(Math.min(1600, Math.max(1100, (W * vh) / vw))) : 720;
    document.body.classList.toggle('portrait', PORT);
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    stage.style.setProperty('--s', Math.min(vw / W, vh / H));
    if (frameKey !== W + 'x' + H) {
      frameKey = W + 'x' + H;
      $('.frame', stage)?.remove();
      stage.insertAdjacentHTML('beforeend', A.frame(W, H));
      if (LITE) $$('.frame [filter]', stage).forEach((el) => el.remove());
    }
    layoutBoard(H - 32);
  }

  function layoutBoard(sh) {
    const labels = $$('.store-label, .row-label');
    if (!PORT) {
      BOARD = { x: 87, y: 333, k: 1 };
      [boardEl, $('.side'), $('.g-tools'), ...labels].forEach((el) => (el.style.cssText = ''));
    } else {
      // upright board hugging the right edge, as tall as the screen allows
      const k = Math.min(1.08, (sh - 40) / 1080);
      const L = 688 - 18, T = Math.max(20, (sh - 1080 * k) / 2);
      boardEl.style.left = L + 'px';
      boardEl.style.top = T + 'px';
      boardEl.style.transform = `rotate(90deg) scale(${k})`;
      BOARD = { x: L - 3 * k, y: T + 3 * k, k };
      // left column: Ammachi + tools on top, talk in the middle, your score at the bottom
      const edge = L - 252 * k - 16, right = 688 - edge;
      const s0 = storeAt(0);
      const side = $('.side');
      side.style.width = edge - 16 + 'px';
      side.style.bottom = sh - (s0.y - 44) + 'px';
      $('.g-tools').style.right = right + 'px';
      const put = (el, top) => { el.style.cssText = `left:auto;right:${right}px;top:${top}px`; };
      put($('.store-label.s1'), 184);
      put($('.store-label.s0'), s0.y - 32);
    }
    stage.style.setProperty('--bk', BOARD.k);
    if (pitEls.length) pointer(pointerAt);
  }

  let fitQueued = false;
  const queueFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); } };
  addEventListener('resize', queueFit);
  addEventListener('orientationchange', () => setTimeout(fit, 250));
  if (window.visualViewport) visualViewport.addEventListener('resize', queueFit);

  const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function pitSlot(i, k) {
    const layer = Math.floor(k / 16), kk = k % 16;
    const r = 6.1 * Math.sqrt(kk + 0.6);
    const a = kk * 2.39996 + layer * 1.3 + rnd(i) * 6.28;
    return {
      x: Math.cos(a) * r * 1.04 + (rnd(i * 31 + k) - 0.5) * 3,
      y: Math.sin(a) * r * 1.0 + (rnd(i * 17 + k * 3) - 0.5) * 3 - layer * 3.5,
      r: (rnd(i * 7 + k * 11) * 360) | 0,
    };
  }
  function storeSlot(w, k) {
    const layer = Math.floor(k / 34), kk = k % 34;
    const r = 7 * Math.sqrt(kk + 0.6);
    const a = kk * 2.39996 + layer * 0.9 + w;
    return {
      x: Math.cos(a) * r * 0.86 + (rnd(w * 50 + k) - 0.5) * 3,
      y: Math.sin(a) * r * 1.95 + (rnd(w * 90 + k) - 0.5) * 3 - layer * 4,
      r: (rnd(w * 13 + k * 7) * 360) | 0,
    };
  }

  const pitsWrap = $('.pits');
  const pitEls = [];
  for (let i = 0; i < 14; i++) {
    const p = pitLocal(i);
    const el = document.createElement('div');
    el.className = 'pit ' + (i < 7 ? 'bottom' : 'top');
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.dataset.i = i;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', (i < 7 ? 'Your kuzhi ' + (i + 1) : 'Ammachi’s kuzhi ' + (i - 6)));
    el.innerHTML = '<i class="glow"></i><div class="seeds"></div><span class="count">5</span>';
    pitsWrap.appendChild(el);
    pitEls.push({ el, seeds: $('.seeds', el), count: $('.count', el) });
  }
  pitsWrap.insertAdjacentHTML('afterbegin', '<div class="row-glow top"></div><div class="row-glow bottom"></div>');
  const storeEls = [0, 1].map((w) => {
    const el = $(`.store[data-store="${w}"]`);
    return { el, seeds: $('.store-seeds', el), n: $('.store-n', el), label: $(`.sl-n[data-score="${w}"]`) };
  });

  function makeSeed(slot) {
    const s = document.createElement('span');
    s.className = 'seed';
    s.style.left = slot.x.toFixed(1) + 'px';
    s.style.top = slot.y.toFixed(1) + 'px';
    s.style.setProperty('--r', slot.r + 'deg');
    return s;
  }

  const bump = (el, ms) => el.animate([{ scale: 1 }, { scale: 1.35, offset: 0.4 }, { scale: 1 }], { duration: ms, easing: 'ease-out' });

  function setPit(i, n, dropLast) {
    const box = pitEls[i].seeds;
    while (box.children.length > n) box.lastChild.remove();
    while (box.children.length < n) {
      const s = makeSeed(pitSlot(i, box.children.length));
      if (dropLast) s.classList.add('drop');
      box.appendChild(s);
    }
    const c = pitEls[i].count;
    if (c.textContent !== String(n)) {
      c.textContent = n;
      bump(c, 350);
    }
    c.classList.toggle('zero', n === 0);
  }

  function setStore(w, n, doBump) {
    const s = storeEls[w];
    const box = s.seeds;
    const show = Math.min(n, 70);
    while (box.children.length > show) box.lastChild.remove();
    while (box.children.length < show) box.appendChild(makeSeed(storeSlot(w, box.children.length)));
    s.n.textContent = n;
    s.label.textContent = n;
    if (doBump) bump(s.n, 500);
  }

  function renderAll() {
    for (let i = 0; i < 14; i++) setPit(i, G.view.pits[i]);
    setStore(0, G.view.store[0]);
    setStore(1, G.view.store[1]);
  }

  /* ---------------- flying seeds + hand ---------------- */
  const flyLayer = $('.fly-layer');
  const handEl = $('.hand');
  const handSeeds = $('.hand-seeds');
  const handN = $('.hand-n');
  let handPos = { x: 640, y: 500 };

  function fly(froms, to, { dur = 420, stagger = 18, arc = 60, toSlot } = {}) {
    if (!froms.length) return Promise.resolve();
    const anims = froms.map((f, k) => {
      const el = makeSeed({ x: f.x, y: f.y, r: (rnd(k + f.x) * 360) | 0 });
      flyLayer.appendChild(el);
      const t = toSlot ? toSlot(k) : to;
      const dx = t.x - f.x, dy = t.y - f.y;
      const a = el.animate(
        [
          { transform: 'translate(0,0) scale(1)' },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px) scale(1.25)`, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(1)` },
        ],
        { duration: dur, delay: k * stagger, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' }
      );
      return a.finished.then(() => el.remove());
    });
    return Promise.all(anims);
  }

  function seedsOf(i) {
    const c = pitAt(i);
    return Array.from(pitEls[i].seeds.children).map((s) => {
      const d = vec(parseFloat(s.style.left), parseFloat(s.style.top));
      return { x: c.x + d.x, y: c.y + d.y };
    });
  }

  function setHand(n, at, ms) {
    if (at) {
      handPos = at;
      handEl.style.setProperty('--hand-ms', (ms || 220) + 'ms');
      handEl.style.translate = `${at.x}px ${at.y}px`;
    }
    handN.textContent = n;
    const show = Math.min(n, 7);
    while (handSeeds.children.length > show) handSeeds.lastChild.remove();
    while (handSeeds.children.length < show) {
      const k = handSeeds.children.length;
      const a = k * 2.4, r = k ? 5 + k * 1.6 : 0;
      handSeeds.appendChild(makeSeed({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8, r: k * 47 }));
    }
    handEl.classList.toggle('on', n > 0);
  }
  const handOver = (i) => { const c = pitAt(i), d = vec(0, i < 7 ? -52 : -48); return { x: c.x + d.x, y: c.y + d.y }; };

  /* ---------------- Ammachi: mood + speech ---------------- */
  const bubble = $('.bubble');
  const bT = $('.bubble-t'), bE = $('.bubble-e'), bAct = $('.bubble-actions');
  let moodTimer = 0, sayId = 0;

  function setMood(m, ms) {
    clearTimeout(moodTimer);
    paatiEl.dataset.mood = m;
    if (ms) moodTimer = setTimeout(() => (paatiEl.dataset.mood = 'normal'), ms);
  }

  async function say(line, mood = 'normal', opts = {}) {
    if (!line) return;
    const id = ++sayId;
    bubble.classList.remove('thinking', 'pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
    setMood(mood, opts.moodMs ?? (mood === 'normal' ? 0 : 2600));
    bE.textContent = line.e || '';
    bE.classList.remove('show');
    bAct.innerHTML = '';
    paatiEl.classList.add('talking');
    const txt = line.t;
    // the untyped rest sits there invisibly so the bubble is full size from the first letter
    const typed = document.createTextNode('');
    const rest = document.createElement('span');
    rest.className = 'bubble-rest';
    bT.replaceChildren(typed, rest);
    for (let k = 1; k <= txt.length; k += 2) {
      if (id !== sayId) return;
      typed.data = txt.slice(0, k);
      rest.textContent = txt.slice(k);
      await sleep(18);
    }
    bT.textContent = txt;
    paatiEl.classList.remove('talking');
    bE.classList.add('show');
    if (opts.actions) {
      for (const a of opts.actions) {
        const b = document.createElement('button');
        b.className = 'btn small' + (a.ghost ? ' ghost' : '');
        b.textContent = a.label;
        b.addEventListener('click', (e) => { e.stopPropagation(); sfx.tap(); a.fn(); });
        bAct.appendChild(b);
      }
    }
  }
  function thinking(on) { bubble.classList.toggle('thinking', on); }

  let lastQuip = 0;
  function quip(kind, mood, gap = 2200) {
    const now = Date.now();
    if (now - lastQuip < gap) return;
    lastQuip = now;
    say(PZ.paatiLine(kind), mood);
  }

  /* ---------------- narration bar ---------------- */
  const nChip = $('.narrate-chip'), nText = $('.narrate-text'), nHand = $('.narrate-hand');
  function narrate(html, who) {
    if (who !== undefined) {
      nChip.textContent = who === 0 ? 'Your move' : who === 1 ? `${O.short}’s move` : who;
      nChip.className = 'narrate-chip' + (who === 1 ? ' paati' : typeof who === 'string' ? ' learn' : '');
    }
    nText.innerHTML = html;
    nText.classList.remove('swap'); void nText.offsetWidth; nText.classList.add('swap');
  }

  /* ---------------- game state ---------------- */
  const G = {
    mode: 'menu',
    state: null,
    view: { pits: Array(14).fill(5), store: [0, 0] },
    awaitUser: false,
    animating: false,
    skip: false,
    games: 0,
    idleT: 0,
    tut: null,
    allowPit: null,
    gen: 0, // bumped whenever the board is replaced, so a move still animating knows to stand down
  };

  // Who sits across the board. Ammachi by default; a person in multiplayer.
  const AMMACHI = { short: 'Ammachi', N: 'Ammachi', n: 'Ammachi', poss: 'Ammachi’s', their: 'her', takes: '<b>she</b> takes' };
  const FRIEND = { short: 'Friend', N: 'Your friend', n: 'your friend', poss: 'your friend’s', their: 'their', takes: '<b>they</b> take' };
  const STRANGER = { short: 'Opponent', N: 'Your opponent', n: 'your opponent', poss: 'your opponent’s', their: 'their', takes: '<b>they</b> take' };
  let O = AMMACHI;
  // The other player's chosen name, or the generic friend/opponent wording when they gave none.
  function person(name, fallback) {
    if (!name) return fallback;
    return { short: name, N: name, n: name, poss: name + '’s', their: 'their', takes: `<b>${name}</b> takes` };
  }
  function setOpp(o) {
    O = o;
    $('.store-label.s1 b').textContent = `${o.short}’s kuzhi`;
    $('.row-label.top').textContent = `${o.short}’s row ← sowing`;
    $('.end-score div:last-child .es-l').textContent = o.short;
  }
  let MP = null; // the live multiplayer session, see the multiplayer section

  function syncView(st) {
    G.view.pits = st.pits.slice();
    G.view.store = st.store.slice();
  }

  /* ---------------- animation of a move ---------------- */
  const SP = () => settings.speed;

  async function animate(events, mover) {
    G.animating = true;
    G.animStart = performance.now();
    G.skip = false;
    let drops = 0, chainQuip = false;
    const sum = { cap: [0, 0], pasu: [0, 0], nothing: false, over: false, relays: 0 };
    const v = G.view;
    nHand.textContent = '';

    for (const ev of events) {
      if (G.skip) { applyInstant(ev, sum); continue; }
      const step = Math.max(55, (250 / SP()) * (drops > 40 ? 0.42 : drops > 18 ? 0.65 : 1));

      switch (ev.t) {
        case 'pick': {
          const froms = seedsOf(ev.pit);
          flash(ev.pit);
          if (ev.first) {
            narrate(ev.by === 0
              ? `You scoop <b>${seeds(ev.n)}</b> and drop them one by one, anticlockwise ${orient('→', '↓')}`
              : `${O.N} scoops <b>${seeds(ev.n)}</b> from ${O.their} row…`, ev.by);
            const h = handOver(ev.pit);
            handEl.style.setProperty('--hand-ms', '0ms');
            handEl.style.translate = `${h.x}px ${h.y}px`;
            handPos = h;
          } else {
            sum.relays++;
            narrate(`Last seed landed — the next kuzhi has <b>${seeds(ev.n)}</b>. Scoop them up and keep sowing!`);
            setHand(0, handOver(ev.pit), step * 0.8);
            await sleep(step * 0.8);
          }
          v.pits[ev.pit] = 0;
          setPit(ev.pit, 0);
          sfx.scoop(ev.n);
          await fly(froms, handPos, { dur: 300 / Math.sqrt(SP()), stagger: 10, arc: 24 });
          setHand(ev.n);
          await sleep(ev.first ? step * 1.4 : step);
          break;
        }
        case 'sow': {
          drops++;
          setHand(ev.left + 1, handOver(ev.pit), step * 0.7);
          await sleep(step * 0.7);
          v.pits[ev.pit]++;
          setPit(ev.pit, v.pits[ev.pit], true);
          setHand(ev.left);
          sfx.tok(owner(ev.pit) === 0 ? 1 : 0.9);
          if (drops === 34 && !chainQuip) { chainQuip = true; quip('longChain', 'shock', 0); nHand.textContent = 'tap to skip ⏩'; }
          await sleep(step * 0.3);
          break;
        }
        case 'pasu': {
          sum.pasu[ev.owner] += 4;
          mark(ev.pit, 'mark-pasu');
          narrate(`<b>Pasu!</b> That kuzhi hit 4 — it’s on ${ev.owner === 0 ? 'your row, so the 4 seeds are <b>yours</b>' : `${O.poss} row, so ${O.takes} them`}.`);
          sfx.jackpot();
          pasuBurst(ev.pit, ev.owner);
          await sleep(480 / SP());
          const froms = seedsOf(ev.pit);
          v.pits[ev.pit] = 0;
          setPit(ev.pit, 0);
          await fly(froms, null, { dur: 520 / Math.sqrt(SP()), stagger: 40, arc: 70, toSlot: (k) => storeTarget(ev.owner, v.store[ev.owner] + k) });
          v.store[ev.owner] += 4;
          setStore(ev.owner, v.store[ev.owner], true);
          await sleep(200 / SP());
          break;
        }
        case 'empty': {
          setHand(0);
          mark(ev.pit, 'mark-empty');
          narrate('Last seed landed, and the next kuzhi is <b>empty</b>…');
          await sleep(650 / SP());
          break;
        }
        case 'capture': {
          sum.cap[ev.by] += ev.n;
          mark(ev.pit, 'mark-cap');
          narrate(ev.by === 0
            ? `…so you <b>capture ${ev.n === 1 ? 'the 1 seed' : 'all ' + ev.n + ' seeds'}</b> in the kuzhi after it!`
            : `…so ${O.n} <b>grabs ${ev.n === 1 ? 'the 1 seed' : 'all ' + ev.n + ' seeds'}</b> in the kuzhi after it.`);
          await sleep(260 / SP());
          const froms = seedsOf(ev.pit);
          v.pits[ev.pit] = 0;
          setPit(ev.pit, 0);
          sfx.bell(ev.by === 0 ? 1046 : 784);
          await fly(froms, null, { dur: 620 / Math.sqrt(SP()), stagger: 26, arc: 90, toSlot: (k) => storeTarget(ev.by, v.store[ev.by] + k) });
          v.store[ev.by] += ev.n;
          setStore(ev.by, v.store[ev.by], true);
          await sleep(500 / SP());
          break;
        }
        case 'nothing': {
          sum.nothing = true;
          mark(ev.pit, 'mark-empty');
          narrate('…and the one after it is empty too. <b>Nothing to take</b> this time.');
          await sleep(900 / SP());
          break;
        }
        case 'sweep': {
          if (!sum.over) {
            sum.over = true;
            await sleep(400);
            narrate(`<b>${G.state && G.pendingStuck === 0 ? 'Your' : 'A'} row is empty</b> — round over! Seeds left on each row go to that row’s owner.`, 'Round over');
            await sleep(900);
          }
          const froms = seedsOf(ev.pit);
          v.pits[ev.pit] = 0;
          setPit(ev.pit, 0);
          fly(froms, null, { dur: 700, stagger: 22, arc: 80, toSlot: (k) => storeTarget(ev.owner, v.store[ev.owner] + k) }).then(() => {});
          v.store[ev.owner] += ev.n;
          await sleep(260);
          setStore(ev.owner, v.store[ev.owner], true);
          sfx.tok(0.8);
          break;
        }
        case 'over':
          sum.over = true;
          await sleep(900);
          break;
      }
    }

    setHand(0);
    nHand.textContent = '';
    await sleep(120);
    clearMarks();
    G.animating = false;
    return sum;
  }

  function applyInstant(ev, sum) {
    const v = G.view;
    if (ev.t === 'pick') { v.pits[ev.pit] = 0; if (!ev.first) sum.relays++; }
    else if (ev.t === 'sow') v.pits[ev.pit]++;
    else if (ev.t === 'pasu') { v.pits[ev.pit] = 0; v.store[ev.owner] += 4; sum.pasu[ev.owner] += 4; }
    else if (ev.t === 'capture') {
      v.pits[ev.pit] = 0; v.store[ev.by] += ev.n; sum.cap[ev.by] += ev.n;
      narrate(ev.by === 0 ? `Skipped ahead — you <b>captured ${seeds(ev.n)}</b> at the end.` : `Skipped ahead — ${O.n} <b>grabbed ${seeds(ev.n)}</b> at the end.`);
    } else if (ev.t === 'nothing') { sum.nothing = true; narrate('Skipped ahead — the move ended with <b>nothing to take</b>.'); }
    else if (ev.t === 'sweep') { v.pits[ev.pit] = 0; v.store[ev.owner] += ev.n; sum.over = true; }
    else if (ev.t === 'over') sum.over = true;
    renderAll();
  }

  function pasuBurst(i, who) {
    const c = pitAt(i);
    const el = document.createElement('div');
    el.className = 'pasu-burst ' + (who === 0 ? 'you' : 'paati');
    el.style.left = c.x + 'px';
    el.style.top = c.y + 'px';
    let rays = '';
    for (let k = 0; k < 14; k++) rays += `<i style="--a:${k * 25.7}deg;--d:${(k % 3) * 40}ms"></i>`;
    el.innerHTML = `<div class="pb-rays">${rays}</div><div class="pb-badge"><b>Pasu!</b><span>+4 ${who === 0 ? 'for you' : 'for ' + O.n}</span></div>`;
    flyLayer.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function storeTarget(w, k) {
    const c = storeAt(w);
    const s = storeSlot(w, Math.min(k, 69));
    const d = vec(s.x, s.y);
    return { x: c.x + d.x, y: c.y + d.y };
  }

  function flash(i) {
    const el = pitEls[i].el;
    // fades from full glow back to whatever the pit's state says (off, or lit if it's a target)
    $('.glow', el).animate([{ opacity: 1, offset: 0 }], { duration: 700, easing: 'cubic-bezier(.2, .9, .25, 1)' });
  }
  function mark(i, cls) { pitEls[i].el.classList.add(cls); }
  function clearMarks() {
    pitEls.forEach((p) => p.el.classList.remove('mark-cap', 'mark-empty', 'mark-pasu', 'flash', 'target', 'dim'));
  }

  /* ---------------- interaction ---------------- */
  function setPlayable(list) {
    pitEls.forEach((p, i) => p.el.classList.toggle('playable', !!list && list.includes(i)));
    $('.row-glow.bottom').classList.toggle('on', !!list && list.length > 0);
  }

  function rowGlow(who) {
    $('.row-glow.bottom').classList.toggle('on', who === 0);
    $('.row-glow.top').classList.toggle('on', who === 1);
  }

  pitsWrap.addEventListener('click', (e) => {
    const p = e.target.closest('.pit');
    if (!p) return;
    sfx.unlock();
    onPit(+p.dataset.i);
  });

  // move preview on hover: shows where the first handful lands
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  pitsWrap.addEventListener('mouseover', (e) => {
    if (!finePointer) return;
    const p = e.target.closest('.pit.playable');
    clearPreview();
    if (!p) return;
    const i = +p.dataset.i, n = G.view.pits[i];
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % 14;
      const dot = document.createElement('span');
      dot.className = 'pv' + (k === n ? ' last' : '');
      dot.style.animationDelay = k * 25 + 'ms';
      dot.style.translate = `${(k > 14 ? 8 : 0)}px ${(k > 14 ? 6 : 0)}px`;
      pitEls[j].el.appendChild(dot);
    }
  });
  pitsWrap.addEventListener('mouseleave', clearPreview);
  function clearPreview() { $$('.pv', pitsWrap).forEach((d) => d.remove()); }

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeRules(); if (!$('#mp').hidden) mpCancel(); return; }
    if (G.mode === 'menu') return;
    const k = parseInt(e.key, 10);
    if (k >= 1 && k <= 7) onPit(k - 1);
  });

  $('#screen-game').addEventListener('pointerdown', (e) => {
    if (G.animating && performance.now() - G.animStart > 600 && !e.target.closest('.g-tools, .bubble')) G.skip = true;
  });

  function onPit(i) {
    if (G.animating) return;
    if (G.mode === 'tutorial') {
      if (G.allowPit === i) { G.allowPit = null; pointer(null); tutMove(i); }
      return;
    }
    if (G.mode !== 'play' || !G.awaitUser) return;
    if (owner(i) !== 0) { quip(MP ? 'mpWrongSide' : 'wrongSide', 'smug'); return; }
    if (G.view.pits[i] === 0) { quip('emptyTap', 'smug'); return; }
    playerMove(i);
  }

  async function playerMove(i) {
    if (MP) {
      if (!MP.conn.up) { narrate('Connection lost. <b>Reconnecting…</b>', 'Offline'); return; }
      MP.conn.send({ t: 'move', pit: mpPit(i), n: MP.n });
      MP.n++;
    }
    G.awaitUser = false;
    clearTimeout(G.idleT);
    clearPreview();
    setPlayable(null);
    rowGlow(0);
    sfx.tap();
    await runMove(i);
  }

  async function runMove(i) {
    const mover = G.state.turn;
    const gen = G.gen;
    const r = PZ.applyMove(G.state, i, true);
    G.pendingStuck = r.state.over ? r.state.turn : null;
    const sum = await animate(r.events, mover);
    if (gen !== G.gen) return;
    G.state = r.state;
    syncView(G.state);
    renderAll();
    if (G.mode !== 'play') return;
    if (G.state.over) return endGame();
    await react(sum, mover);
    nextTurn();
  }

  async function react(sum, mover) {
    const you = mover === 0;
    const mine = sum.cap[mover];
    if (MP) {
      // Ammachi is only the umpire here, so she cheers for you instead of gloating
      // not awaited: the other player's next move must not wait for her to finish talking
      if (mine >= 6) say(PZ.paatiLine(you ? 'mpYouBig' : 'mpOppBig'), you ? 'happy' : 'shock');
      else if (you && sum.nothing && Math.random() < 0.3) say(PZ.paatiLine('youNothing'), 'smug');
      return;
    }
    if (sum.pasu[1] && !you) return say(PZ.paatiLine('paatiPasu'), 'happy');
    if (sum.pasu[0] && you && mine < 6) return say(PZ.paatiLine('youPasu'), 'smug');
    if (sum.pasu[1] && you) return say(PZ.paatiLine('paatiPasu'), 'happy');
    if (you) {
      if (mine >= 6) return say(PZ.paatiLine('youCaptureBig'), 'shock');
      if (mine > 0 && Math.random() < 0.5) return say(PZ.paatiLine('youCaptureSmall'), 'smug');
      if (sum.nothing && Math.random() < 0.45) return say(PZ.paatiLine('youNothing'), 'happy');
    } else {
      if (mine >= 6) return say(PZ.paatiLine('paatiCaptureBig'), 'happy');
      if (mine > 0 && Math.random() < 0.45) return say(PZ.paatiLine('paatiCaptureSmall'), 'smug');
    }
    const d = G.state.store[1] - G.state.store[0];
    if (Math.random() < 0.18) {
      if (d >= 8) return say(PZ.paatiLine('winning'), 'smug');
      if (d <= -8) return say(PZ.paatiLine('losing'), 'think');
    }
  }

  function nextTurn() {
    if (G.state.over) return endGame();
    if (G.state.turn === 0) {
      G.awaitUser = true;
      const legal = PZ.legalMoves(G.state);
      setPlayable(legal);
      rowGlow(0);
      narrate(`Your turn! Tap a glowing kuzhi on <b>your row</b> (${orient('bottom', 'left side')}) to scoop its seeds.`, 0);
      clearTimeout(G.idleT);
      G.idleT = setTimeout(() => G.awaitUser && say(PZ.paatiLine('idle'), 'smug'), 16000);
    } else if (MP) mpWait();
    else paatiTurn();
  }

  async function paatiTurn() {
    const gen = G.gen;
    rowGlow(1);
    narrate('Ammachi is thinking about her move…', 1);
    if (Math.random() < 0.6) say(PZ.paatiLine('thinking'), 'think', { moodMs: 0 });
    else setMood('think');
    thinking(true);
    const t0 = performance.now();
    await sleep(60);
    const m = PZ.chooseMove(G.state, settings.level);
    const wait = Math.max(0, (settings.level === 'hard' ? 1300 : 1000) / Math.sqrt(SP()) - (performance.now() - t0));
    await sleep(wait);
    if (G.mode !== 'play' || gen !== G.gen) return;
    thinking(false);
    setMood('normal');
    flash(m);
    pitEls[m].el.classList.add('target');
    await sleep(420 / SP());
    if (gen !== G.gen) return;
    await runMove(m);
  }

  /* ---------------- start / end ---------------- */
  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
  }

  const MOOD_LABEL = { easy: 'Chellam mood · easy', medium: 'Konjam serious · medium', hard: 'Ammachi mode · hard' };

  async function deal(state) {
    G.view.pits = Array(14).fill(0);
    G.view.store = state.store.slice();
    renderAll();
    const order = [...Array(14).keys()];
    for (let n = 1; n <= Math.max(...state.pits); n++) {
      for (const i of order) if (state.pits[i] >= n) { G.view.pits[i] = n; setPit(i, n, true); }
      sfx.tok(1.1);
      await sleep(70);
    }
    syncView(state);
    renderAll();
  }

  async function startGame() {
    mpDrop();
    setOpp(AMMACHI);
    const gen = ++G.gen;
    closeEnd();
    G.mode = 'play';
    G.tut = null;
    pointer(null);
    clearMarks();
    setPlayable(null);
    showScreen('screen-game');
    $('.np-mood').textContent = MOOD_LABEL[settings.level];
    const first = G.games % 2 === 0 ? 0 : 1;
    G.games++;
    G.state = PZ.newState(5, first);
    narrate('Dealing 5 seeds into every kuzhi…', 'New game');
    say(PZ.paatiLine(first === 1 ? 'helloPaatiFirst' : 'hello'), 'happy');
    await deal(G.state);
    await sleep(900);
    if (G.mode === 'play' && gen === G.gen) nextTurn();
  }

  function endGame() {
    G.awaitUser = false;
    setPlayable(null);
    rowGlow(-1);
    const [y, p] = G.state.store;
    const res = y > p ? 'win' : y < p ? 'lose' : 'tie';
    const line = MP
      ? PZ.paatiLine(res === 'win' ? 'mpWin' : res === 'lose' ? 'mpLose' : 'mpTie')
      : PZ.paatiLine(res === 'win' ? 'youWin' : res === 'lose' ? 'paatiWin' : 'tie');
    const mood = res === 'win' ? 'happy' : res === 'lose' ? 'happy' : 'smug';
    say(line, mood, { moodMs: 0 });
    narrate(`Round over — you <b>${y}</b>, ${O.n} <b>${p}</b>.`, 'Round over');
    sfx.fanfare(res !== 'lose');

    const end = $('#end');
    $('.end-face .paati').dataset.mood = res === 'win' ? 'happy' : res === 'lose' ? 'happy' : 'smug';
    if (MP) {
      $('.end-kicker').textContent = res === 'win' ? 'Ammachi is so proud' : res === 'lose' ? `${O.short} wins this round` : 'Equal-equal';
      $('.end-title').textContent = res === 'win' ? 'You won!' : res === 'lose' ? 'So close!' : 'Samam! A tie.';
      mpEndButtons();
    } else {
      $('.end-kicker').textContent = res === 'win' ? 'Ammachi is so proud' : res === 'lose' ? 'Ammachi wins, obviously' : 'Equal-equal';
      $('.end-title').textContent = res === 'win' ? 'You beat Ammachi!' : res === 'lose' ? 'Ammachi jeyichitaanga!' : 'Samam! A tie.';
    }
    $('[data-end="0"]').textContent = y;
    $('[data-end="1"]').textContent = p;
    $('.end-line').textContent = line.t;
    $('.end-line-e').textContent = line.e;
    if (MP && MP.oppRematch) mpRematchNote();
    const petals = $('.petals');
    petals.innerHTML = '';
    if (res === 'win') {
      for (let k = 0; k < 46; k++) {
        const s = document.createElement('i');
        s.className = 'petal';
        s.style.left = Math.random() * 100 + '%';
        s.style.animationDuration = 3 + Math.random() * 3 + 's';
        s.style.animationDelay = Math.random() * 2 + 's';
        s.style.setProperty('--dx', (Math.random() - 0.5) * 200 + 'px');
        s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
        petals.appendChild(s);
      }
    }
    setTimeout(() => { if (G.mode === 'play') end.hidden = false; }, 1600);
  }
  function closeEnd() {
    $('#end').hidden = true;
    const again = $('[data-action="again"]');
    again.hidden = false;
    again.disabled = false;
    again.textContent = 'Innoru round!';
  }

  function goHome() {
    if (MP) MP.conn.send({ t: 'leave' });
    mpDrop();
    setOpp(AMMACHI);
    G.gen++;
    G.mode = 'menu';
    G.awaitUser = false;
    G.skip = true;
    clearTimeout(G.idleT);
    closeEnd();
    pointer(null);
    sayId++;
    showScreen('screen-title');
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);
  }

  /* ---------------- multiplayer ---------------- */
  // The server keeps seats canonical (seat 0 owns pits 0..6). Everything above assumes "you" are
  // player 0 on the bottom row, so seat 1 simply sees the board turned half a circle: pit p
  // becomes (p + 7) % 14 and the two stores swap. The rules are symmetric under that turn.
  const mpPit = (p) => (MP.seat ? (p + 7) % 14 : p);
  const mpState = (s) => (MP.seat
    ? { pits: s.pits.slice(7).concat(s.pits.slice(0, 7)), store: [s.store[1], s.store[0]], turn: 1 - s.turn, over: s.over }
    : PZ.clone(s));

  const mpEl = $('#mp');
  const mpCard = $('.t-card.soon');
  if (PZ.net.ready) {
    mpCard.disabled = false;
    mpCard.removeAttribute('aria-disabled');
    mpCard.classList.remove('soon');
    mpCard.dataset.action = 'mp';
    $('.t-card-kicker', mpCard).textContent = 'With people';
    $('.stamp', mpCard).outerHTML = '<span class="t-card-note">A friend, or a random player</span>';
  }

  function mpView(view, status) {
    mpEl.hidden = false;
    $('.mp-name').hidden = view !== 'pick' && view !== 'invite';
    $('.mp-go').hidden = view !== 'invite';
    $('.mp-pick').hidden = view !== 'pick';
    $('.mp-join').hidden = view !== 'pick';
    $('.mp-code').hidden = view !== 'link';
    $('.mp-wait').hidden = view === 'pick' || view === 'invite';
    $('.mp-link').hidden = view !== 'link';
    $('.mp-dots').hidden = view === 'fail';
    $('.mp-wait [data-action="mp-cancel"]').textContent = view === 'fail' ? 'Close' : 'Cancel';
    if (status) $('.mp-status').innerHTML = status;
  }

  function mpOpen() {
    mpView('pick');
    $('.mp-join-err').hidden = true;
  }

  // Your display name for multiplayer. Same rules as the server: plain text, 16 characters.
  const cleanName = (s) => Array.from(String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, 16).join('').trim();
  const nameIn = $('.mp-name-in');
  try { nameIn.value = localStorage.getItem('pz-name') || ''; } catch (e) { /* private mode */ }
  function myName() {
    const n = cleanName(nameIn.value);
    try { n ? localStorage.setItem('pz-name', n) : localStorage.removeItem('pz-name'); } catch (e) { /* private mode */ }
    return n;
  }
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('.mp-go').hidden) { e.preventDefault(); mpGo(); }
  });

  // An invite link asks for your name first, then joins.
  function mpGo() {
    sfx.unlock();
    sfx.tap();
    mpView('wait', 'Joining the game…');
    mpJoin(MP_INVITE, 'friend');
  }
  let MP_INVITE = '';

  // Join a friend's room by typing the 5-letter code instead of opening their link.
  $('.mp-join').addEventListener('submit', (e) => {
    e.preventDefault();
    sfx.unlock();
    const input = $('.mp-code-in');
    const code = input.value.trim().toUpperCase();
    const err = $('.mp-join-err');
    if (!/^[A-Z2-9]{5}$/.test(code)) {
      err.textContent = 'A code is 5 letters or numbers, like K7M2P.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    input.value = '';
    sfx.tap();
    mpView('wait', 'Joining the game…');
    mpJoin(code, 'friend');
  });

  // Forget the session without telling the server (callers send 'leave' first when they mean it).
  function mpDrop() {
    if (!MP) return;
    clearInterval(MP.offerT);
    clearInterval(MP.clockT);
    nHand.classList.remove('hurry');
    MP.conn.close();
    MP = null;
  }

  function mpCancel() {
    if (MP && !MP.started) { MP.conn.send({ t: 'leave' }); mpDrop(); }
    mpEl.hidden = true;
    if (G.mode === 'menu' && location.search) history.replaceState(null, '', location.pathname);
  }

  async function mpFriend() {
    mpView('wait', 'Making a room…');
    try {
      const { code } = await PZ.net.create();
      mpJoin(code, 'friend');
    } catch (e) { mpFail(mpWhy(e)); }
  }

  const mpWhy = (e) => (e && e.status === 429 ? 'Too many games started from your network just now. Wait a minute and try again.'
    : e && e.status === 403 ? 'Could not confirm you are a person. Reload the page and try again.'
    : undefined);

  async function mpRandom(tries = 0) {
    mpView('wait', 'Looking for another player…');
    try {
      const { code } = await PZ.net.match();
      mpJoin(code, 'random', tries);
    } catch (e) { mpFail(mpWhy(e)); }
  }

  function mpFail(msg) {
    mpDrop();
    mpView('fail', msg || 'Could not reach the game server. Check your connection and try again.');
  }

  function mpCopy() {
    const input = $('.mp-url');
    const done = () => { $('[data-action="mp-copy"]').textContent = 'Copied ✓'; };
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, () => input.select());
    else { input.select(); document.execCommand('copy'); done(); }
  }

  function mpShare() {
    navigator.share({ title: 'Pallanguzhi', text: 'Play Pallanguzhi with me!', url: $('.mp-url').value }).catch(() => {});
  }

  function mpJoin(code, kind, tries = 0) {
    mpDrop();
    const me = (MP = { code, kind, tries, seat: 0, n: 0, game: 0, queue: [], started: false, peer: false, pumping: false, over: false, opp: '' });
    me.conn = PZ.net.open(code, {
      msg: (m) => MP === me && mpMsg(m),
      down: () => MP === me && me.started && G.mode === 'play' && narrate('Connection lost. <b>Reconnecting…</b>', 'Offline'),
    }, myName());
    // a lone player in a random room keeps the room on offer until someone turns up
    me.offerT = setInterval(() => { if (!me.started && me.kind === 'random') me.conn.send({ t: 'sync' }); }, 20000);
    me.clockT = setInterval(mpClock, 250);
    if (location.search !== '?room=' + code) history.replaceState(null, '', '/?room=' + code);
  }

  function mpMsg(m) {
    // random matches are timed: `left` is how long the player to move still has
    if (m.left !== undefined) { MP.due = m.left ? performance.now() + m.left : 0; MP.nagged = false; }
    if (m.t === 'hello' || m.t === 'start') {
      MP.seat = m.seat;
      MP.kind = m.kind;
      MP.peer = m.peer;
      if (m.names) mpOppName(m.names[1 - m.seat]);
      if (!m.state) {
        if (m.kind === 'friend') {
          $('.mp-url').value = `${location.origin}/?room=${MP.code}`;
          $('.mp-code b').textContent = MP.code;
          $('[data-action="mp-share"]').hidden = !navigator.share;
          mpView('link', 'Send this link to your friend. The game starts as soon as they open it.');
        } else mpView('wait', 'Looking for another player…');
        return;
      }
      if (!MP.started || m.game !== MP.game) mpBegin(m);
      else if (m.n !== MP.n + MP.queue.length) mpResync(m);
      else mpTurnNote();
      if (m.rematch && m.rematch[1 - m.seat] && m.state.over) mpRematchNote();
    } else if (m.t === 'move') {
      const known = MP.n + MP.queue.length;
      if (m.n <= known) return; // our own move coming back, or a repeat
      if (m.n !== known + 1 || m.by === MP.seat) return MP.conn.send({ t: 'sync' });
      MP.queue.push(m.pit);
      mpPump();
    } else if (m.t === 'peer') {
      MP.peer = m.on;
      if (m.on && m.name !== undefined) mpOppName(m.name);
      if (!m.on && MP.started && !MP.over) say(PZ.paatiLine('mpPeerOff'), 'think');
      mpTurnNote();
    } else if (m.t === 'rematch') mpRematchNote();
    else if (m.t === 'left') mpLeft(m.why === 'timeout' ? 'slow-them' : 'left');
    else if (m.t === 'timeout') mpLeft('slow-you');
    else if (m.t === 'goto') mpJoin(m.code, 'random', MP.tries);
    else if (m.t === 'err') {
      const { started, kind, tries } = MP;
      if (m.code === 'gone' && kind === 'random' && !started && tries < 3) return mpRandom(tries + 1);
      if (started && m.code === 'gone') return mpLeft();
      const why = m.code === 'full' ? 'That game already has two players.'
        : m.code === 'dup' ? 'This game was opened in another tab.'
        : 'That game is no longer open. Check the code, or ask your friend for a new link.';
      if (started) { goHome(); }
      mpFail(why);
    }
  }

  const mpOpp = () => person(MP.opp, MP.kind === 'random' ? STRANGER : FRIEND);

  function mpOppName(name) {
    MP.opp = cleanName(name);
    if (MP.started && G.mode === 'play') setOpp(mpOpp());
  }

  async function mpBegin(m) {
    const me = MP;
    const gen = ++G.gen;
    G.skip = true;
    me.started = true;
    me.over = false;
    me.oppRematch = false;
    me.game = m.game;
    me.n = m.n;
    me.queue = [];
    mpEl.hidden = true;
    closeEnd();
    G.mode = 'play';
    G.tut = null;
    G.awaitUser = false;
    pointer(null);
    clearMarks();
    setPlayable(null);
    showScreen('screen-game');
    setOpp(mpOpp());
    $('.np-mood').textContent = me.kind === 'random' ? 'Umpire · random match' : 'Umpire · friend match';
    G.state = mpState(m.state);
    if (m.n === 0) {
      narrate('Dealing 5 seeds into every kuzhi…', 'New game');
      say(PZ.paatiLine('mpStart'), 'happy');
      await deal(G.state);
      await sleep(900);
    } else {
      // joined part-way (reload): show the board as it stands
      syncView(G.state);
      renderAll();
    }
    if (MP === me && gen === G.gen && G.mode === 'play') nextTurn();
  }

  // Our board disagrees with the server's (a move was lost while offline). The server wins.
  async function mpResync(m) {
    const me = MP;
    const gen = ++G.gen;
    me.n = m.n;
    me.queue = [];
    G.skip = true;
    G.awaitUser = false;
    while (G.animating) await sleep(40);
    if (MP !== me || gen !== G.gen || G.mode !== 'play') return;
    G.state = mpState(m.state);
    syncView(G.state);
    renderAll();
    clearMarks();
    nextTurn();
  }

  function mpWait() {
    rowGlow(1);
    mpTurnNote();
    mpPump();
  }

  // Says whose turn it is, including when the other player has dropped off.
  function mpTurnNote() {
    if (!MP || !MP.started || MP.over || G.mode !== 'play' || G.animating || !G.state || G.state.over) return;
    if (G.state.turn === 0) {
      if (G.awaitUser) narrate(`Your turn! Tap a glowing kuzhi on <b>your row</b> (${orient('bottom', 'left side')}) to scoop its seeds.`, 0);
    } else if (MP.peer) narrate(`Waiting for ${O.n} to play…`, 1);
    else narrate(`${O.N} got disconnected. Waiting for them to come back…`, 1);
  }

  // Plays the other player's next move once the board is free.
  async function mpPump() {
    const me = MP;
    if (!me || me.pumping || G.animating || G.mode !== 'play' || !G.state || G.state.over || G.state.turn !== 1 || !me.queue.length) return;
    me.pumping = true;
    const gen = G.gen;
    const pit = mpPit(me.queue.shift());
    me.n++;
    flash(pit);
    pitEls[pit].el.classList.add('target');
    await sleep(420 / SP());
    me.pumping = false;
    if (MP !== me || gen !== G.gen) return;
    await runMove(pit);
  }

  // The move clock, shown beside the narration while someone is on the clock.
  function mpClock() {
    const on = MP && MP.started && !MP.over && MP.due && G.mode === 'play' && !G.animating && G.state && !G.state.over;
    if (!on) { nHand.classList.remove('hurry'); return; }
    const s = Math.max(0, Math.min(60, Math.ceil((MP.due - performance.now()) / 1000)));
    nHand.textContent = s === 60 ? '1:00' : '0:' + String(s).padStart(2, '0');
    nHand.classList.toggle('hurry', s <= 10);
    if (s <= 10 && s > 0 && G.state.turn === 0 && !MP.nagged) { MP.nagged = true; say(PZ.paatiLine('mpHurry'), 'shock'); }
  }

  function mpEndButtons() {
    MP.over = true;
    nHand.textContent = '';
    const again = $('[data-action="again"]');
    again.textContent = 'Innoru round!';
    again.disabled = false;
  }

  function mpRematch() {
    const again = $('[data-action="again"]');
    again.disabled = true;
    again.textContent = `Waiting for ${O.n}…`;
    MP.conn.send({ t: 'rematch' });
  }

  function mpRematchNote() {
    MP.oppRematch = true; // may arrive while the last move is still animating; endGame reapplies it
    $('.end-line-e').textContent = `${O.N} wants another round!`;
  }

  // The game was stopped: the other player left for good, or someone ran out of time.
  function mpLeft(why = 'left') {
    const wasOver = MP.over;
    const name = O;
    mpDrop();
    G.gen++;
    G.skip = true;
    G.awaitUser = false;
    clearTimeout(G.idleT);
    setPlayable(null);
    rowGlow(-1);
    nHand.textContent = '';
    const line = PZ.paatiLine(why === 'left' ? 'mpLeft' : 'mpTimeUp');
    const what = why === 'left' ? `${name.N} left the game.` : why === 'slow-you' ? 'You ran out of time.' : `${name.N} ran out of time.`;
    say(line, 'think', { moodMs: 0 });
    narrate(what, 'Game over');
    $('.end-face .paati').dataset.mood = 'think';
    $('.end-kicker').textContent = why === 'left' ? 'Game over' : why === 'slow-you' ? 'You took too long' : `${name.short} took too long`;
    $('.end-title').textContent = why === 'left' ? `${name.short} left` : why === 'slow-you' ? 'Time’s up!' : 'You win on time!';
    if (!wasOver) {
      $('[data-end="0"]').textContent = G.view.store[0];
      $('[data-end="1"]').textContent = G.view.store[1];
      $('.end-line').textContent = line.t;
      $('.end-line-e').textContent = line.e;
      $('.petals').innerHTML = '';
    } else $('.end-line-e').textContent = what;
    $('[data-action="again"]').hidden = true;
    $('#end').hidden = false;
  }

  /* ---------------- tutorial: Ammachi's palgalaikazhagam ---------------- */
  const val = (v) => (typeof v === 'function' ? v() : v);
  const P = (you, paati, store = [0, 0]) => ({ pits: [...you, ...paati], store, turn: 0, over: false });
  const TUT = [
    {
      state: P([5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5]),
      say: { t: 'Vaa kanna! Rendu nimishathula Pallanguzhi solli tharen.', e: 'Come! I’ll teach you Pallanguzhi in two minutes.' },
      narr: 'Welcome to <b>Ammachi’s palgalaikazhagam</b>. Press <b>Next</b> in Ammachi’s speech bubble to continue.',
    },
    {
      state: P([5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5]),
      glow: 'both',
      say: () => orient(
        { t: 'Keela irukkura 7 kuzhi unnodadhu. Mela 7 ennodadhu.', e: 'The 7 pits at the bottom are yours. The 7 at the top are mine.' },
        { t: 'Un pakkam irukkura 7 kuzhi unnodadhu. Andha pakkam 7 ennodadhu.', e: 'The 7 pits on the left are yours. The 7 on the right are mine.' }),
      narr: 'This is the board: <b>14 kuzhis</b> (pits). Each one starts with <b>5 seeds</b>, so 70 in all. The ends of the board hold your captured seeds.',
    },
    {
      title: 'Sowing',
      state: P([0, 3, 0, 0, 0, 0, 0], [2, 1, 2, 3, 1, 2, 1]),
      target: 1,
      say: { t: 'Indha kuzhi-a thodu. Ellaa seeds-um eduthu, oru kuzhi-ku onnu podu.', e: 'Tap this pit. Take all its seeds and drop one in each pit after it.' },
      narr: () => `<b>Sowing:</b> tap the glowing kuzhi. You’ll scoop its 3 seeds and drop one into each kuzhi going <b>anticlockwise</b> (${orient('left → right', 'top → bottom')} on your row).`,
      post: { t: 'Paathiyaa? Onnu, onnu, onnu. Adhu dhaan vidhaippu.', e: 'See? One, one, one. That is sowing.' },
      postNarr: 'One seed per kuzhi. The move ended because the next kuzhi was empty, and the one after it was too. More on that soon.',
    },
    {
      title: 'Relay',
      state: P([2, 0, 0, 2, 0, 0, 0], [0, 2, 3, 1, 2, 3, 1]),
      target: 0,
      say: { t: 'Kadaisi seed vizhundha apram, adutha kuzhi-la seeds irundhaa? Adha-yum eduthu thodarndhu podu!', e: 'After the last seed, if the next pit has seeds, scoop those too and keep going!' },
      narr: '<b>Keep going:</b> when your last seed lands, look at the <b>next</b> kuzhi. If it has seeds, scoop them up and keep sowing. Tap the glowing kuzhi.',
      post: { t: 'Rail vandi maadhiri thodarndhu pogum. Romba fun!', e: 'It chains along like a train. Lots of fun!' },
      postNarr: 'The last seed landed next to a kuzhi with 2 seeds, so you scooped those and carried on. One move can wrap around the whole board!',
    },
    {
      title: 'Capture',
      state: P([0, 0, 0, 0, 2, 0, 0], [0, 6, 2, 1, 2, 3, 1]),
      target: 4,
      say: { t: 'Ippo dhaan important. Adutha kuzhi kaali-naa, adhukku apram irukkura kuzhi unnodadhu!', e: 'The important bit: if the next pit is empty, the pit after it is yours!' },
      narr: '<b>Capture:</b> if the kuzhi after your last seed is <b>empty</b>, you take every seed in the kuzhi <b>just beyond it</b>. Try it, and watch Ammachi’s 6 seeds.',
      post: { t: 'Aiyo! En 6 seeds-a eduthutta! Nalla student dhaan.', e: 'Oh no, you took my 6 seeds! Good student.' },
      postNarr: () => `Captured seeds go into <b>your big kuzhi</b> at the ${orient('right', 'bottom')} end of the board. That’s how you score. Then your turn ends.`,
      postMood: 'shock',
    },
    {
      title: 'Pasu',
      state: P([0, 3, 1, 3, 0, 0, 0], [2, 1, 2, 1, 2, 1, 2]),
      target: 1,
      say: { t: 'Oru kuzhi-la sariyaa 4 seeds aana — adhu Pasu! Andha row-oda owner-ku pogum.', e: 'If a pit reaches exactly 4 seeds, that’s a Pasu! It goes to the owner of that row.' },
      narr: '<b>Pasu (the cow):</b> while sowing, any kuzhi that reaches <b>exactly 4</b> is taken right away by whoever owns that row. Tap to make one!',
      post: { t: 'Moo! Un pakkam pasu, adhanaala unakku dhaan. En pakkam aana, enakku!', e: 'Moo! The cow was on your side, so it’s yours. On my side, it would be mine!' },
      postNarr: 'Watch for 4s on <b>both</b> rows. Ammachi’s sowing can hand you a pasu too, and yours can hand her one.',
      postMood: 'happy',
    },
    {
      title: 'Winning',
      state: P([0, 2, 0, 1, 0, 0, 3], [0, 0, 0, 0, 0, 0, 0], [30, 34]),
      say: { t: 'Yaar row-la seeds illaiyo, avanga turn vandhaa — game over. Adhigam seeds irukkuravanga jeyippaanga.', e: 'When it’s someone’s turn and their row is empty, the game ends. Most seeds wins.' },
      narr: '<b>Winning:</b> when the player to move has an <b>empty row</b>, the round ends. Seeds left on a row go to its owner. More than <b>35 of 70</b> wins.',
    },
    {
      state: P([5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5]),
      say: { t: 'Avlo dhaan! Ippo unakku theriyum. Vaa, Ammachi kooda oru game aadalaam?', e: 'That’s it! Now you know. Shall we play a real game?' },
      narr: 'Remember: <b>sow</b> → <b>keep going</b> if the next kuzhi has seeds → <b>capture</b> past an empty kuzhi. And watch for <b>pasu</b> 4s!',
      final: true,
    },
  ];

  async function startTutorial() {
    closeEnd();
    G.mode = 'tutorial';
    G.tut = 0;
    showScreen('screen-game');
    $('.np-mood').textContent = 'Teacher mode';
    tutStep(0);
  }

  async function tutStep(k) {
    if (G.mode !== 'tutorial') return;
    G.tut = k;
    const s = TUT[k];
    clearMarks();
    setPlayable(null);
    pointer(null);
    G.allowPit = null;
    G.state = PZ.clone(s.state);
    syncView(G.state);
    renderAll();
    rowGlow(s.glow === 'both' ? 0 : -1);
    if (s.glow === 'both') $('.row-glow.top').classList.add('on');
    narrate(val(s.narr), `Lesson ${k + 1}/${TUT.length}`);
    if (s.target != null) {
      pitEls[s.target].el.classList.add('target', 'playable');
      pitEls.forEach((p, i) => { if (i !== s.target && i < 7 && G.view.pits[i] === 0) p.el.classList.add('dim'); });
      await say(val(s.say), 'normal');
      if (G.tut !== k) return;
      G.allowPit = s.target;
      pointer(s.target);
    } else {
      const actions = s.final
        ? [{ label: 'Play Ammachi →', fn: startGame }, { label: 'Again', ghost: true, fn: () => tutStep(0) }]
        : [{ label: 'Next →', fn: () => tutStep(k + 1) }].concat(k > 0 ? [{ label: 'Back', ghost: true, fn: () => tutStep(k - 1) }] : []);
      await say(val(s.say), s.final ? 'happy' : 'normal', { actions });
    }
  }

  async function tutMove(i) {
    const k = G.tut;
    const s = TUT[k];
    clearMarks();
    setPlayable(null);
    sfx.tap();
    const speed = settings.speed;
    settings.speed = Math.min(speed, 1) * 0.8; // slower so the lesson reads
    const r = PZ.applyMove(G.state, i, true);
    await animate(r.events, 0);
    settings.speed = speed;
    G.state = r.state;
    if (G.mode !== 'tutorial' || G.tut !== k) return;
    narrate(val(s.postNarr), `Lesson ${k + 1}/${TUT.length}`);
    say(s.post, s.postMood || 'happy', {
      moodMs: 0,
      actions: [{ label: 'Next →', fn: () => tutStep(k + 1) }, { label: 'Try again', ghost: true, fn: () => tutStep(k) }],
    });
  }

  const pointerEl = $('.pointer');
  let pointerAt = null;
  function pointer(i) {
    pointerAt = i;
    if (i == null) { pointerEl.classList.remove('on'); return; }
    const c = pitAt(i);
    // portrait: the hand sits left of the upright board, finger pointing right
    pointerEl.style.left = (PORT ? c.x - 45 * BOARD.k - 70 : c.x - 14) + 'px';
    pointerEl.style.top = (PORT ? c.y - 32 : c.y + 18) + 'px';
    pointerEl.classList.add('on');
  }

  /* ---------------- rules sheet ---------------- */
  const miniXY = (i) => ({ x: 80 + (i < 7 ? i : 13 - i) * 47, y: i < 7 ? 116 : 50 });
  function mini(pits, cls = {}, arrows = [], cap = '') {
    let h = '';
    pits.forEach((n, i) => {
      const p = miniXY(i);
      let seeds = '';
      for (let k = 0; k < Math.min(+n || 0, 12); k++) {
        const sl = pitSlot(i + 3, k);
        seeds += `<span class="seed" style="left:${(sl.x * 0.62).toFixed(1)}px;top:${(sl.y * 0.62).toFixed(1)}px;--r:${sl.r}deg"></span>`;
      }
      h += `<div class="mpit ${cls[i] || ''}" style="left:${p.x}px;top:${p.y}px"><div class="seeds">${seeds}</div>${n === '' ? '' : `<span class="mcount${+n === 0 ? ' zero' : ''}">${n}</span>`}</div>`;
    });
    let svg = '<svg class="flow" viewBox="0 0 440 166"><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill="#F4C46A"/></marker></defs>';
    arrows.forEach(([a, b, bend = 22]) => {
      const p = miniXY(a), q = miniXY(b);
      const off = (i) => (i < 7 ? 25 : -25);
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2 + (a < 7 && b < 7 ? bend : -bend);
      svg += `<path d="M${p.x} ${p.y + off(a)} Q${mx} ${my + off(a)} ${q.x} ${q.y + off(b)}" stroke="#F4C46A" stroke-width="2.2" fill="none" stroke-dasharray="4 4" stroke-linecap="round" marker-end="url(#ah)"/>`;
    });
    svg += '</svg>';
    return `<div class="rule-art"><div class="mini"><div class="mini-grain"></div><span class="mstore l"></span><span class="mstore r"></span>${h}${svg}</div><div class="mini-cap">${cap}</div></div>`;
  }

  const RULES = [
    {
      h: 'The board', ta: 'பல்லாங்குழி பலகை',
      p: ['Pallanguzhi is played on a wooden board with <b>14 kuzhis</b> (pits) in two rows of seven.',
        'The <b>bottom row is yours</b> and the <b>top row is Ammachi’s</b>. Every kuzhi starts with <b>5 seeds</b>.'],
      tip: '“Pallanguzhi” means “many pits”. Tamil homes have played it for centuries, often with manjadi seeds, tamarind seeds or cowrie shells.',
      art: mini(Array(14).fill(5), {}, [], 'Bottom row: yours · Top row: Ammachi’s'),
    },
    {
      h: 'Sowing', ta: 'விதைத்தல்',
      p: ['On your turn, pick any <b>non-empty kuzhi on your row</b> and scoop out all its seeds.',
        'Drop them <b>one by one</b> into the following kuzhis, <b>anticlockwise</b>: left to right along your row, then right to left along Ammachi’s.'],
      tip: 'Tip: on desktop, hover over a kuzhi to see where your seeds will land.',
      art: mini([0, 0, '', 1, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2], { 2: 'hl', 3: 'hl', 4: 'hl', 5: 'hl' }, [[2, 3], [3, 4], [4, 5]], '3 seeds → one each into the next 3 kuzhis'),
    },
    {
      h: 'Keep going', ta: 'தொடர்ந்து ஆடு',
      p: ['When your last seed drops, look at the <b>next kuzhi</b>.',
        'If it has seeds, <b>scoop them all</b> and keep sowing from there. One move can wind around the board many times!'],
      tip: 'Long chains are where the fun (and the chaos) is. Tap anywhere to fast-forward a long move.',
      art: mini([0, 1, 1, 4, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2], { 2: 'hl', 3: 'hl' }, [[2, 3, 18], [3, 6, 30]], 'Last seed at ③ → next has 4 → scoop & continue'),
    },
    {
      h: 'Capture', ta: 'கைப்பற்றுதல்',
      p: ['If the kuzhi after your last seed is <b>empty</b>, skip over it and <b>take every seed</b> in the kuzhi just beyond.',
        'Those seeds go into your big kuzhi at the end of the board, and your turn ends. If both kuzhis are empty, you get nothing.'],
      tip: 'Set traps: leave an empty kuzhi right before a fat one on Ammachi’s row.',
      art: mini([0, 0, 0, 0, 0, 1, 1, 0, 7, 2, 2, 2, 2, 2], { 6: 'hl', 7: 'empty', 8: 'cap' }, [[6, 8, 40]], 'Last seed → empty → you take the 7'),
    },
    {
      h: 'Pasu · the cow', ta: 'பசு',
      p: ['While sowing, if any kuzhi reaches <b>exactly 4 seeds</b>, it’s a <b>pasu</b>!',
        'Those 4 seeds go straight to <b>whoever owns that row</b>, even in the middle of the other player’s move.'],
      tip: 'Ammachi counts 3s on your row very carefully. You should too.',
      art: mini([0, 0, 3, 1, 3, 0, 0, 2, 1, 2, 1, 2, 1, 2], { 4: 'pasu' }, [[2, 3], [3, 4]], '3 + 1 = 4 → pasu! The row owner takes it'),
    },
    {
      h: 'Winning', ta: 'வெற்றி',
      p: ['When it’s someone’s turn and <b>their row is empty</b>, the round ends.',
        'Seeds left on each row go to that row’s owner. Get <b>more than 35</b> of the 70 seeds to win.'],
      tip: 'In the traditional game, rounds continue and kuzhis a player can’t refill get “burnt”. Here we play one quick round.',
      art: mini([2, 0, 1, 0, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0], { 7: 'empty', 8: 'empty', 9: 'empty', 10: 'empty', 11: 'empty', 12: 'empty', 13: 'empty' }, [], 'Ammachi’s row is empty on her turn → round over'),
    },
  ];
  let rulePage = 0;
  $('.rules-pages').innerHTML = RULES.map((r, k) => `
    <div class="rule-page" data-k="${k}">
      <div>
        <span class="rule-ta-num" aria-hidden="true">${'௧௨௩௪௫௬'[k]}</span>
        <div class="rule-num">Rule ${k + 1} of ${RULES.length}</div>
        <h3>${r.h}<span class="ta">${r.ta}</span></h3>
        ${r.p.map((x) => `<p>${x}</p>`).join('')}
        <div class="rule-tip">${r.tip}</div>
      </div>
      ${r.art}
    </div>`).join('');
  $('.rules-dots').innerHTML = RULES.map((_, k) => `<button data-k="${k}" aria-label="Rule ${k + 1}"><span class="seed"></span></button>`).join('');
  $('.rules-dots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showRule(+b.dataset.k); });
  function showRule(k) {
    rulePage = Math.max(0, Math.min(RULES.length - 1, k));
    $$('.rule-page').forEach((p, i) => p.classList.toggle('on', i === rulePage));
    $$('.rules-dots button').forEach((b, i) => b.classList.toggle('on', i === rulePage));
    $('[data-action="rules-prev"]').disabled = rulePage === 0;
    $('[data-action="rules-next"]').textContent = rulePage === RULES.length - 1 ? 'Got it ✓' : 'Next →';
  }
  function openRules() { $('#rules').hidden = false; showRule(0); }
  function closeRules() { $('#rules').hidden = true; }

  /* ---------------- buttons + options ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    sfx.unlock();
    const a = b.dataset.action;
    if (a === 'again' && MP) { sfx.tap(); mpRematch(); }
    else if (a === 'play' || a === 'again') { sfx.tap(); startGame(); }
    else if (a === 'mp') { sfx.tap(); mpOpen(); }
    else if (a === 'mp-friend') { sfx.tap(); mpFriend(); }
    else if (a === 'mp-random') { sfx.tap(); mpRandom(); }
    else if (a === 'mp-cancel') mpCancel();
    else if (a === 'mp-go') mpGo();
    else if (a === 'mp-copy') mpCopy();
    else if (a === 'mp-share') mpShare();
    else if (a === 'learn') { sfx.tap(); startTutorial(); }
    else if (a === 'rules') { sfx.tap(); openRules(); }
    else if (a === 'close-rules') closeRules();
    else if (a === 'rules-prev') showRule(rulePage - 1);
    else if (a === 'rules-next') { if (rulePage === RULES.length - 1) closeRules(); else showRule(rulePage + 1); }
    else if (a === 'home') goHome();
    else if (a === 'sound') { settings.sound = !settings.sound; applySettings(); save(); }
    else if (a === 'speed') { settings.speed = settings.speed === 1 ? 2 : settings.speed === 2 ? 3 : 1; applySettings(); save(); }
  });
  $('#rules').addEventListener('click', (e) => { if (e.target.id === 'rules') closeRules(); });

  $$('.chips').forEach((group) => {
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      sfx.unlock(); sfx.tok(1.2);
      settings[group.dataset.opt] = b.dataset.v;
      applySettings(); save();
    });
  });

  function applySettings() {
    $$('.chips').forEach((g) => $$('button', g).forEach((b) => b.classList.toggle('on', b.dataset.v === settings[g.dataset.opt])));
    document.body.dataset.seed = settings.seed;
    sfx.enabled = settings.sound;
    $('[data-action="sound"]').classList.toggle('muted', !settings.sound);
    $('.speed-label').textContent = settings.speed + '×';
  }

  // idle Ammachi on title — she blinks and her coffee steams; seed the board for the background
  applySettings();
  fit();
  syncView(PZ.newState());
  renderAll();

  // deep links from the articles: /#play, /#learn, /#rules
  function route() {
    const h = location.hash.slice(1);
    if (h === 'play') startGame();
    else if (h === 'learn') startTutorial();
    else if (h === 'rules') openRules();
  }
  addEventListener('hashchange', route);
  route();

  // invite links: /?room=ABCDE
  const invite = new URLSearchParams(location.search).get('room');
  if (invite && PZ.net.ready && /^[A-Za-z2-9]{5}$/.test(invite)) {
    MP_INVITE = invite.toUpperCase();
    mpView('invite');
    nameIn.focus();
  }
})();
