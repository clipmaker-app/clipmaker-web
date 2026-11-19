const API = 'https://clipmaker-backend-1-su2p.onrender.com';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 4500); };
const copy = t => navigator.clipboard.writeText(t).then(() => toast('Copiado ✅'), () => toast('No se pudo copiar'));

const PLANS = {
  gratis:  { name: 'Gratis',  price: 0,  clips: 2,   max: 30 },
  basico:  { name: 'Básico',  price: 5,  clips: 30,  max: 60 },
  premium: { name: 'Premium', price: 10, clips: 100, max: 120 },
  vip:     { name: 'VIP',     price: 20, clips: 300, max: 180 }
};
const COINS = {
  BTC:  { label: '₿ Bitcoin (BTC)',  net: 'Bitcoin' },
  USDT: { label: '💲 USDT (TRC20)',  net: 'TRON (TRC20)' },
  ETH:  { label: 'Ξ Ethereum (ETH)', net: 'Ethereum (ERC20)' },
  USDC: { label: '💲 USDC',          net: 'Ethereum (ERC20)' }
};

let token = localStorage.getItem('cm_token') || '';
let ownerToken = '';                       // solo en memoria: se pide el PIN cada vez
let me = null, wallets = {}, summary = null;
let mode = 'login', dur = 90, planPick = 'gratis', coin = 'BTC', filter = 'todos';
let sourceFile = null, sourceLink = '', sourceIsLive = false, pollTimer = null;

/* ---------- API ---------- */
async function api(path, { method = 'GET', body, owner = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = owner ? ownerToken : token;
  if (t) headers.Authorization = 'Bearer ' + t;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('No se pudo conectar al servidor. Si estaba dormido, espera 50 segundos e inténtalo de nuevo.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Error del servidor'); e.status = res.status; throw e; }
  return data;
}
async function pingBackend() {
  const b = $('#backendBadge');
  try { await api('/api/health'); b.textContent = 'Backend: Conectado'; b.classList.add('ok'); }
  catch { b.textContent = 'Backend: Sin conexión'; b.classList.remove('ok'); }
}

/* ---------- ACCESO ---------- */
function setMode(m) {
  mode = m;
  $('#tabLogin').classList.toggle('active', m === 'login');
  $('#tabRegister').classList.toggle('active', m === 'register');
  $('#nameWrap').hidden = m === 'login'; $('#termsWrap').hidden = m === 'login';
  $('#authBtn').textContent = m === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
}
$('#tabLogin').onclick = () => setMode('login');
$('#tabRegister').onclick = () => setMode('register');
$('#pass').placeholder = 'Mínimo 8 caracteres';
$('#authMsg').textContent = 'Todos entran como suscriptor.';
$('#authBtn').insertAdjacentHTML('beforebegin', `<label class="check" id="termsWrap" hidden><input type="checkbox" id="terms"> <span>Acepto los <a href="terms.html" target="_blank" style="color:var(--y)">términos y la privacidad</a></span></label>`);
$('#authMsg').insertAdjacentHTML('afterend', `<p class="center"><a href="#" id="forgotLink" style="color:var(--y)">¿Olvidaste tu contraseña?</a></p>
<div id="forgotBox" hidden>
  <p class="muted">Escribe tu correo y pulsa "Enviar código". Si no te llega por correo, el administrador te lo da. Luego pon el código y tu nueva contraseña.</p>
  <button class="btn-dark wide" id="sendCode">📨 Enviar código</button>
  <label for="rcode">Código</label><input id="rcode" type="text" inputmode="numeric">
  <label for="rpass">Nueva contraseña</label><input id="rpass" type="password" placeholder="Mínimo 8 caracteres">
  <button class="btn-main" id="doReset">Cambiar contraseña</button>
</div>`);
$('#forgotLink').onclick = e => { e.preventDefault(); $('#forgotBox').hidden = !$('#forgotBox').hidden; };
$('#sendCode').onclick = async () => { try { $('#authMsg').textContent = (await api('/api/forgot', { method: 'POST', body: { email: $('#email').value } })).msg; } catch (e) { $('#authMsg').textContent = e.message; } };
$('#doReset').onclick = async () => {
  try { await api('/api/reset', { method: 'POST', body: { email: $('#email').value, code: $('#rcode').value, password: $('#rpass').value } });
    $('#authMsg').textContent = 'Contraseña cambiada ✅ Ya puedes iniciar sesión.'; $('#forgotBox').hidden = true; setMode('login'); }
  catch (e) { $('#authMsg').textContent = e.message; } };

