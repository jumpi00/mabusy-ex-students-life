import * as api from './api.js';
import { SITE_NAME } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(3, '0');
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');

const app = $('#app');
const bar = $('#bar');
const state = { session: null, me: null, members: [], calls: [] };
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_PHOTOS = 12;

// ── Formatting ─────────────────────────────────────────────────────────────
const fmtDate = iso => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));
const fmtShort = iso => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(iso));
const fmtTime = d => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);

function countdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
    .map(x => String(x).padStart(2, '0')).join(':');
  return d ? `${d}d ${hms}` : hms;
}

// datetime-local <input> ⇄ ISO, in the viewer's own timezone
const toLocalInput = iso => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
};
const fromLocalInput = v => new Date(v).toISOString();

const isRevealed = c => new Date(c.reveal_at) <= Date.now();
const isAccepting = c => c.is_open && !isRevealed(c);
const callName = c => `Call_${pad(c.number)}`;
const statusOf = c => (isRevealed(c) ? 'Unlocked' : isAccepting(c) ? 'Open' : 'Locked');
const member = email => state.members.find(m => m.email.toLowerCase() === String(email).toLowerCase());
const nameOf = email => member(email)?.name ?? 'Someone';
const sortOf = email => member(email)?.sort ?? 99;
const normUrl = u => { u = u.trim(); return !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`; };
const safeHref = u => (/^https?:\/\//i.test(u) ? u : '#');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function setBar(crumb, middle = '', right = '') {
  bar.innerHTML = `
    <a href="#/" class="eq" aria-label="Index">=</a>
    <span class="crumb">${crumb}</span>
    <span class="mid">${middle}</span>
    <span class="right">${right}</span>`;
}

function setTitle(t) { document.title = t ? `${t} | ${SITE_NAME}` : SITE_NAME; }

// ── Live countdowns (one ticker for the whole page) ───────────────────────
setInterval(() => {
  for (const el of $$('[data-countdown]')) {
    const left = new Date(el.dataset.countdown) - Date.now();
    el.textContent = countdown(left);
    if (left <= 0 && !el.dataset.done) { el.dataset.done = '1'; setTimeout(route, 1200); }
  }
}, 1000);

// ── Images ─────────────────────────────────────────────────────────────────
async function hydrate(root = app) {
  const imgs = $$('img[data-src]', root);
  if (!imgs.length) return;
  const urls = await api.signedUrls(imgs.map(i => i.dataset.src));
  for (const img of imgs) {
    const u = urls[img.dataset.src];
    if (!u) continue;
    img.onload = () => img.classList.add('in');
    img.src = u;
    img.removeAttribute('data-src');
  }
}

const lbGroups = {};
function figure(item, group, i) {
  const ratio = item.w && item.h ? `${item.w}/${item.h}` : '1/1';
  return `
    <figure class="item" data-lb="${group}" data-i="${i}">
      <div class="box"><img data-src="${esc(item.thumb)}" alt="" loading="lazy" style="aspect-ratio:${ratio}"></div>
      <figcaption>${esc(item.caption)}</figcaption>
      ${item.text ? `<p class="note">${esc(item.text)}</p>` : ''}
    </figure>`;
}

const lb = $('#lb');
let lbItems = [], lbIndex = 0;
async function showLightbox(items, i) {
  lbItems = items; lbIndex = (i + items.length) % items.length;
  const it = lbItems[lbIndex];
  const img = $('img', lb);
  img.classList.remove('in');
  img.removeAttribute('src');
  $('.lb-cap', lb).innerHTML = `${esc(it.caption)}${it.text ? ` — ${esc(it.text)}` : ''}`;
  $('.lb-count', lb).textContent = `${lbIndex + 1} / ${lbItems.length}`;
  lb.hidden = false;
  document.body.classList.add('noscroll');
  const urls = await api.signedUrls([it.path]);
  if (lbItems[lbIndex] !== it) return;
  img.onload = () => img.classList.add('in');
  img.src = urls[it.path];
}
function closeLightbox() { lb.hidden = true; document.body.classList.remove('noscroll'); }
lb.addEventListener('click', e => {
  if (e.target.closest('.lb-prev')) showLightbox(lbItems, lbIndex - 1);
  else if (e.target.closest('.lb-next')) showLightbox(lbItems, lbIndex + 1);
  else if (e.target.closest('.lb-close') || e.target === lb || e.target.classList.contains('lb-stage')) closeLightbox();
});
document.addEventListener('keydown', e => {
  if (lb.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') showLightbox(lbItems, lbIndex - 1);
  if (e.key === 'ArrowRight') showLightbox(lbItems, lbIndex + 1);
});
app.addEventListener('click', e => {
  const f = e.target.closest('[data-lb]');
  if (f && lbGroups[f.dataset.lb]) showLightbox(lbGroups[f.dataset.lb], Number(f.dataset.i));
});

// ── Archive data (only unlocked calls) ─────────────────────────────────────
async function loadArchive(callId) {
  const unlocked = new Map(state.calls.filter(isRevealed).map(c => [c.id, c]));
  const [subs, photos] = await Promise.all([api.listSubmissions(callId), api.listPhotos(callId)]);
  const bySort = (a, b) => b.call.number - a.call.number || sortOf(a.email) - sortOf(b.email);
  const out = { selfie: [], photo: [], answers: [], text: [], links: [] };

  for (const s of subs) {
    const call = unlocked.get(s.call_id);
    if (!call) continue;
    const name = nameOf(s.author_email), p = pad(call.number), n = slug(name);
    const base = { call, email: s.author_email, name };
    if (s.selfie?.path) out.selfie.push({ ...base, ...s.selfie, caption: `${p}_selfie_${n}` });
    (call.questions || []).forEach((q, qi) => {
      const text = (s.answers?.[q.id] || '').trim();
      if (text) out.answers.push({ ...base, qid: q.id, qi, question: q.text, body: text, caption: `${p}_q${qi + 1}_${n}` });
    });
    if (s.body?.trim()) out.text.push({ ...base, body: s.body.trim(), caption: `${p}_txt_${n}` });
    (s.links || []).forEach((l, li) => {
      if (l.url) out.links.push({ ...base, ...l, caption: `${p}_lnk_${n}${li ? `-${li + 1}` : ''}` });
    });
  }
  const counters = {};
  for (const ph of photos) {
    const call = unlocked.get(ph.call_id);
    if (!call) continue;
    const name = nameOf(ph.author_email), key = `${call.id}:${ph.author_email}`;
    counters[key] = (counters[key] || 0) + 1;
    out.photo.push({
      call, email: ph.author_email, name, path: ph.path, thumb: ph.thumb, w: ph.w, h: ph.h,
      text: ph.caption, caption: `${pad(call.number)}_ph_${slug(name)}-${counters[key]}`,
    });
  }
  for (const k in out) out[k].sort((a, b) => bySort(a, b) || (a.qi ?? 0) - (b.qi ?? 0));
  return out;
}

const MATERIALS = [
  ['selfie', 'Selfie'], ['photo', 'Photo'],
  ['answers', 'Answers'], ['text', 'Text'], ['links', 'Links'],
];

// ── Views ──────────────────────────────────────────────────────────────────
function viewLogin(msg = '') {
  setTitle('Log in');
  bar.innerHTML = '';
  app.innerHTML = `
    <section class="login">
      <p class="label">[Login]</p>
      <form id="f-email" class="stack">
        <p class="lead">Enter your email. You'll get a link to log in.</p>
        <input type="email" name="email" placeholder="Email" required autocomplete="email" class="line">
        <button class="btn">Send link</button>
      </form>
      <form id="f-code" class="stack" hidden>
        <p class="lead">Check your inbox and open the link.<br>Or type the code from the email here:</p>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" class="line" maxlength="10">
        <div class="row"><button class="btn">Log in</button><button type="button" class="link" id="again">Use another email</button></div>
      </form>
      <p class="msg" id="login-msg">${esc(msg)}</p>
    </section>`;
  const fe = $('#f-email'), fc = $('#f-code'), m = $('#login-msg');
  let email = '';
  fe.onsubmit = async e => {
    e.preventDefault();
    email = fe.email.value.trim().toLowerCase();
    m.textContent = 'Sending…';
    try {
      await api.sendLink(email);
      fe.hidden = true; fc.hidden = false; m.textContent = `Sent to ${email}.`;
      fc.code.focus();
    } catch (err) { m.textContent = err.message; }
  };
  fc.onsubmit = async e => {
    e.preventDefault();
    m.textContent = 'Checking…';
    try { await api.verifyCode(email, fc.code.value.trim()); await boot(); }
    catch (err) { m.textContent = err.message; }
  };
  $('#again').onclick = () => { fc.hidden = true; fe.hidden = false; m.textContent = ''; };
}

function viewNotMember() {
  setTitle('');
  bar.innerHTML = '';
  app.innerHTML = `
    <section class="login">
      <p class="label">[Login]</p>
      <p class="lead">${esc(state.session.user.email)} is not on the list.<br>Ask the admin to add you.</p>
      <button class="btn" id="out">Log out</button>
    </section>`;
  $('#out').onclick = async () => { await api.signOut(); boot(); };
}

async function viewHome() {
  setTitle('');
  setBar('Index');
  const calls = state.calls;
  const next = [...calls].reverse().find(c => !isRevealed(c));
  app.innerHTML = `
    <section class="index">
      <div class="col">
        <p class="label">[Calls]</p>
        <ul class="big"><li><a href="#/calls">Datasheet</a> <span class="count">(${calls.length})</span></li></ul>
        <ul class="big gap">${calls.slice(0, 6).map(c => `
          <li><a href="#/call/${c.number}">${callName(c)}</a> <span class="count">${statusOf(c)}</span></li>`).join('')}
        </ul>
        ${next ? `<p class="small next">Next unlock: <a href="#/call/${next.number}">${callName(next)}</a><br>
          ${esc(fmtDate(next.reveal_at))} · <span data-countdown="${next.reveal_at}">${countdown(new Date(next.reveal_at) - Date.now())}</span></p>` : ''}
      </div>
      <div class="col">
        <p class="label">[Materials]</p>
        <div id="mat"><ul class="big">${MATERIALS.map(([k, l]) => `<li><a href="#/m/${k}">${l}</a> <span class="count">( )</span></li>`).join('')}</ul></div>
      </div>
      <div class="col small-col">
        <p class="label">[Info]</p>
        <ul class="small">
          <li><a href="#/about">About</a></li>
          ${state.me.is_admin ? '<li><a href="#/admin">Admin</a></li>' : ''}
        </ul>
        <ul class="small">${state.members.map(m => `<li>${esc(m.name)}</li>`).join('')}</ul>
        <ul class="small"><li><button class="link" id="out">Log out</button></li></ul>
      </div>
    </section>`;
  $('#out').onclick = async () => { await api.signOut(); boot(); };

  const data = await loadArchive();
  const groups = [['selfie', 'photo'], ['answers', 'text', 'links']];
  const label = Object.fromEntries(MATERIALS);
  $('#mat').innerHTML = groups.map(g => `<ul class="big">${g.map(k => `
    <li><a href="#/m/${k}">${label[k]}</a> <span class="count">(${data[k].length})</span></li>`).join('')}</ul>`).join('');
  splash([...data.selfie, ...data.photo]);
}

// Opening collage, once per session, like the AS landing.
function splash(items) {
  try { if (sessionStorage.getItem('mabusy:splash') || !items.length) return; sessionStorage.setItem('mabusy:splash', '1'); } catch { return; }
  const pick = [...items].sort(() => Math.random() - 0.5).slice(0, 7);
  const el = document.createElement('div');
  el.className = 'splash';
  el.innerHTML = pick.map((it, i) => {
    const w = 22 + Math.random() * 16;
    return `<img data-src="${esc(it.thumb)}" alt="" style="width:${w}vw;left:${Math.random() * (100 - w)}vw;top:${8 + Math.random() * 50}vh;z-index:${i}">`;
  }).join('');
  document.body.append(el);
  hydrate(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 700); };
  el.onclick = close;
  setTimeout(close, 3200);
}

function viewCalls() {
  setTitle('Datasheet');
  setBar('[C] Datasheet');
  app.innerHTML = `
    <table class="sheet">
      <thead><tr><th>No</th><th>Title</th><th>Unlock</th><th>Status</th><th>Questions</th></tr></thead>
      <tbody>${state.calls.map(c => `
        <tr data-href="#/call/${c.number}">
          <td>${pad(c.number)}</td>
          <td><a href="#/call/${c.number}">${esc(c.title || callName(c))}</a></td>
          <td>${esc(fmtShort(c.reveal_at))}</td>
          <td>${statusOf(c)}</td>
          <td>${(c.questions || []).length}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No calls yet.</td></tr>'}
      </tbody>
    </table>`;
  for (const tr of $$('tr[data-href]')) tr.onclick = () => { location.hash = tr.dataset.href; };
}

async function viewCall(number) {
  const call = state.calls.find(c => c.number === Number(number));
  if (!call) return viewNotFound();
  setTitle(callName(call));
  const sorted = [...state.calls].sort((a, b) => a.number - b.number);
  const i = sorted.indexOf(call);
  const prev = sorted[i - 1], next = sorted[i + 1];
  setBar(`[C] ${callName(call)}`,
    `${prev ? `<a href="#/call/${prev.number}">Prev</a>` : '<span class="muted">Prev</span>'}
     <span class="num">${pad(call.number)}</span>
     ${next ? `<a href="#/call/${next.number}">Next</a>` : '<span class="muted">Next</span>'}`);

  app.innerHTML = `
    <header class="call-head">
      <h1>${callName(call)}</h1>
      ${call.title ? `<p class="sub">${esc(call.title)}</p>` : ''}
    </header>
    <div id="call-body"><p class="muted center">Loading…</p></div>`;
  const body = $('#call-body');
  if (isRevealed(call)) return renderUnlocked(call, body);
  return renderLocked(call, body);
}

async function renderLocked(call, body) {
  body.innerHTML = `
    <section class="locked">
      <p class="label">[Unlocks in]</p>
      <p class="clock" data-countdown="${call.reveal_at}">${countdown(new Date(call.reveal_at) - Date.now())}</p>
      <p class="small">${esc(fmtDate(call.reveal_at))} <span class="muted">(${esc(TZ)})</span></p>
      <div id="progress"></div>
    </section>
    <section id="mine"></section>`;
  // Ready = selfie + at least one photo; started = something uploaded.
  async function drawProgress() {
    const progress = await api.callProgress(call.id);
    const ready = progress.filter(p => p.ready).length;
    $('#progress').innerHTML = `
      <p class="label">[Ready ${ready}/${progress.length}]</p>
      <ul class="ready">${progress.map(p => `
        <li class="${p.ready ? 'on' : p.has_selfie || p.photos ? 'half' : ''}"><span class="dot"></span>${esc(p.name)}</li>`).join('')}
      </ul>
      <p class="small muted legend">● selfie + photo uploaded · ◐ started</p>`;
  }
  await drawProgress();
  const mine = $('#mine');
  if (isAccepting(call)) return renderForm(call, mine, () => drawProgress().catch(() => {}));
  mine.innerHTML = `<p class="muted center">Uploads are closed for this call.</p>`;
}

async function renderUnlocked(call, body) {
  const d = await loadArchive(call.id);
  const g = `c${call.id}`;
  lbGroups[`${g}s`] = d.selfie;
  lbGroups[`${g}p`] = d.photo;
  const people = [...new Set([...d.selfie, ...d.answers, ...d.text, ...d.links, ...d.photo].map(x => x.name))];
  const questions = (call.questions || []).map((q, qi) => ({ q, qi, items: d.answers.filter(a => a.qid === q.id) }));

  body.innerHTML = `
    ${d.selfie.length ? `<p class="label sec">[Selfie]</p>
      <div class="grid">${d.selfie.map((it, i) => figure(it, `${g}s`, i)).join('')}</div>` : ''}
    ${d.photo.length ? `<p class="label sec">[Photo]${call.photo_prompt ? ` ${esc(call.photo_prompt)}` : ''}</p>
      <div class="grid">${d.photo.map((it, i) => figure(it, `${g}p`, i)).join('')}</div>` : ''}
    ${questions.filter(x => x.items.length).map(({ q, qi, items }) => `
      <p class="label sec">[Q${qi + 1}] ${esc(q.text)}</p>
      <div class="grid text">${items.map(textCard).join('')}</div>`).join('')}
    ${d.text.length ? `<p class="label sec">[Text]</p>
      <div class="grid text">${d.text.map(textCard).join('')}</div>` : ''}
    ${d.links.length ? `<p class="label sec">[Links]</p>
      <div class="grid text">${d.links.map(linkCard).join('')}</div>` : ''}
    ${people.length ? '' : '<p class="muted center">Nobody uploaded anything for this call.</p>'}
    <dl class="meta">
      <dt>No.</dt><dd>${pad(call.number)}</dd>
      <dt>Title</dt><dd>${esc(call.title || '—')}</dd>
      <dt>Unlocked</dt><dd>${esc(fmtDate(call.reveal_at))}</dd>
      <dt>Participants</dt><dd>${esc(people.join(', ') || '—')}</dd>
      <dt>Photos</dt><dd>${d.photo.length}</dd>
    </dl>`;
  hydrate();
}

const textCard = it => `
  <figure class="item txt">
    <p class="body">${esc(it.body)}</p>
    <figcaption>${esc(it.caption)}</figcaption>
  </figure>`;
const linkCard = it => `
  <figure class="item txt">
    <p class="body"><a href="${esc(safeHref(it.url))}" target="_blank" rel="noopener">${esc(it.label || hostOf(it.url))} ↗</a></p>
    <figcaption>${esc(it.caption)}</figcaption>
  </figure>`;

// ── Contribution form ──────────────────────────────────────────────────────
async function renderForm(call, root, onProgress = () => {}) {
  const uid = state.session.user.id;
  const [subs, photos] = await Promise.all([api.listSubmissions(call.id), api.listPhotos(call.id)]);
  const mine = subs.find(s => s.user_id === uid);
  const draft = {
    selfie: mine?.selfie ?? null,
    answers: { ...(mine?.answers || {}) },
    body: mine?.body ?? '',
    links: mine?.links?.length ? mine.links.map(l => ({ ...l })) : [{ url: '', label: '' }],
  };
  let myPhotos = photos.filter(p => p.user_id === uid);

  root.innerHTML = `
    <form class="contrib" id="contrib" autocomplete="off">
      <p class="label">[Your contribution]</p>
      <p class="small muted">Only you can see this until the unlock. Changes save automatically.</p>
      <p class="req" id="req"></p>

      <div class="field">
        <p class="label">[Selfie] <span class="muted">required</span></p>
        <div class="selfie-row">
          <div class="selfie-box" id="selfie-box"></div>
          <label class="btn">${draft.selfie ? 'Replace' : 'Upload'} selfie<input type="file" accept="image/*" id="selfie-in" hidden></label>
        </div>
      </div>

      <div class="field">
        <p class="label">[Photo] <span class="muted">at least 1 required · <span id="ph-count"></span></span></p>
        ${call.photo_prompt ? `<p class="q">${esc(call.photo_prompt)}</p>` : ''}
        <div class="grid edit" id="ph-grid"></div>
        <label class="btn" id="ph-add">Add photos<input type="file" accept="image/*" multiple id="ph-in" hidden></label>
      </div>

      ${(call.questions || []).map((q, qi) => `
        <div class="field">
          <p class="label">[Q${qi + 1}]</p>
          <label class="q" for="a-${esc(q.id)}">${esc(q.text)}</label>
          <textarea id="a-${esc(q.id)}" data-q="${esc(q.id)}" rows="3" class="area">${esc(draft.answers[q.id] || '')}</textarea>
        </div>`).join('')}

      <div class="field">
        <p class="label">[Text]</p>
        <label class="q" for="body">Anything else you want to share</label>
        <textarea id="body" rows="4" class="area">${esc(draft.body)}</textarea>
      </div>

      <div class="field">
        <p class="label">[Links]</p>
        <div id="links"></div>
        <button type="button" class="link" id="link-add">+ Add link</button>
      </div>

      <p class="save"><span id="save-status" class="muted">${mine ? `Saved ${fmtTime(new Date(mine.updated_at))}` : 'Nothing saved yet'}</span></p>
    </form>`;

  const status = t => { $('#save-status').textContent = t; };
  let timer;
  const clean = () => ({
    selfie: draft.selfie,
    answers: Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => v.trim())),
    body: draft.body,
    links: draft.links.map(l => ({ url: normUrl(l.url), label: l.label.trim() })).filter(l => l.url),
  });
  async function persist() {
    clearTimeout(timer);
    status('Saving…');
    try {
      await api.saveSubmission(call.id, uid, clean());
      status(`Saved ${fmtTime(new Date())}`);
    } catch (e) {
      status(isAccepting(call) ? `Not saved: ${e.message}` : 'This call is locked now.');
      throw e;
    }
  }
  const schedule = () => { status('Editing…'); clearTimeout(timer); timer = setTimeout(() => persist().catch(() => {}), 1000); };

  function drawReq(refresh = true) {
    const s = !!draft.selfie, p = myPhotos.length > 0;
    $('#req').innerHTML = s && p
      ? '● Ready: selfie and photo are in. Answers and the rest are a bonus.'
      : `To be ready: <span class="${s ? '' : 'todo'}">${s ? '✓' : '○'} selfie</span> · <span class="${p ? '' : 'todo'}">${p ? '✓' : '○'} at least one photo</span>`;
    if (refresh) onProgress();
  }

  // Selfie
  function drawSelfie() {
    const box = $('#selfie-box');
    box.innerHTML = draft.selfie ? `<img data-src="${esc(draft.selfie.thumb)}" alt="Your selfie">` : '<span class="muted">No selfie yet</span>';
    hydrate(box);
  }
  drawSelfie();
  $('#selfie-in').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    status('Processing selfie…');
    try {
      const old = draft.selfie;
      draft.selfie = await api.uploadSelfie(call.id, uid, file);
      await persist();
      if (old) api.removeFiles([old.path, old.thumb]);
      e.target.parentElement.firstChild.textContent = 'Replace selfie';
      drawSelfie();
      drawReq();
    } catch (err) { status(`Selfie not saved: ${err.message}`); }
  };

  // Answers + text
  for (const ta of $$('textarea[data-q]', root)) ta.oninput = () => { draft.answers[ta.dataset.q] = ta.value; schedule(); };
  $('#body').oninput = e => { draft.body = e.target.value; schedule(); };

  // Links
  function drawLinks() {
    $('#links').innerHTML = draft.links.map((l, i) => `
      <div class="link-row">
        <input class="line" data-l="${i}" data-k="url" placeholder="https://…" value="${esc(l.url)}" inputmode="url">
        <input class="line" data-l="${i}" data-k="label" placeholder="Label (optional)" value="${esc(l.label)}">
        <button type="button" class="link" data-rm="${i}" aria-label="Remove link">×</button>
      </div>`).join('');
    for (const inp of $$('#links input')) inp.oninput = () => { draft.links[inp.dataset.l][inp.dataset.k] = inp.value; schedule(); };
    for (const b of $$('#links [data-rm]')) b.onclick = () => { draft.links.splice(Number(b.dataset.rm), 1); drawLinks(); schedule(); };
  }
  drawLinks();
  $('#link-add').onclick = () => { draft.links.push({ url: '', label: '' }); drawLinks(); };

  // Photos
  function drawPhotos(pending = 0) {
    $('#ph-count').textContent = `${myPhotos.length}/${MAX_PHOTOS}`;
    $('#ph-add').hidden = myPhotos.length + pending >= MAX_PHOTOS;
    $('#ph-grid').innerHTML = myPhotos.map((p, i) => `
      <figure class="item">
        <div class="box"><img data-src="${esc(p.thumb)}" alt="" style="aspect-ratio:${p.w}/${p.h}"></div>
        <input class="line cap-in" data-id="${p.id}" placeholder="Caption" value="${esc(p.caption)}">
        <button type="button" class="link" data-del="${i}">Remove</button>
      </figure>`).join('') + Array.from({ length: pending }, () => `
      <figure class="item"><div class="box pending"><span class="muted">Processing…</span></div></figure>`).join('');
    hydrate($('#ph-grid'));
    for (const inp of $$('.cap-in', root)) {
      inp.onchange = async () => {
        const p = myPhotos.find(x => x.id === inp.dataset.id);
        p.caption = inp.value.trim();
        status('Saving…');
        try { await api.updatePhoto(p.id, { caption: p.caption }); status(`Saved ${fmtTime(new Date())}`); }
        catch (e) { status(`Not saved: ${e.message}`); }
      };
    }
    for (const b of $$('[data-del]', root)) {
      b.onclick = async () => {
        const p = myPhotos[Number(b.dataset.del)];
        if (!confirm('Remove this photo?')) return;
        try { await api.deletePhoto(p); myPhotos = myPhotos.filter(x => x !== p); drawPhotos(); drawReq(); }
        catch (e) { status(`Not removed: ${e.message}`); }
      };
    }
  }
  drawPhotos();
  $('#ph-in').onchange = async e => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - myPhotos.length);
    e.target.value = '';
    if (!files.length) return;
    let left = files.length;
    drawPhotos(left);
    if (!mine) await persist().catch(() => {}); // make sure you count as "ready"
    for (const f of files) {
      status(`Uploading ${files.length - left + 1}/${files.length}…`);
      try {
        const pos = (myPhotos.at(-1)?.position ?? -1) + 1;
        myPhotos.push(await api.uploadPhoto(call.id, uid, f, pos));
      } catch (err) { alert(`${f.name}: ${err.message}`); }
      drawPhotos(--left);
    }
    status(`Saved ${fmtTime(new Date())}`);
    drawReq();
  };
  drawReq(false);

  $('#contrib').onsubmit = e => e.preventDefault();
}

