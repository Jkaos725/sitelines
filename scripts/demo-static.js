/* sitelines hosted demo - static mode.
   The viewer talks to a small HTTP API. On GitHub Pages there is no server, so
   this shim answers those calls from files on disk plus browser storage: the
   scan is a static JSON file, and everything the viewer writes (queued changes,
   views, card positions, notes) lives in localStorage for this browser only.
   It is loaded only by the built demo page - `sitelines serve` never sees it. */
(function () {
  var KEY = 'sitelines:demo:v1';
  var real = window.fetch.bind(window);
  var state = load();

  function load() {
    var d = { edits: [], views: null, layout: {}, notes: {} };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return d; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota */ } }
  function json(v) {
    return Promise.resolve(new Response(JSON.stringify(v), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  window.fetch = function (input, init) {
    var req = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u;
    try { u = new URL(req, location.href); } catch (e) { return real(input, init); }
    var m = /\/api\/(flow|edits|views|layout|rescan)$/.exec(u.pathname);
    if (!m) return real(input, init);
    var api = m[1];
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var body = init && init.body ? JSON.parse(init.body) : null;

    if (api === 'flow') {
      return real('./api/flow.json').then(function (r) { return r.json(); }).then(function (flow) {
        flow.layout = Object.assign({}, flow.layout, state.layout);
        flow.notes = Object.assign({}, flow.notes, state.notes);
        return json(flow);
      });
    }
    if (api === 'edits') {
      if (method === 'POST') {
        var edit = Object.assign(
          { id: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 999), at: new Date().toISOString(), status: 'pending' },
          body
        );
        state.edits.push(edit); save();
        return json(edit);
      }
      if (method === 'DELETE') {
        var id = u.searchParams.get('id');
        state.edits = state.edits.filter(function (e) { return id ? e.id !== id : false; });
        save();
        return json({ ok: true, remaining: state.edits.length });
      }
      return json(state.edits);
    }
    if (api === 'views') {
      if (method === 'POST') { state.views = body; save(); return json(body); }
      if (state.views) return json(state.views);
      return real('./api/views.json').then(function (r) { return r.json(); }).then(json);
    }
    if (api === 'layout') {
      if (body && body.layout) state.layout = Object.assign(state.layout, body.layout);
      if (body && body.notes) state.notes = Object.assign(state.notes, body.notes);
      save();
      return json({ ok: true });
    }
    // rescan needs the scanner, which needs a filesystem
    return json({ ok: false, out: 'Rescan needs the real scanner. Run `npx sitelines demo` locally.' });
  };

  // one line of context, so nobody reports the sandbox as a bug
  window.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.id = 'demo-note';
    b.innerHTML = 'Hosted demo of the bundled example site. Everything works except writing to disk — '
      + 'queued changes stay in this browser. <code>npx sitelines demo</code> gives you the real thing.'
      + '<button type="button" aria-label="Dismiss">✕</button>';
    b.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;'
      + 'display:flex;gap:10px;align-items:center;max-width:min(680px,92vw);'
      + 'padding:8px 10px 8px 14px;border-radius:999px;'
      + 'font:12px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;'
      + 'background:var(--surface,#fff);color:var(--text-2,#454c59);'
      + 'border:1px solid var(--line,#e2e5ea);box-shadow:0 6px 24px rgba(8,12,20,.14)';
    var btn = b.querySelector('button');
    btn.style.cssText = 'flex:none;border:0;background:none;color:inherit;cursor:pointer;'
      + 'font-size:12px;line-height:1;padding:4px;opacity:.6';
    btn.addEventListener('click', function () { b.remove(); });
    var code = b.querySelector('code');
    code.style.cssText = 'font-family:ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;'
      + 'background:var(--surface-2,#f6f7f9);padding:1px 5px;border-radius:5px;white-space:nowrap';
    document.body.appendChild(b);
  });
}());