$('#authBtn').onclick = async () => {
  const btn = $('#authBtn'); btn.disabled = true; $('#authMsg').textContent = 'Conectando...';
  try {
    const body = { email: $('#email').value, password: $('#pass').value };
    if (mode === 'register') { body.name = $('#name').value; body.terms = $('#terms').checked; }
    const r = await api(mode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body });
    token = r.token; localStorage.setItem('cm_token', token); me = r.user;
    $('#pass').value = ''; $('#authMsg').textContent = ''; render();
  } catch (e) { $('#authMsg').textContent = e.message; }
  btn.disabled = false;
};
$('#logoutBtn').onclick = () => { token = ''; ownerToken = ''; me = null; localStorage.removeItem('cm_token'); render(); };

/* ---------- INICIO ---------- */
async function init() {
  pingBackend();
  api('/api/wallets').then(w => { wallets = w; if (me) renderPay(); }).catch(() => {});
  if (token) { try { me = (await api('/api/me')).user; } catch { token = ''; localStorage.removeItem('cm_token'); } }
  render();
}
function render() {
  $('#authView').hidden = !!me; $('#appView').hidden = !me; $('#topRight').hidden = !me;
  if (!me) return;
  const role = me.owner ? 'DUEÑO' : 'SUSCRIPTOR';
  $('#roleBadge').textContent = role; $('#ownerCircle').textContent = role;
  $('#userName').textContent = me.name; $('#userEmail').textContent = me.email;
  $$('.owner-only').forEach(b => b.hidden = !me.owner);
  
  renderPlanBox(); renderDurations(); renderSub();
}
function renderPlanBox() {
  const p = PLANS[me.plan], left = Math.max(0, me.limit - me.used);
  $('#planTitle').textContent = me.owner ? 'Dueño: clips ilimitados para tus pruebas' : `Plan ${p.name}: Te quedan ${left} clips de ${me.limit} este mes`;
  $('#planText').innerHTML = `Usaste <b>${me.used}</b> de tus clips este mes. Cuando se acaben, suscríbete con cripto para seguir.`;
  $('#planBar').style.width = me.owner ? '0%' : Math.min(100, me.used / me.limit * 100) + '%';
}