// ── Materials ──────────────────────────────────────────────────────────────
async function viewMaterial(kind) {
  const label = Object.fromEntries(MATERIALS)[kind];
  if (!label) return viewNotFound();
  setTitle(label);
  setBar(`[M] ${label} <span class="count" id="m-count"></span>`);
  app.innerHTML = '<p class="muted center pad">Loading…</p>';
  const items = (await loadArchive())[kind];
  $('#m-count').textContent = `(${items.length})`;
  if (!items.length) { app.innerHTML = '<p class="muted center pad">Nothing here yet. Things appear once a call unlocks.</p>'; return; }

  const byCall = new Map();
  items.forEach((it, i) => { if (!byCall.has(it.call)) byCall.set(it.call, []); byCall.get(it.call).push([it, i]); });
  lbGroups[kind] = items;
  const card = ([it, i]) => (kind === 'selfie' || kind === 'photo') ? figure(it, kind, i)
    : kind === 'links' ? linkCard(it)
    : textCard(kind === 'answers' ? { ...it, body: it.body, caption: `${it.caption} · ${it.question}` } : it);
  app.innerHTML = [...byCall].map(([call, list]) => `
    <p class="label sec"><a href="#/call/${call.number}">[${callName(call)}]</a> ${esc(call.title)}</p>
    <div class="grid ${kind === 'selfie' || kind === 'photo' ? '' : 'text'}">${list.map(card).join('')}</div>`).join('');
  hydrate();
}

