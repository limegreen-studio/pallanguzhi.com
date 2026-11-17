/* Multiplayer transport: talks to the Worker in server/. Game logic stays in game.js. */
(function () {
  const PZ = (window.PZ = window.PZ || {});

  // The deployed Worker, e.g. 'https://pallanguzhi-mp.<account>.workers.dev'.
  // While this is empty the Multiplayer card stays "Coming soon" outside localhost.
  const PROD = 'https://pallanguzhi-mp.harshnpatel.workers.dev';
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const base = LOCAL ? `http://${location.hostname}:8787` : PROD;

  // Cloudflare Turnstile sitekey: proves a person, not a script, is starting the game.
  // Empty = no check. On localhost, run `localStorage.setItem('pz-ts', '1')` to try it with
  // Cloudflare's always-pass test key (the Worker needs server/.dev.vars, see .dev.vars.example).
  const SITEKEY_PROD = '';
  let SITEKEY = SITEKEY_PROD;
  if (LOCAL) { try { SITEKEY = localStorage.getItem('pz-ts') ? '1x00000000000000000000AA' : ''; } catch (e) { SITEKEY = ''; } }

  let widget = null;
  function token() {
    if (!SITEKEY) return Promise.resolve('');
    widget = widget || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.onload = resolve;
      s.onerror = () => { widget = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    // a token works once, so every request gets a fresh widget; it only shows itself if
    // Cloudflare wants the visitor to click something
    return widget.then(() => new Promise((resolve, reject) => {
      const id = window.turnstile.render(document.querySelector('.mp-human'), {
        sitekey: SITEKEY,
        appearance: 'interaction-only',
        callback: (t) => { window.turnstile.remove(id); resolve(t); },
        'error-callback': () => { window.turnstile.remove(id); reject(Object.assign(new Error('turnstile'), { status: 403 })); },
      });
    }));
  }

  // One id per browser, so a reload or a dropped connection gets the same seat back.
  function playerId() {
    const make = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    try {
      let id = localStorage.getItem('pz-pid');
      if (!id) localStorage.setItem('pz-pid', (id = make()));
      return id;
    } catch (e) {
      return (playerId.mem = playerId.mem || make()); // private mode
    }
  }

  async function post(path) {
    const body = await token();
    const r = await fetch(base + path, { method: 'POST', body: body || undefined });
    if (!r.ok) throw Object.assign(new Error('server said ' + r.status), { status: r.status });
    return r.json();
  }

  // Opens a room socket that reconnects by itself until close() or a fatal server error.
  // on.msg(m) for every server message, on.down() when the line drops, on.up() when it is back.
  function open(code, on) {
    let ws = null, dead = false, tries = 0, pingT = 0, retryT = 0;
    const conn = { up: false, send, close };

    function connect() {
      ws = new WebSocket(`${base.replace(/^http/, 'ws')}/room/${code}/ws?pid=${playerId()}`);
      ws.onopen = () => {
        tries = 0;
        conn.up = true;
        clearInterval(pingT);
        pingT = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000);
        on.up && on.up();
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'err' || m.t === 'left' || m.t === 'timeout' || m.t === 'goto') dead = true; // the room is finished with us
        on.msg(m);
      };
      ws.onclose = () => {
        const was = conn.up;
        conn.up = false;
        clearInterval(pingT);
        if (dead) return;
        if (was && on.down) on.down();
        retryT = setTimeout(connect, Math.min(8000, 500 * 2 ** tries++));
      };
    }

    function send(m) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    }

    function close() {
      dead = true;
      conn.up = false;
      clearTimeout(retryT);
      clearInterval(pingT);
      if (ws) ws.close();
    }

    connect();
    return conn;
  }

  PZ.net = { ready: !!base, create: () => post('/room'), match: () => post('/match'), open };
})();