/* ---------- PESTAÑAS ---------- */
$$('[data-tab]').forEach(b => b.onclick = () => {
  $$('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.hidden = t.id !== 'tab-' + b.dataset.tab);
  if (b.dataset.tab === 'panel') openPanel();
});
$$('#nets .chip').forEach(c => c.onclick = () => $$('#nets .chip').forEach(x => x.classList.toggle('active', x === c)));

/* ---------- CLIPMAKER ---------- */
function renderDurations() {
  $('#durations').innerHTML = [30, 45, 60, 90, 120, 180].map(d => `<button class="chip ${d === dur ? 'sel' : ''}" data-d="${d}">${d}s</button>`).join('');
  $$('#durations .chip').forEach(b => b.onclick = () => { dur = +b.dataset.d; renderDurations(); });
}
$('#counts').innerHTML = [1, 2, 3, 5, 8, 10].map(n => `<button class="chip" data-n="${n}">${n}</button>`).join('');
function markCount() { $$('#counts .chip').forEach(b => b.classList.toggle('sel', +b.dataset.n === +$('#qty').value)); }
$$('#counts .chip').forEach(b => b.onclick = () => { $('#qty').value = b.dataset.n; markCount(); });
$('#qty').oninput = markCount; markCount();

function embedUrl(l) {
  const yt = l.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  if (/facebook\.com|fb\.watch/.test(l)) return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(l)}`;
  return null;
}
$('#previewBtn').onclick = () => {
  const l = $('#link').value.trim(); if (!l) return toast('Pega un enlace primero');
  sourceLink = l; sourceFile = null; sourceIsLive = false;
  const box = $('#preview');
  if (/\.(mp4|webm|mov)(\?|$)/i.test(l)) box.innerHTML = `<video controls src="${esc(l)}"></video>`;
  else if (embedUrl(l)) box.innerHTML = `<iframe src="${esc(embedUrl(l))}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"></iframe>`;
  else box.innerHTML = `<p class="muted">No se puede mostrar este enlace aquí. Descarga el video y súbelo abajo.</p>`;
};
$('#file').onchange = e => {
  sourceFile = e.target.files[0]; sourceLink = ''; sourceIsLive = false;
  if (sourceFile) $('#link').value = '';
  if (sourceFile) $('#preview').innerHTML = `<video controls src="${URL.createObjectURL(sourceFile)}"></video>`;
};

const wait = (v, ev) => new Promise(r => v.addEventListener(ev, r, { once: true }));
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
async function ready(v) {
  await wait(v, 'loadedmetadata');
  if (v.duration === Infinity) {            // grabaciones de MediaRecorder no traen duración
    v.currentTime = 1e101;
    await withTimeout(wait(v, 'timeupdate'), 3000);
    v.currentTime = 0;
    await withTimeout(wait(v, 'seeked'), 3000);
  }
}
async function makeClip(url, start, len) {
  const v = document.createElement('video');
  v.src = url; v.playsInline = true;
  await ready(v);
  v.currentTime = start; await wait(v, 'seeked');
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * (v.videoHeight / v.videoWidth || .56));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const thumb = c.toDataURL('image/jpeg', .7);
  const stream = v.captureStream ? v.captureStream() : v.mozCaptureStream();
  const rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(); await v.play();
  await new Promise(r => setTimeout(r, len * 1000)); v.pause(); rec.stop(); await done;
  return { thumb, blob: new Blob(chunks, { type: 'video/webm' }) };
}
async function generate(best) {
  const typed = $('#link').value.trim();
  if (!sourceFile && typed) sourceLink = typed;          // no hace falta pulsar "Ver video" antes
  if (!sourceFile && !sourceLink) return toast('Pega un enlace o sube un video');
  if (!sourceFile) return generateFromLink(best === true);
  const url = URL.createObjectURL(sourceFile);
  const probe = document.createElement('video'); probe.src = url; await ready(probe);
  const total = isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0;
  if (!total) return ($('#genMsg').textContent = 'No se pudo leer la duración del video.');
  const qty = Math.min(10, Math.max(1, +$('#qty').value || 1));
  let r;
  try { r = await api('/api/clips/reserve', { method: 'POST', body: { count: qty, duration: dur } }); }
  catch (e) { return ($('#genMsg').textContent = e.message); }
  me = r.user; renderPlanBox();
  const n = r.allowed, L = Math.min(r.duration, total);
  $('#results').innerHTML = '';
  for (let i = 0; i < n; i++) {
    const slot = Math.max(0, total - L);
    const start = best ? slot * (n === 1 ? .5 : (i + .5) / n) : (n === 1 ? 0 : slot * i / (n - 1));
    $('#genMsg').textContent = `Generando clip ${i + 1} de ${n}... (se graba en tiempo real, no cierres la pestaña)`;
    try {
      const { thumb, blob } = await makeClip(url, start, L), cu = URL.createObjectURL(blob);
      $('#results').insertAdjacentHTML('beforeend', `<div class="clip"><img src="${thumb}" alt=""><video controls src="${cu}"></video><a href="${cu}" download="clip-${i + 1}.webm">⬇ Descargar clip ${i + 1}</a></div>`);
    } catch (e) { $('#genMsg').textContent = 'No se pudo generar el clip: ' + e.message; return; }
  }
  $('#genMsg').textContent = `Listo ✅ ${n} clip(s) generados.`;
}

/* ---------- CLIPS AUTOMÁTICOS DESDE UN ENLACE (los corta el servidor) ---------- */
async function fetchClip(jobId, n) {
  const res = await fetch(`${API}/api/jobs/${jobId}/clip/${n}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('No se pudo bajar el clip ' + (n + 1));
  return URL.createObjectURL(await res.blob());
}
async function generateFromLink(best = false) {
  if (pollTimer) return toast('Ya hay clips generándose, espera a que terminen.');
  if (!$('#rights').checked) return ($('#genMsg').textContent = 'Marca la casilla que confirma que el contenido es tuyo o tienes permiso.');
  const qty = Math.min(10, Math.max(1, +$('#qty').value || 1));
  $('#results').innerHTML = ''; $('#genMsg').textContent = 'Conectando con el enlace... (si el servidor estaba dormido tarda ~50 s)';
  let r;
  try { r = await api('/api/jobs', { method: 'POST', body: { url: sourceLink, count: qty, duration: dur, rights: true, subtitles: $('#subs').checked, vertical: $('#vert').checked, best } }); }
  catch (e) { return ($('#genMsg').textContent = e.message); }
  me = r.user; renderPlanBox();
  const id = r.job.id; let shown = 0, shownWarn = false;
  $('#genMsg').textContent = `Cortando automáticamente: ${r.job.wanted} clip(s) de ${r.job.seconds}s. Van apareciendo aquí abajo. Puedes dejar esta página abierta.`;
  const finish = msg => { clearInterval(pollTimer); pollTimer = null; $('#genMsg').textContent = msg; api('/api/me').then(x => { me = x.user; renderPlanBox(); }).catch(() => {}); };
  let busy = false;                                       // evita que dos revisiones corran a la vez
  pollTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { job } = await api('/api/jobs/' + id);
      while (shown < Math.min(job.ready, job.wanted)) {
        const idx = shown++;                              // se reserva el número ANTES de descargar
        let cu;
        try { cu = await fetchClip(id, idx); } catch (err) { shown--; throw err; }
        $('#results').insertAdjacentHTML('beforeend', `<div class="clip" data-job="${id}" data-n="${idx}"><video controls src="${cu}"></video><a href="${cu}" download="clip-${idx + 1}.mp4">⬇ Descargar clip ${idx + 1}</a><button class="btn-dark wide editBtn">✏️ Editar clip</button></div>`);
      }
      if (job.warn && !shownWarn) { shownWarn = true; toast(job.warn); }
      if (job.status === 'error') finish('No se pudo: ' + job.error + (shown ? '' : ' Los clips no usados se te devolvieron.'));
      else if (job.status === 'done' && shown >= Math.min(job.ready, job.wanted)) finish(`Listo ✅ ${shown} clip(s). Descárgalos: el servidor los borra en 1 hora.`);
      else $('#genMsg').textContent = (job.stage ? job.stage + ' ' : '') + `(${shown} de ${job.wanted} clips listos)`;
    } catch (e) { if (e.status === 401 || e.status === 404) finish(e.message); }
    busy = false;
  }, 4000);
}
$('#genAll').onclick = () => generate(false);
$('#genBest').onclick = () => generate(true);
$('#link').addEventListener('input', () => { sourceFile = null; });
$('#pickFile').onclick = () => $('#file').click();
$('#link').addEventListener('keydown', e => { if (e.key === 'Enter') generate(true); });