// ── Admin ──────────────────────────────────────────────────────────────────
function viewAdmin(editNumber) {
  if (!state.me.is_admin) return viewNotFound();
  setTitle('Admin');
  setBar('[A] Admin');
  const editing = editNumber === 'new' ? null : state.calls.find(c => c.number === Number(editNumber));
  if (editNumber !== undefined) return adminForm(editing);
  app.innerHTML = `
    <section class="admin">
      <p><a href="#/admin/new" class="btn">New call</a></p>
      <table class="sheet">
        <thead><tr><th>No</th><th>Title</th><th>Unlock</th><th>Uploads</th><th></th></tr></thead>
        <tbody>${state.calls.map(c => `
          <tr>
            <td>${pad(c.number)}</td><td>${esc(c.title || '—')}</td>
            <td>${esc(fmtDate(c.reveal_at))}</td>
            <td>${isRevealed(c) ? 'Unlocked' : c.is_open ? 'Open' : 'Closed'}</td>
            <td><a href="#/admin/${c.number}">Edit</a></td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No calls yet.</td></tr>'}
        </tbody>
      </table>
    </section>`;
}

function adminForm(call) {
  const nextNo = Math.max(0, ...state.calls.map(c => c.number)) + 1;
  const defaultReveal = (() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(21, 0, 0, 0); return d.toISOString(); })();
  let questions = (call?.questions || []).map(q => ({ ...q }));
  if (!call && !questions.length) {
    const last = state.calls[0];
    questions = (last?.questions || []).map(q => ({ ...q }));
  }
  const qid = () => `q${Math.random().toString(36).slice(2, 8)}`;

  app.innerHTML = `
    <form class="admin contrib" id="call-form">
      <p class="label">[${call ? `Edit ${callName(call)}` : 'New call'}]</p>
      <div class="field two">
        <label>No. <input type="number" name="number" min="1" required class="line" value="${call?.number ?? nextNo}"></label>
        <label>Title <input name="title" class="line" placeholder="e.g. October" value="${esc(call?.title ?? '')}"></label>
      </div>
      <div class="field">
        <p class="label">[Questions]</p>
        <div id="qs"></div>
        <div class="row">
          <button type="button" class="link" id="q-add">+ Add question</button>
          ${state.calls.length ? `<select id="q-copy" class="line"><option value="">Copy questions from…</option>
            ${state.calls.filter(c => c !== call).map(c => `<option value="${c.id}">${callName(c)}</option>`).join('')}</select>` : ''}
        </div>
      </div>
      <div class="field">
        <p class="label">[Photo prompt]</p>
        <label>Theme for this month's photo (optional)
          <input name="photo_prompt" class="line" placeholder="e.g. The view from your window right now" value="${esc(call?.photo_prompt ?? '')}"></label>
      </div>
      <div class="field">
        <p class="label">[Unlock]</p>
        <label>Everything becomes visible at
          <input type="datetime-local" name="reveal" required class="line" value="${toLocalInput(call?.reveal_at ?? defaultReveal)}"></label>
        <p class="small muted">Your timezone: ${esc(TZ)}. Everyone sees it converted to their own.</p>
      </div>
      <div class="field">
        <label class="check"><input type="checkbox" name="open" ${call?.is_open ? 'checked' : ''}> Uploads open</label>
        <p class="small muted">Members can add and edit their contribution only while this is on and before the unlock.</p>
      </div>
      <div class="row">
        <button class="btn">Save</button>
        <a href="#/admin" class="link">Cancel</a>
        ${call ? '<button type="button" class="link danger" id="del">Delete call</button>' : ''}
      </div>
      <p class="msg" id="admin-msg"></p>
    </form>`;

  function drawQs() {
    $('#qs').innerHTML = questions.map((q, i) => `
      <div class="link-row">
        <span class="muted">Q${i + 1}</span>
        <input class="line" data-i="${i}" value="${esc(q.text)}" placeholder="Question">
        <button type="button" class="link" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" class="link" data-rm="${i}" aria-label="Remove">×</button>
      </div>`).join('') || '<p class="small muted">No questions yet.</p>';
    for (const inp of $$('#qs input')) inp.oninput = () => { questions[inp.dataset.i].text = inp.value; };
    for (const b of $$('#qs [data-rm]')) b.onclick = () => { questions.splice(Number(b.dataset.rm), 1); drawQs(); };
    for (const b of $$('#qs [data-up]')) b.onclick = () => {
      const i = Number(b.dataset.up);
      [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
      drawQs();
    };
  }
  drawQs();
  $('#q-add').onclick = () => { questions.push({ id: qid(), text: '' }); drawQs(); $('#qs input:last-of-type')?.focus(); };
  const copy = $('#q-copy');
  if (copy) copy.onchange = () => {
    const src = state.calls.find(c => String(c.id) === copy.value);
    if (src) { questions = src.questions.map(q => ({ ...q })); drawQs(); }
    copy.value = '';
  };

  const f = $('#call-form'), msg = $('#admin-msg');
  f.onsubmit = async e => {
    e.preventDefault();
    const row = {
      number: Number(f.number.value),
      title: f.title.value.trim(),
      questions: questions.filter(q => q.text.trim()).map(q => ({ id: q.id, text: q.text.trim() })),
      reveal_at: fromLocalInput(f.reveal.value),
      is_open: f.open.checked,
    };
    const prompt = f.photo_prompt.value.trim();
    if (prompt || (call && 'photo_prompt' in call)) row.photo_prompt = prompt;
    if (call) row.id = call.id;
    msg.textContent = 'Saving…';
    try {
      await api.saveCall(row);
      state.calls = await api.listCalls();
      location.hash = `#/call/${row.number}`;
    } catch (err) { msg.textContent = err.message; }
  };
  const del = $('#del');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${callName(call)} and everything uploaded to it? This cannot be undone.`)) return;
    try { await api.deleteCall(call.id); state.calls = await api.listCalls(); location.hash = '#/admin'; }
    catch (err) { msg.textContent = err.message; }
  };
}

function viewAbout() {
  setTitle('About');
  setBar('[I] About');
  app.innerHTML = `
    <section class="about">
      <p class="label">[About]</p>
      <p class="lead">${esc(SITE_NAME)} is the archive of our monthly calls.</p>
      <p>Before each call the admin opens uploads. Everyone adds a selfie, answers the questions of the month, and shares photos, words and links.</p>
      <p>Nobody, admin included, can see what the others uploaded until the unlock time. Then everything opens at once and stays here for good.</p>
      <p class="small muted">Photos are resized on your device before uploading and their metadata (location included) is removed. Times are shown in your timezone (${esc(TZ)}).</p>
    </section>`;
}

function viewNotFound() {
  setTitle('Not found');
  setBar('—');
  app.innerHTML = '<p class="muted center pad">Nothing here. <a href="#/">Back to index</a></p>';
}

// ── Router ─────────────────────────────────────────────────────────────────
async function route() {
  if (!state.session) return viewLogin();
  if (!state.me) return viewNotMember();
  closeLightbox();
  const [, a, b] = (location.hash.replace(/^#/, '') || '/').split('/');
  window.scrollTo(0, 0);
  try {
    if (!a) return await viewHome();
    if (a === 'calls') return viewCalls();
    if (a === 'call') return await viewCall(b);
    if (a === 'm') return await viewMaterial(b);
    if (a === 'admin') return viewAdmin(b);
    if (a === 'about') return viewAbout();
    viewNotFound();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<p class="msg center pad">Something went wrong: ${esc(e.message)}<br><a href="#/">Back to index</a></p>`;
  }
}

async function boot() {
  const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_description');
  state.session = await api.getSession();
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
  state.me = null;
  if (state.session) {
    try {
      [state.members, state.calls] = await Promise.all([api.listMembers(), api.listCalls()]);
      state.me = member(state.session.user.email) ?? null;
    } catch (e) {
      app.innerHTML = `<p class="msg center pad">Could not reach the archive: ${esc(e.message)}</p>`;
      return;
    }
  }
  if (!state.session && hashErr) return viewLogin(hashErr);
  route();
}

window.addEventListener('hashchange', route);
api.sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { state.session = null; route(); } });
boot();