/* ---------- EDITOR DE CLIPS (recortar, encuadre y subtítulos) ---------- */
async function fetchBlob(path) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('No se pudo cargar el clip');
  return URL.createObjectURL(await res.blob());
}
$('#results').addEventListener('click', e => { const b = e.target.closest('.editBtn'); if (b) openEditor(b.closest('.clip')); });

async function openEditor(card) {
  const id = card.dataset.job, n = +card.dataset.n;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="editModal"><div class="modal-box"><p class="muted">Cargando editor...</p></div></div>`);
  const close = () => $('#editModal')?.remove();
  let info, src;
  try { [info, src] = await Promise.all([api(`/api/jobs/${id}/clip/${n}/info`), fetchBlob(`/api/jobs/${id}/clip/${n}/source`)]); }
  catch (e) { close(); return toast(e.message); }
  const L = info.rawLen || 30; let a = 0, b = L, cx = 0.5;
  const S = { ...(info.style || {}) };   // estilo actual (color, tamaño, posición del subtítulo y color del video)
  const LOOKS = [['none', 'Original'], ['vivid', '🔥 Vivo'], ['bw', '⚫ Blanco y negro'], ['warm', '🌅 Cálido'], ['cool', '❄️ Frío'], ['cine', '🎬 Cine']];
  const LOOK_CSS = { none: '', vivid: 'saturate(1.35) contrast(1.08)', bw: 'grayscale(1)', warm: 'sepia(.3) saturate(1.1)', cool: 'hue-rotate(-12deg) saturate(1.05)', cine: 'contrast(1.15) saturate(.8)' };
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  $('#editModal .modal-box').innerHTML = `
    <h2>✏️ Editar clip ${n + 1}</h2>
    <div class="ed-grid"><div class="ed-left">
    <div class="ed-stage${info.vertical ? ' v' : ''}" id="edStage"><video id="edVid" src="${src}" controls playsinline></video>${info.vertical ? '<div class="ed-frame" id="edFrame"></div>' : ''}${info.hasSubs ? '<div class="ed-sub" id="edSub"></div>' : ''}</div>
    ${info.vertical ? '<p class="muted">El recuadro es lo que se verá en el clip vertical.</p>' : ''}
    </div><div class="ed-right">
    <label>Inicio: <b id="aTxt"></b> s</label><input type="range" id="aR" min="0" max="${L}" step="0.1" value="0">
    <label>Fin: <b id="bTxt"></b> s</label><input type="range" id="bR" min="0" max="${L}" step="0.1" value="${L}">
    <div class="row"><button class="btn-dark" id="setA">⏮ Inicio aquí</button><button class="btn-dark" id="setB">⏭ Fin aquí</button><button class="btn-dark" id="prev">▶ Ver recorte</button></div>
    ${info.vertical ? `<label>Encuadre (izquierda ↔ derecha)</label><input type="range" id="cxR" min="0" max="1" step="0.01" value="0.5">` : ''}
    <label>Subtítulos</label>
    <div id="cuesBox">${info.cues.length ? info.cues.map((c, i) => `<div class="cue"><span class="muted">${f1(c.start)}–${f1(c.end)}s</span><input type="text" data-c="${i}" maxlength="200" value="${esc(c.text)}"></div>`).join('')
      : `<p class="muted">${info.hasSubs ? 'No se detectó texto en este clip.' : 'Este clip no tiene subtítulos.'}</p>`}</div>
    ${info.hasSubs ? `<h3 class="ed-h">🎨 Estilo del subtítulo</h3>
    <div class="row ed-row">
      <label class="ed-in">Color <input type="color" id="sColor"></label>
      <label class="ed-in">Borde <input type="color" id="sOut"></label>
      <label class="ed-in">Lado <select id="sAlign"><option value="left">⬅ Izquierda</option><option value="center">⬛ Centro</option><option value="right">➡ Derecha</option></select></label>
    </div>
    <label>Tamaño: <b id="sSizeT"></b></label><input type="range" id="sSize" min="0.5" max="2.5" step="0.05">
    <label>Altura (abajo ↔ arriba)</label><input type="range" id="sY" min="0.03" max="0.92" step="0.01">` : ''}
    <h3 class="ed-h">🌈 Color del video</h3>
    <div class="row" id="looks">${LOOKS.map(([k, t]) => `<button class="chip" data-look="${k}">${t}</button>`).join('')}</div>
    <label>Brillo</label><input type="range" id="cBri" min="-0.3" max="0.3" step="0.01">
    <label>Contraste</label><input type="range" id="cCon" min="0.7" max="1.5" step="0.01">
    <label>Saturación (color)</label><input type="range" id="cSat" min="0" max="2" step="0.01">
    <div class="row"><button class="btn-dark" id="cReset">↺ Quitar colores</button></div>
    <p class="muted">La vista previa es aproximada: el resultado final lo ves al aplicar los cambios.</p>
    <div class="row"><button class="btn-main" id="edApply" style="width:auto;margin:0;padding:14px 22px">✅ Aplicar cambios</button><button class="btn-dark" id="edClose">Cancelar</button></div>
    <p class="muted" id="edMsg"></p>
    </div></div>`;
  const vid = $('#edVid'), frame = $('#edFrame');
  const paint = () => {
    $('#aTxt').textContent = f1(a); $('#bTxt').textContent = f1(b);
    if (frame && vid.videoWidth) {
      const w = (9 / 16) / (vid.videoWidth / vid.videoHeight) * 100;
      frame.style.width = w + '%'; frame.style.left = ((100 - w) * cx) + '%';
    }
    if (typeof paintSub === 'function') paintSub();
  };
  const sub = $('#edSub');
  const paintSub = () => {          // vista previa aproximada del subtítulo y del color
    vid.style.filter = `${LOOK_CSS[S.look] || ''} brightness(${1 + S.bright}) contrast(${S.contrast}) saturate(${S.sat})`.trim();
    if (!sub) return;
    const H = $('#edStage').clientHeight, W = $('#edStage').clientWidth;
    const left = frame ? frame.offsetLeft : 0, width = frame ? frame.offsetWidth : W, fs = Math.max(8, H * (info.vertical ? 12 : 14) * S.subSize / 288);
    Object.assign(sub.style, { left: left + 'px', width: width + 'px', bottom: (S.subY * H) + 'px', textAlign: S.subAlign, color: S.subColor, fontSize: fs + 'px',
      webkitTextStroke: Math.max(1, fs * .16) + 'px ' + S.outColor, paintOrder: 'stroke fill', padding: '0 ' + (width * .06) + 'px' });
    sub.textContent = (info.cues[0] && info.cues[0].text) || 'Así se verá tu subtítulo';
  };
  const syncControls = () => {
    if (info.hasSubs) { $('#sColor').value = S.subColor; $('#sOut').value = S.outColor; $('#sAlign').value = S.subAlign; $('#sSize').value = S.subSize; $('#sY').value = S.subY; $('#sSizeT').textContent = Math.round(S.subSize * 100) + '%'; }
    $('#cBri').value = S.bright; $('#cCon').value = S.contrast; $('#cSat').value = S.sat;
    $$('#looks [data-look]').forEach(x => x.classList.toggle('active', x.dataset.look === S.look));
    paintSub();
  };
  const bind = (sel, key, num) => { const el = $(sel); if (el) el.oninput = e => { S[key] = num ? +e.target.value : e.target.value; syncControls(); }; };
  bind('#sColor', 'subColor'); bind('#sOut', 'outColor'); bind('#sAlign', 'subAlign'); bind('#sSize', 'subSize', 1); bind('#sY', 'subY', 1);
  bind('#cBri', 'bright', 1); bind('#cCon', 'contrast', 1); bind('#cSat', 'sat', 1);
  $$('#looks [data-look]').forEach(x => x.onclick = () => { S.look = x.dataset.look; syncControls(); });
  $('#cReset').onclick = () => { Object.assign(S, { look: 'none', bright: 0, contrast: 1, sat: 1 }); syncControls(); };
  vid.addEventListener('loadedmetadata', () => { paint(); paintSub(); }); paint(); syncControls();
  $('#aR').oninput = e => { a = Math.min(+e.target.value, b - 1); e.target.value = a; vid.currentTime = a; paint(); };
  $('#bR').oninput = e => { b = Math.max(+e.target.value, a + 1); e.target.value = b; vid.currentTime = Math.max(0, b - .1); paint(); };
  $('#setA').onclick = () => { a = Math.min(vid.currentTime, b - 1); $('#aR').value = a; paint(); };
  $('#setB').onclick = () => { b = Math.max(vid.currentTime, a + 1); $('#bR').value = b; paint(); };
  $('#prev').onclick = () => { vid.currentTime = a; vid.play(); };
  vid.ontimeupdate = () => { if (vid.currentTime >= b) vid.pause(); };
  if ($('#cxR')) $('#cxR').oninput = e => { cx = +e.target.value; paint(); };
  $('#edClose').onclick = close;
  $('#edApply').onclick = async () => {
    const btn = $('#edApply'); btn.disabled = true; $('#edMsg').textContent = 'Aplicando... puede tardar un rato.';
    const cues = info.cues.map((c, i) => ({ start: c.start, end: c.end, text: $(`[data-c="${i}"]`).value }));
    try {
      await api(`/api/jobs/${id}/clip/${n}/edit`, { method: 'POST', body: { trimStart: a, trimEnd: b, cropX: cx, style: S, cues: info.cues.length ? cues : undefined } });
      const cu = await fetchBlob(`/api/jobs/${id}/clip/${n}`);
      card.querySelector('video').src = cu; card.querySelector('a').href = cu;
      toast('Clip actualizado ✅'); close();
    } catch (e) { $('#edMsg').textContent = e.message; btn.disabled = false; }
  };
}

/* ---------- SUSCRIPCIÓN ---------- */
function renderSub() {
  $('#planTable').innerHTML = '<tr><th>Plan</th><th>Clips por mes</th><th>Duración máx</th><th>Precio</th></tr>' +
    Object.values(PLANS).map(p => `<tr><td>${p.name}</td><td>${p.clips} clips / mes</td><td>${p.max}s</td><td>$${p.price}</td></tr>`).join('');
  $('#planCards').innerHTML = Object.entries(PLANS).map(([k, p]) => `
    <div class="plan ${k === 'premium' ? 'star' : ''}"><h4>${p.name}${k === 'premium' ? ' ⭐' : ''}</h4>
    <div class="price">$${p.price}${p.price ? '/mes' : ''}</div><p>${p.clips} clips / mes</p><p>${p.max}s máx</p>
    ${k === 'gratis' ? '<button class="btn-dark" data-p="gratis">Ya estoy Gratis</button>' : `<button class="btn-main" data-p="${k}">Elegir ${p.name}</button>`}</div>`).join('');
  $$('#planCards [data-p]').forEach(b => b.onclick = () => { planPick = b.dataset.p; renderPay(); });
  $('#coins').innerHTML = Object.entries(COINS).map(([k, c]) => `<button class="chip ${k === coin ? 'active' : ''}" data-c="${k}">${c.label}</button>`).join('');
  $$('#coins .chip').forEach(b => b.onclick = () => { coin = b.dataset.c; renderSub(); });
  renderPay();
}
function renderPay() {
  const p = PLANS[planPick];
  $('#chosen').innerHTML = `Plan elegido: <b>${p.name} - ${p.clips} clips</b>`;
  $('#amount').value = p.price ? `$${p.price} USD en ${coin}` : '$0 - Gratis';
  $('#addrLabel').textContent = `Dirección del dueño para recibir - ${COINS[coin].label.replace(/^\S+\s/, '')}`;
  $('#addr').textContent = wallets[coin] || 'Cargando...';
  $('#netNote').textContent = `Red: ${COINS[coin].net}. Confirma que estás en la red correcta antes de enviar.`;
}
$('#copyAddr').onclick = () => wallets[coin] && copy(wallets[coin]);
$('#paidBtn').onclick = async () => {
  if (!PLANS[planPick].price) return toast('El plan Gratis no necesita pago');
  try {
    await api('/api/payments', { method: 'POST', body: { plan: planPick, coin, txid: $('#txid').value, refund: $('#refund').value } });
    $('#txid').value = ''; toast('Comprobante enviado al dueño ✅');
  } catch (e) { toast(e.message); }
};
$('#shareSub').onclick = () => copy(location.href.split('#')[0]);

/* ---------- PANEL DUEÑO ---------- */
function panelMsg(text) {
  $('#userList').innerHTML = '';
  $('#walletForm').innerHTML = '';
  $('#payList').innerHTML = `<p class="muted">${esc(text)}</p><button class="btn-main" id="retryPanel">🔑 Escribir PIN de dueño</button>`;
  $('#retryPanel').onclick = openPanel;
}
async function openPanel() {
  if (!me?.owner) return;
  if (!ownerToken) {
    const pin = prompt('Escribe tu PIN de dueño:');
    if (!pin) return panelMsg('Para ver el Panel escribe tu PIN de dueño.');
    try { ownerToken = (await api('/api/owner/unlock', { method: 'POST', body: { pin } })).token; }
    catch (e) { return panelMsg('No se pudo abrir el Panel: ' + e.message); }
  }
  try { summary = await api('/api/owner/summary', { owner: true }); renderPanel(); }
  catch (e) { if (e.status === 401 || e.status === 403) ownerToken = ''; panelMsg('No se pudieron cargar los datos: ' + e.message); }
}
function renderPanel() {
  if (!summary) return;
  const { stats, users, payments, wallets: w } = summary;
  $('#stSubs').textContent = stats.subscribers; $('#stPays').textContent = stats.payments;
  $('#stClips').textContent = stats.clips; $('#stMoney').textContent = '$' + stats.pendingMoney;
  $('#filters').innerHTML = ['todos', 'gratis', 'basico', 'premium', 'vip'].map(f => `<button class="chip ${f === filter ? 'active' : ''}" data-f="${f}">${f === 'todos' ? 'Todos' : PLANS[f].name}</button>`).join('');
  $$('#filters .chip').forEach(b => b.onclick = () => { filter = b.dataset.f; renderPanel(); });
  const q = $('#search').value.toLowerCase();
  const list = users.filter(u => (filter === 'todos' || u.plan === filter) && (u.name + u.email).toLowerCase().includes(q));
  $('#userList').innerHTML = list.length ? list.map(u => `<div class="item"><span><b>${esc(u.name)}</b> - ${esc(u.email)}</span><span>${PLANS[u.plan].name} · ${u.totalClips} clips${u.resetCodeForOwner && new Date(u.resetExp) > new Date() ? `<br>🔑 Código de recuperación: <b>${esc(u.resetCodeForOwner)}</b>` : ''}</span></div>`).join('')
    : '<p class="muted">Aún no hay suscriptores reales. Cuando alguien cree cuenta en tu dominio, aquí aparece su perfil.</p>';
  $('#payList').innerHTML = payments.length ? payments.map(p => `<div class="item"><span>${esc(p.email)} · ${PLANS[p.plan].name} · $${p.amount} ${esc(p.coin)}<br>TXID: ${esc(p.txid)}</span>
    ${p.status === 'pendiente' ? `<button class="btn-main" data-a="${esc(p._id)}">Aprobar</button>` : '<b>✅ Aprobado</b>'}</div>`).join('')
    : '<p class="muted">Aún no hay pagos. Cuando paguen con cripto, aquí te sale el TXID.</p>';
  $$('[data-a]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Ya verificaste este pago en tu billetera?')) return;
    try { await api(`/api/owner/payments/${b.dataset.a}/approve`, { method: 'POST', owner: true }); toast('Plan activado ✅'); openPanel(); }
    catch (e) { toast(e.message); }
  });
  $('#walletForm').innerHTML = Object.entries(COINS).map(([k, c]) => `<label>${c.label.replace(/^\S+\s/, '')}</label><input type="text" data-w="${k}" value="${esc(w[k])}">`).join('');
}
$('#search').oninput = renderPanel;
$('#saveCfg').textContent = '💾 Guardar mis wallets reales';
$('#saveCfg').onclick = async () => {
  const body = {}; $$('[data-w]').forEach(i => body[i.dataset.w] = i.value);
  try { await api('/api/owner/wallets', { method: 'PUT', body, owner: true }); wallets = { ...wallets, ...body }; renderPay(); toast('Wallets guardadas ✅'); }
  catch (e) { toast(e.message); }
};

/* ---------- DOMINIO ---------- */
$('#copyPage').onclick = () => copy(location.href.split('#')[0]);

init();

