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
const state = { session: null, me: null, members: [], calls: [], mine: new Map() };
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
// Calls still waiting for my contribution: open, and not submitted yet (nothing, or only a draft).
const pendingCalls = () => [...state.calls].reverse().filter(c => isAccepting(c) && !state.mine.get(c.id));
const isDraft = c => state.mine.has(c.id);
const member = email => state.members.find(m => m.email.toLowerCase() === String(email).toLowerCase());
const nameOf = email => member(email)?.name ?? 'Someone';
const sortOf = email => member(email)?.sort ?? 99;
const normUrl = u => { u = u.trim(); return !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`; };
const safeHref = u => (/^https?:\/\//i.test(u) ? u : '#');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Supabase/network errors → sentences people can act on.
function friendly(err) {
  const m = String(err?.message ?? err ?? '');
  if (/row-level security|violates row|permission denied/i.test(m)) return 'This call is closed or already unlocked, so changes can no longer be saved.';
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(m)) return 'Connection problem. Check your internet and try again.';
  if (/calls_number_key|duplicate key/i.test(m)) return 'A call with this number already exists. Choose another number.';
  if (/rate limit|security purposes|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/link is invalid|has expired|otp_expired/i.test(m)) return 'This login link has expired or was already used. Request a new one, and use only the most recent email.';
  if (/token has expired|invalid.*token|otp/i.test(m)) return 'This code is wrong or has expired. Request a new link.';
  if (/invalid.*email|unable to validate email/i.test(m)) return 'This email address is not valid.';
  if (/payload too large|exceeded the maximum/i.test(m)) return 'This file is too large.';
  if (/not an image|HEIC/i.test(m)) return m;
  return m ? `Something went wrong (${m}).` : 'Something went wrong.';
}

// Keep keyboard focus inside an open dialog; returns a function that releases it
// and puts focus back where it was.
function trapFocus(container) {
  const before = document.activeElement;
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const onKey = e => {
    if (e.key !== 'Tab') return;
    const items = $$(sel, container).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    if (before && document.contains(before)) before.focus();
  };
}

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
    if (left <= 0 && !el.dataset.done) { el.dataset.done = '1'; setTimeout(async () => { await route(); promptShow(); }, 1200); }
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
const altOf = item => [
  item.qid === 'selfie' ? `Selfie of ${item.name}` : `Photo by ${item.name}${item.question ? `, ${item.question}` : ''}`,
  item.text,
].filter(Boolean).join(': ');

function figure(item, group, i) {
  const ratio = item.w && item.h ? `${item.w}/${item.h}` : '1/1';
  return `
    <figure class="item" data-lb="${group}" data-i="${i}" tabindex="0" role="button" aria-label="Open ${esc(altOf(item))}">
      <div class="box"><img data-src="${esc(item.thumb)}" alt="${esc(altOf(item))}" loading="lazy" style="aspect-ratio:${ratio}"></div>
      <figcaption>${esc(item.caption)}</figcaption>
      ${item.text ? `<p class="note">${esc(item.text)}</p>` : ''}
    </figure>`;
}

const lb = $('#lb');
let lbItems = [], lbIndex = 0, lbRelease = null;
async function showLightbox(items, i) {
  lbItems = items; lbIndex = (i + items.length) % items.length;
  const it = lbItems[lbIndex];
  const img = $('img', lb);
  img.classList.remove('in');
  img.removeAttribute('src');
  $('.lb-cap', lb).innerHTML = `${esc(it.caption)}${it.text ? ` — ${esc(it.text)}` : ''}`;
  $('.lb-count', lb).textContent = `${lbIndex + 1} / ${lbItems.length}`;
  img.alt = altOf(it);
  if (lb.hidden) {
    lb.hidden = false;
    document.body.classList.add('noscroll');
    lbRelease = trapFocus(lb);
    $('.lb-close', lb).focus();
  }
  const urls = await api.signedUrls([it.path]);
  if (lbItems[lbIndex] !== it) return;
  img.onload = () => img.classList.add('in');
  img.src = urls[it.path];
}
function closeLightbox() {
  if (lb.hidden) return;
  lb.hidden = true;
  document.body.classList.remove('noscroll');
  lbRelease?.(); lbRelease = null;
}
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
app.addEventListener('keydown', e => {
  const f = e.target.closest?.('[data-lb]');
  if (f && (e.key === 'Enter' || e.key === ' ') && lbGroups[f.dataset.lb]) {
    e.preventDefault();
    showLightbox(lbGroups[f.dataset.lb], Number(f.dataset.i));
  }
});

// ── Questions ──────────────────────────────────────────────────────────────
// { id, text, type: 'text' | 'photo' | 'link', required, multiple }
const SELFIE = { id: 'selfie', text: 'Selfie', type: 'photo', required: true, multiple: false };
const MULTI_MAX = 6;
const qType = q => q.type || 'text';
const qMax = q => (q.multiple ? MULTI_MAX : 1);
const TYPE_LABEL = { text: 'Text', photo: 'Photo', link: 'Link' };

// ── Archive data (only unlocked calls) ─────────────────────────────────────
async function loadArchive(callId) {
  const unlocked = new Map(state.calls.filter(isRevealed).map(c => [c.id, c]));
  const [subs, photos] = await Promise.all([api.listSubmissions(callId), api.listPhotos(callId)]);
  const out = { selfie: [], photo: [], text: [], links: [] };

  for (const s of subs) {
    const call = unlocked.get(s.call_id);
    if (!call) continue;
    const name = nameOf(s.author_email), p = pad(call.number), n = slug(name);
    (call.questions || []).forEach((q, qi) => {
      const v = s.answers?.[q.id];
      const base = { call, email: s.author_email, name, qid: q.id, qi, question: q.text };
      if (qType(q) === 'text' && typeof v === 'string' && v.trim()) {
        out.text.push({ ...base, body: v.trim(), caption: `${p}_q${qi + 1}_${n}` });
      } else if (qType(q) === 'link' && Array.isArray(v)) {
        v.filter(l => l.url).forEach((l, li) =>
          out.links.push({ ...base, ...l, caption: `${p}_lnk${qi + 1}_${n}${li ? `-${li + 1}` : ''}` }));
      }
    });
  }
  const counters = {};
  for (const ph of photos) {
    const call = unlocked.get(ph.call_id);
    if (!call) continue;
    const qi = (call.questions || []).findIndex(q => q.id === ph.question_id);
    const name = nameOf(ph.author_email), n = slug(name), p = pad(call.number);
    const key = `${call.id}:${ph.question_id}:${ph.author_email}`;
    counters[key] = (counters[key] || 0) + 1;
    const isSelfie = ph.question_id === 'selfie';
    const caption = isSelfie ? `${p}_selfie_${n}` : `${p}_ph${qi + 1}_${n}-${counters[key]}`;
    (isSelfie ? out.selfie : out.photo).push({
      call, email: ph.author_email, name, qid: ph.question_id, qi, question: call.questions?.[qi]?.text ?? '',
      path: ph.path, thumb: ph.thumb, w: ph.w, h: ph.h, text: ph.caption, caption,
    });
  }
  for (const k in out) {
    out[k].sort((a, b) => b.call.number - a.call.number || a.qi - b.qi || sortOf(a.email) - sortOf(b.email));
  }
  return out;
}

const MATERIALS = [['selfie', 'Selfie'], ['photo', 'Photo'], ['text', 'Text'], ['links', 'Links']];

// ── Views ──────────────────────────────────────────────────────────────────
function viewLogin(msg = '') {
  setTitle('Log in');
  bar.innerHTML = '';
  app.innerHTML = `
    <section class="login">
      <h1 class="label">[Login]</h1>
      <form id="f-email" class="stack">
        <p class="lead">Enter your email. You'll get a link to log in.</p>
        <input type="email" name="email" placeholder="Email" aria-label="Email" required autocomplete="email" class="line">
        <button class="btn">Send link</button>
      </form>
      <form id="f-code" class="stack" hidden>
        <p class="lead">Check your inbox and open the link.<br>Or type the code from the email here:</p>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" aria-label="Code from the email" class="line" maxlength="10">
        <div class="row"><button class="btn">Log in</button><button type="button" class="link" id="again">Use another email</button></div>
      </form>
      <p class="msg" id="login-msg" role="status" aria-live="polite">${esc(msg)}</p>
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
    } catch (err) { m.textContent = friendly(err); }
  };
  fc.onsubmit = async e => {
    e.preventDefault();
    m.textContent = 'Checking…';
    try { await api.verifyCode(email, fc.code.value.trim()); await boot(); }
    catch (err) { m.textContent = friendly(err); }
  };
  $('#again').onclick = () => { fc.hidden = true; fe.hidden = false; m.textContent = ''; };
}

function viewConfirmLink(tokenHash, type) {
  setTitle('Log in');
  bar.innerHTML = '';
  app.innerHTML = `
    <section class="login">
      <h1 class="label">[Login]</h1>
      <p class="lead">Tap to finish logging in.</p>
      <button type="button" class="btn" id="go">Log in</button>
      <p class="msg" id="login-msg" role="status" aria-live="polite"></p>
    </section>`;
  const go = $('#go');
  go.focus();
  go.onclick = async () => {
    go.disabled = true;
    $('#login-msg').textContent = 'Logging in…';
    try {
      await api.verifyLink(tokenHash, type);
      history.replaceState(null, '', location.pathname + '#/');
      boot();
    } catch (err) {
      history.replaceState(null, '', location.pathname + '#/');
      viewLogin(friendly(err));
    }
  };
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
  const pending = pendingCalls();
  const due = pending[0];
  const next = due ?? [...calls].reverse().find(c => !isRevealed(c));
  app.innerHTML = `
    <h1 class="sr">${esc(SITE_NAME)}</h1>
    <section class="index">
      <div class="col">
        <h2 class="label">[Calls]</h2>
        <ul class="big"><li><a href="#/calls">Datasheet</a> <span class="count">(${calls.length})</span></li></ul>
        <ul class="big gap">${calls.slice(0, 6).map(c => `
          <li><a href="#/call/${c.number}">${callName(c)}</a> ${pending.includes(c) ? '<span class="count alert">Upload due</span>' : `<span class="count">${statusOf(c)}</span>`}</li>`).join('')}
        </ul>
        ${next ? `<p class="small next ${due ? 'alert' : ''}">
          ${due
            ? `Upload open: <a href="#/call/${due.number}">${callName(due)}</a><br>
               ${isDraft(due) ? 'Your contribution is a draft: submit it' : 'Your contribution is missing'} before<br>`
            : `Next unlock: <a href="#/call/${next.number}">${callName(next)}</a><br>`}
          ${esc(fmtDate(next.reveal_at))} · <span data-countdown="${next.reveal_at}">${countdown(new Date(next.reveal_at) - Date.now())}</span></p>` : ''}
      </div>
      <div class="col">
        <h2 class="label">[Materials]</h2>
        <div id="mat"><ul class="big">${MATERIALS.map(([k, l]) => `<li><a href="#/m/${k}">${l}</a> <span class="count">( )</span></li>`).join('')}</ul></div>
      </div>
      <div class="col small-col">
        <h2 class="label">[Info]</h2>
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
  const groups = [['selfie', 'photo'], ['text', 'links']];
  const label = Object.fromEntries(MATERIALS);
  $('#mat').innerHTML = groups.map(g => `<ul class="big">${g.map(k => `
    <li><a href="#/m/${k}">${label[k]}</a> <span class="count">(${data[k].length})</span></li>`).join('')}</ul>`).join('');
  if (!pending.length) splash([...data.selfie, ...data.photo]);
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
    <h1 class="sr">Datasheet: all calls</h1>
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
  async function drawProgress() {
    const progress = await api.callProgress(call.id);
    const ready = progress.filter(p => p.ready).length;
    $('#progress').innerHTML = `
      <p class="label">[Submitted ${ready}/${progress.length}]</p>
      <ul class="ready">${progress.map(p => `
        <li class="${p.ready ? 'on' : p.started ? 'half' : ''}"><span class="dot" aria-hidden="true"></span>${esc(p.name)}<span class="sr">: ${p.ready ? 'submitted' : p.started ? 'draft' : 'not started'}</span></li>`).join('')}
      </ul>
      <p class="small muted legend" aria-hidden="true">● submitted · ◐ draft · ○ not started</p>`;
  }
  await drawProgress();
  const mine = $('#mine');
  if (isAccepting(call)) return renderForm(call, mine, () => drawProgress().catch(() => {}));
  mine.innerHTML = `<p class="muted center">Uploads are closed for this call.</p>`;
}

async function renderUnlocked(call, body) {
  const d = await loadArchive(call.id);
  const g = `c${call.id}`;
  const photos = [...d.selfie, ...d.photo];
  lbGroups[g] = photos;
  const people = [...new Set([...photos, ...d.text, ...d.links].map(x => x.name))];

  body.innerHTML = `
    ${people.length ? '<p class="center"><button type="button" class="btn" id="play">▶ Play the show</button></p>' : ''}
    ${(call.questions || []).map((q, qi) => {
      const type = qType(q);
      let inner = '';
      if (type === 'photo') {
        inner = photos.map((it, i) => [it, i]).filter(([it]) => it.qid === q.id)
          .map(([it, i]) => figure(it, g, i)).join('');
        inner = inner && `<div class="grid">${inner}</div>`;
      } else {
        const list = (type === 'link' ? d.links : d.text).filter(it => it.qid === q.id);
        inner = list.length ? `<div class="grid text">${list.map(type === 'link' ? linkCard : textCard).join('')}</div>` : '';
      }
      return inner && `<h2 class="label sec">[Q${qi + 1}] ${esc(q.text)}</h2>${inner}`;
    }).join('')}
    ${people.length ? '' : '<p class="muted center">Nobody uploaded anything for this call.</p>'}
    <dl class="meta">
      <dt>No.</dt><dd>${pad(call.number)}</dd>
      <dt>Title</dt><dd>${esc(call.title || '—')}</dd>
      <dt>Unlocked</dt><dd>${esc(fmtDate(call.reveal_at))}</dd>
      <dt>Participants</dt><dd>${esc(people.join(', ') || '—')}</dd>
      <dt>Photos</dt><dd>${photos.length}</dd>
    </dl>`;
  const play = $('#play');
  if (play) play.onclick = () => openModal(`
    <p class="label">[Play the show]</p>
    <p class="lead" id="modal-title">Are you all connected right now?</p>
    <p class="small muted">Together, whoever clicks moves the show for everyone watching.</p>
    <div class="row">
      <button type="button" class="btn" data-close data-together>Yes, together</button>
      <button type="button" class="link" data-close data-solo>No, on my own</button>
    </div>`).addEventListener('click', e => {
      if (e.target.closest('[data-together]')) startShow(call, true);
      if (e.target.closest('[data-solo]')) startShow(call, false);
    });
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
// Every change is saved automatically as a draft; Submit marks it as done.
// Editing after Submit is fine, but removing a required answer turns it back into a draft.
async function renderForm(call, root, onProgress = () => {}) {
  const uid = state.session.user.id;
  const qs = call.questions || [];
  const [subs, photos] = await Promise.all([api.listSubmissions(call.id), api.listPhotos(call.id)]);
  const mine = subs.find(s => s.user_id === uid);
  let started = !!mine;
  let submittedAt = mine?.submitted_at ?? null;
  let myPhotos = photos.filter(p => p.user_id === uid);
  const photosFor = qid => myPhotos.filter(p => p.question_id === qid);

  const answers = {};
  for (const q of qs) {
    const v = mine?.answers?.[q.id];
    if (qType(q) === 'text') answers[q.id] = typeof v === 'string' ? v : '';
    if (qType(q) === 'link') {
      answers[q.id] = Array.isArray(v) && v.length ? v.map(l => ({ url: l.url || '', label: l.label || '' })) : [{ url: '', label: '' }];
    }
  }

  const field = (q, i) => {
    const type = qType(q);
    let input = '';
    if (type === 'text') {
      input = `<textarea data-text="${esc(q.id)}" id="in-${esc(q.id)}" rows="3" class="area" aria-describedby="err-${esc(q.id)}" ${q.required ? 'aria-required="true"' : ''}>${esc(answers[q.id])}</textarea>`;
    } else if (type === 'photo') {
      input = `
        <div class="grid edit" data-photos="${esc(q.id)}"></div>
        <label class="btn file" data-add="${esc(q.id)}">Add ${q.multiple ? 'photos' : 'photo'}<input type="file" accept="image/*" ${q.multiple ? 'multiple' : ''} aria-describedby="err-${esc(q.id)}"></label>
        <span class="small muted">${q.multiple ? `up to ${MULTI_MAX}` : 'one photo'}</span>`;
    } else {
      input = `<div data-links="${esc(q.id)}"></div>
        ${q.multiple ? `<button type="button" class="link" data-link-add="${esc(q.id)}">+ Add link</button>` : ''}`;
    }
    return `
      <div class="field" data-field="${esc(q.id)}">
        <p class="label">[Q${i + 1}] ${q.required ? '<span class="req-tag">Required</span>' : '<span class="muted">Optional</span>'}</p>
        ${type === 'text' ? `<label class="q" for="in-${esc(q.id)}">${esc(q.text)}</label>` : `<p class="q" id="qt-${esc(q.id)}">${esc(q.text)}</p>`}
        ${input}
        <p class="err" data-err id="err-${esc(q.id)}" role="alert"></p>
      </div>`;
  };

  root.innerHTML = `
    <form class="contrib" id="contrib" autocomplete="off" novalidate>
      <h2 class="label">[Your contribution]</h2>
      <p class="small muted">Only you can see this until the unlock. Everything is saved automatically as a draft: press <b>Submit</b> when you're done. You can keep editing until the unlock.</p>
      ${qs.map(field).join('') || '<p class="muted">No questions for this call.</p>'}
      <div class="submit-bar">
        <span class="state" id="state" role="status" aria-live="polite"></span>
        <button type="submit" class="btn" id="submit">Submit</button>
      </div>
    </form>`;

  // ── State & validation
  const hasAnswer = q => {
    const t = qType(q);
    if (t === 'text') return !!answers[q.id].trim();
    if (t === 'photo') return photosFor(q.id).length > 0;
    return answers[q.id].some(l => normUrl(l.url));
  };
  const missing = () => qs.filter(q => q.required && !hasAnswer(q));
  function showErrors(list) {
    for (const q of qs) {
      const f = $(`[data-field="${CSS.escape(q.id)}"]`, root);
      const bad = list.includes(q);
      f.classList.toggle('invalid', bad);
      $('[data-err]', f).textContent = bad ? 'This answer is required.' : '';
      for (const inp of $$('textarea, input', f)) inp.toggleAttribute('aria-invalid', bad);
    }
  }
  // Clear an error as soon as the field gets an answer.
  const recheck = () => showErrors(missing().filter(q => $(`[data-field="${CSS.escape(q.id)}"]`, root).classList.contains('invalid')));

  function drawState(note = '') {
    const el = $('#state'), btn = $('#submit');
    el.innerHTML = submittedAt
      ? `<b>● Submitted</b> <span class="muted">${fmtTime(new Date(submittedAt))} — edits save automatically</span>`
      : started ? '<b>◐ Draft</b> <span class="muted">— not submitted yet</span>' : '<b>○ Not started</b>';
    if (note) el.innerHTML += ` <span class="${note.startsWith('!') ? 'errtxt' : 'muted'}">· ${esc(note.replace(/^!/, ''))}</span>`;
    btn.textContent = submittedAt ? 'Submitted ✓' : 'Submit';
    btn.classList.toggle('done', !!submittedAt);
  }

  const payload = () => {
    const out = {};
    for (const q of qs) {
      if (qType(q) === 'text' && answers[q.id].trim()) out[q.id] = answers[q.id];
      if (qType(q) === 'link') {
        const links = answers[q.id].map(l => ({ url: normUrl(l.url), label: l.label.trim() })).filter(l => l.url);
        if (links.length) out[q.id] = links;
      }
    }
    return out;
  };

  let timer;
  async function persist(fields = {}) {
    clearTimeout(timer);
    let reopened = false;
    if (submittedAt && !('submitted_at' in fields) && missing().length) { fields.submitted_at = null; reopened = true; }
    const before = `${started}|${!!submittedAt}`;
    drawState('Saving…');
    try {
      const row = await api.saveSubmission(call.id, uid, { answers: payload(), ...fields });
      started = true;
      submittedAt = row.submitted_at;
      state.mine.set(call.id, submittedAt);
      if (reopened) {
        showErrors(missing());
        drawState('!A required answer is missing: this is a draft again');
      } else drawState(`Saved ${fmtTime(new Date())}`);
      if (before !== `${started}|${!!submittedAt}`) onProgress();
    } catch (e) {
      drawState(`!Not saved: ${isAccepting(call) ? friendly(e) : 'this call is locked now.'}`);
      throw e;
    }
  }
  const schedule = () => { drawState('Editing…'); clearTimeout(timer); timer = setTimeout(() => persist().catch(() => {}), 1000); };

  // ── Text
  for (const ta of $$('[data-text]', root)) {
    ta.oninput = () => { answers[ta.dataset.text] = ta.value; recheck(); schedule(); };
  }

  // ── Links
  function drawLinks(qid) {
    const box = $(`[data-links="${CSS.escape(qid)}"]`, root);
    const q = qs.find(x => x.id === qid);
    box.innerHTML = answers[qid].map((l, i) => `
      <div class="link-row">
        <input class="line" data-i="${i}" data-k="url" placeholder="https://…" value="${esc(l.url)}" inputmode="url" aria-label="Link ${i + 1} address" aria-describedby="err-${esc(qid)}">
        <input class="line" data-i="${i}" data-k="label" placeholder="Label (optional)" value="${esc(l.label)}" aria-label="Link ${i + 1} label">
        ${q.multiple && answers[qid].length > 1 ? `<button type="button" class="link x" data-rm="${i}" aria-label="Remove link ${i + 1}">×</button>` : ''}
      </div>`).join('');
    for (const inp of $$('input', box)) {
      inp.oninput = () => { answers[qid][inp.dataset.i][inp.dataset.k] = inp.value; recheck(); schedule(); };
    }
    for (const b of $$('[data-rm]', box)) {
      b.onclick = () => { answers[qid].splice(Number(b.dataset.rm), 1); drawLinks(qid); schedule(); };
    }
    const add = $(`[data-link-add="${CSS.escape(qid)}"]`, root);
    if (add) add.hidden = answers[qid].length >= MULTI_MAX;
  }
  for (const q of qs.filter(q => qType(q) === 'link')) {
    drawLinks(q.id);
    const add = $(`[data-link-add="${CSS.escape(q.id)}"]`, root);
    if (add) add.onclick = () => { answers[q.id].push({ url: '', label: '' }); drawLinks(q.id); };
  }

  // ── Photos
  function drawPhotos(q, pending = 0) {
    const grid = $(`[data-photos="${CSS.escape(q.id)}"]`, root);
    const list = photosFor(q.id);
    const add = $(`[data-add="${CSS.escape(q.id)}"]`, root);
    add.hidden = list.length + pending >= qMax(q);
    add.nextElementSibling.hidden = add.hidden;
    grid.innerHTML = list.map((p, k) => `
      <figure class="item">
        <div class="box"><img data-src="${esc(p.thumb)}" alt="Your photo ${k + 1}${p.caption ? `: ${esc(p.caption)}` : ''}" style="aspect-ratio:${p.w}/${p.h}"></div>
        <input class="line cap-in" data-id="${p.id}" placeholder="Caption (optional)" value="${esc(p.caption)}" aria-label="Caption for photo ${k + 1}">
        <button type="button" class="link" data-del="${p.id}" aria-label="Remove photo ${k + 1}">Remove</button>
      </figure>`).join('') + Array.from({ length: pending }, () => `
      <figure class="item"><div class="box pending"><span class="muted small">Processing…</span></div></figure>`).join('');
    hydrate(grid);
    for (const inp of $$('.cap-in', grid)) {
      inp.onchange = async () => {
        const p = myPhotos.find(x => x.id === inp.dataset.id);
        p.caption = inp.value.trim();
        drawState('Saving…');
        try { await api.updatePhoto(p.id, { caption: p.caption }); drawState(`Saved ${fmtTime(new Date())}`); }
        catch (e) { drawState(`!Not saved: ${friendly(e)}`); }
      };
    }
    for (const b of $$('[data-del]', grid)) {
      b.onclick = async () => {
        const p = myPhotos.find(x => x.id === b.dataset.del);
        if (!confirm('Remove this photo?')) return;
        try {
          await api.deletePhoto(p);
          myPhotos = myPhotos.filter(x => x !== p);
          drawPhotos(q);
          if (submittedAt && missing().length) await persist();
          else drawState(`Saved ${fmtTime(new Date())}`);
        } catch (e) { drawState(`!Not removed: ${friendly(e)}`); }
      };
    }
  }
  for (const q of qs.filter(q => qType(q) === 'photo')) {
    drawPhotos(q);
    $(`[data-add="${CSS.escape(q.id)}"] input`, root).onchange = async e => {
      const files = [...e.target.files].slice(0, qMax(q) - photosFor(q.id).length);
      e.target.value = '';
      if (!files.length) return;
      let left = files.length;
      drawPhotos(q, left);
      for (const f of files) {
        drawState(`Uploading ${files.length - left + 1}/${files.length}…`);
        try {
          const pos = (photosFor(q.id).at(-1)?.position ?? -1) + 1;
          myPhotos.push(await api.uploadPhoto(call.id, uid, q.id, f, pos));
        } catch (err) { alert(`${f.name}: ${friendly(err)}`); }
        drawPhotos(q, --left);
      }
      recheck();
      if (!started) await persist().catch(() => {});
      else drawState(`Saved ${fmtTime(new Date())}`);
    };
  }

  // ── Submit
  $('#contrib').onsubmit = async e => {
    e.preventDefault();
    const miss = missing();
    showErrors(miss);
    if (miss.length) {
      drawState(`!${miss.length} required ${miss.length > 1 ? 'answers are' : 'answer is'} missing`);
      const first = $(`[data-field="${CSS.escape(miss[0].id)}"]`, root);
      first.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      $('textarea, input', first)?.focus({ preventScroll: true });
      return;
    }
    await persist({ submitted_at: new Date().toISOString() }).catch(() => {});
  };

  drawState();
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

  const isImg = kind === 'selfie' || kind === 'photo';
  const byCall = new Map();
  items.forEach((it, i) => { if (!byCall.has(it.call)) byCall.set(it.call, []); byCall.get(it.call).push([it, i]); });
  lbGroups[kind] = items;
  const card = ([it, i]) => (isImg ? figure(it, kind, i)
    : kind === 'links' ? linkCard({ ...it, caption: `${it.caption} · ${it.question}` })
    : textCard({ ...it, caption: `${it.caption} · ${it.question}` }));
  app.innerHTML = `<h1 class="sr">${label}</h1>` + [...byCall].map(([call, list]) => `
    <h2 class="label sec"><a href="#/call/${call.number}">[${callName(call)}]</a> ${esc(call.title)}</h2>
    <div class="grid ${isImg ? '' : 'text'}">${list.map(card).join('')}</div>`).join('');
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
      <h1 class="sr">Admin</h1>
      <p><a href="#/admin/new" class="btn">New call</a></p>
      <table class="sheet">
        <thead><tr><th>No</th><th>Title</th><th>Unlock</th><th>Uploads</th><th><span class="sr">Actions</span></th></tr></thead>
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
  const qid = () => `q${Math.random().toString(36).slice(2, 8)}`;
  const norm = q => ({ id: q.id, text: q.text ?? '', type: qType(q), required: !!q.required, multiple: !!q.multiple });
  let questions = (call?.questions || []).map(norm);
  if (!call) {
    // New call: start from the previous call's questions, always with the selfie first.
    questions = (state.calls[0]?.questions || []).map(norm);
    if (!questions.some(q => q.id === 'selfie')) questions.unshift({ ...SELFIE });
  }

  app.innerHTML = `
    <form class="admin contrib" id="call-form">
      <h1 class="label">[${call ? `Edit ${callName(call)}` : 'New call'}]</h1>
      <div class="field two">
        <label>No. <input type="number" name="number" min="1" required class="line" value="${call?.number ?? nextNo}"></label>
        <label>Title <input name="title" class="line" placeholder="e.g. October" value="${esc(call?.title ?? '')}"></label>
      </div>
      <div class="field">
        <p class="label">[Questions]</p>
        <div id="qs"></div>
        <div class="row">
          <button type="button" class="link" id="q-add">+ Add question</button>
          ${state.calls.length ? `<select id="q-copy" class="line" aria-label="Copy questions from another call"><option value="">Copy questions from…</option>
            ${state.calls.filter(c => c !== call).map(c => `<option value="${c.id}">${callName(c)}</option>`).join('')}</select>` : ''}
        </div>
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
      <p class="msg" id="admin-msg" role="alert"></p>
    </form>`;

  // How many people already started on this call (to warn before destructive edits).
  let started = 0;
  if (call && !isRevealed(call)) api.callProgress(call.id).then(p => { started = p.filter(x => x.started).length; }).catch(() => {});
  else if (call) started = 1;

  function drawQs() {
    $('#qs').innerHTML = questions.map((q, i) => `
      <div class="q-row" data-i="${i}">
        <span class="muted qn">Q${i + 1}</span>
        <input class="line q-text" data-k="text" value="${esc(q.text)}" placeholder="Question" aria-label="Question ${i + 1}">
        <div class="q-opts">
          <select class="line" data-k="type" aria-label="Question ${i + 1} answer type">
            ${Object.entries(TYPE_LABEL).map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <label class="check sm"><input type="checkbox" data-k="required" ${q.required ? 'checked' : ''}> Required</label>
          <label class="check sm" ${q.type === 'text' ? 'style="visibility:hidden"' : ''}><input type="checkbox" data-k="multiple" ${q.multiple ? 'checked' : ''}> Several</label>
          <button type="button" class="link x" data-up aria-label="Move question ${i + 1} up" ${i ? '' : 'disabled'}>↑</button>
          <button type="button" class="link x" data-rm aria-label="Remove question ${i + 1}">×</button>
        </div>
      </div>`).join('') || '<p class="small muted">No questions yet.</p>';
    for (const row of $$('#qs .q-row')) {
      const q = questions[row.dataset.i];
      $('[data-k="text"]', row).oninput = e => { q.text = e.target.value; };
      $('[data-k="type"]', row).onchange = e => {
        if (started && !confirm(`${started} ${started > 1 ? 'people have' : 'person has'} already started answering. Changing the type hides existing answers to this question. Continue?`)) {
          e.target.value = q.type;
          return;
        }
        q.type = e.target.value;
        if (q.type === 'text') q.multiple = false;
        drawQs();
      };
      $('[data-k="required"]', row).onchange = e => { q.required = e.target.checked; };
      $('[data-k="multiple"]', row).onchange = e => { q.multiple = e.target.checked; };
      $('[data-rm]', row).onclick = () => {
        if (started && !confirm(`${started} ${started > 1 ? 'people have' : 'person has'} already started answering. Removing this question hides their answers to it. Continue?`)) return;
        questions.splice(Number(row.dataset.i), 1);
        drawQs();
      };
      $('[data-up]', row).onclick = () => {
        const i = Number(row.dataset.i);
        [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
        drawQs();
      };
    }
  }
  drawQs();
  $('#q-add').onclick = () => {
    questions.push({ id: qid(), text: '', type: 'text', required: false, multiple: false });
    drawQs();
    $$('#qs .q-text').at(-1)?.focus();
  };
  const copy = $('#q-copy');
  if (copy) copy.onchange = () => {
    const src = state.calls.find(c => String(c.id) === copy.value);
    if (src) { questions = src.questions.map(norm); drawQs(); }
    copy.value = '';
  };

  const f = $('#call-form'), msg = $('#admin-msg');
  f.onsubmit = async e => {
    e.preventDefault();
    const row = {
      number: Number(f.number.value),
      title: f.title.value.trim(),
      questions: questions.filter(q => q.text.trim()).map(q => ({ ...q, text: q.text.trim() })),
      reveal_at: fromLocalInput(f.reveal.value),
      is_open: f.open.checked,
    };
    if (call) row.id = call.id;
    if (new Date(row.reveal_at) <= Date.now() && !confirm('The unlock time is in the past: everything uploaded will be visible to everyone immediately. Continue?')) return;
    msg.textContent = 'Saving…';
    try {
      await api.saveCall(row);
      state.calls = await api.listCalls();
      location.hash = `#/call/${row.number}`;
    } catch (err) { msg.textContent = friendly(err); }
  };
  const del = $('#del');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${callName(call)} and everything uploaded to it? This cannot be undone.`)) return;
    try { await api.deleteCall(call.id); state.calls = await api.listCalls(); location.hash = '#/admin'; }
    catch (err) { msg.textContent = friendly(err); }
  };
}

function viewAbout() {
  setTitle('About');
  setBar('[I] About');
  app.innerHTML = `
    <section class="about">
      <h1 class="label">[About]</h1>
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
    app.innerHTML = `<p class="msg center pad" role="alert">${esc(friendly(e))}<br><a href="#/">Back to index</a></p>`;
  }
}

async function boot() {
  const query = new URLSearchParams(location.search);
  if (query.get('token_hash')) return viewConfirmLink(query.get('token_hash'), query.get('type') || 'email');
  const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_description');
  state.session = await api.getSession();
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
  state.me = null;
  if (state.session) {
    try {
      [state.members, state.calls] = await Promise.all([api.listMembers(), api.listCalls()]);
      state.me = member(state.session.user.email) ?? null;
      if (state.me) {
        const mine = await api.mySubmissions(state.session.user.id);
        state.mine = new Map(mine.map(r => [r.call_id, r.submitted_at]));
      }
    } catch (e) {
      app.innerHTML = `<p class="msg center pad" role="alert">Could not reach the archive. ${esc(friendly(e))}</p>`;
      return;
    }
  }
  if (!state.session && hashErr) return viewLogin(friendly(hashErr));
  await route();
  if (state.me && !promptShow()) promptPending();
}

// ── Modals ─────────────────────────────────────────────────────────────────
function openModal(inner) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">${inner}</div>`;
  const onKey = e => { if (e.key === 'Escape') el.close(); };
  let release = () => {};
  el.close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', el.close);
    release();
  };
  el.set = html => { $('.modal-card', el).innerHTML = html; $('.btn', el)?.focus(); };
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.close(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', el.close);
  document.body.append(el);
  release = trapFocus(el);
  $('.btn', el)?.focus();
  return el;
}

const onceThisSession = key => {
  try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, '1'); } catch {}
  return true;
};

// Pop-up reminder when a call is open and I haven't submitted yet (once per session per call).
function promptPending() {
  const call = pendingCalls()[0];
  if (!call || $('.modal, .show') || location.hash === `#/call/${call.number}`) return;
  if (!onceThisSession(`mabusy:prompt:${call.id}`)) return;
  openModal(`
    <p class="label alert">[Upload open]</p>
    <p class="lead" id="modal-title">${callName(call)}${call.title ? ` · ${esc(call.title)}` : ''} is open.</p>
    <p>${isDraft(call)
      ? 'Your contribution is still a draft. Finish it and press Submit.'
      : "You haven't uploaded anything yet. Add your selfie and answers."}</p>
    <p class="small alert">Before ${esc(fmtDate(call.reveal_at))} · <span data-countdown="${call.reveal_at}">${countdown(new Date(call.reveal_at) - Date.now())}</span> left</p>
    <div class="row">
      <a class="btn" href="#/call/${call.number}">Add my contribution</a>
      <button type="button" class="link" data-close>Later</button>
    </div>`);
}

// On the day of the call (first 24h after the unlock): offer the show.
const SHOW_WINDOW = 24 * 3600e3;
function promptShow() {
  const call = state.calls.find(c => isRevealed(c) && Date.now() - new Date(c.reveal_at) < SHOW_WINDOW);
  if (!call || $('.modal, .show')) return false;
  if (!onceThisSession(`mabusy:show:${call.id}`)) return false;
  const m = openModal(`
    <p class="label">[${callName(call)} unlocked]</p>
    <p class="lead" id="modal-title">Are you all connected to see how the last period went?</p>
    <div class="row">
      <button type="button" class="btn" data-yes>Yes, start the show</button>
      <button type="button" class="link" data-no>No</button>
    </div>`);
  m.addEventListener('click', e => {
    if (e.target.closest('[data-yes]')) { m.close(); startShow(call, true); }
    if (e.target.closest('[data-no]')) {
      m.set(`
        <p class="label">[${callName(call)} unlocked]</p>
        <p class="lead" id="modal-title">Do you want to watch it on your own, since you're not in the call?</p>
        <div class="row">
          <button type="button" class="btn" data-alone>Yes, watch alone</button>
          <button type="button" class="link" data-browse>No, just browse</button>
        </div>`);
    }
    if (e.target.closest('[data-alone]')) { m.close(); startShow(call, false); }
    if (e.target.closest('[data-browse]')) { m.close(); location.hash = `#/call/${call.number}`; }
  });
  return true;
}

// ── Show: one person at a time, in a random order that is the same for everyone ──
function seededShuffle(list, key) {
  let h = 1779033703;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
  const rand = () => { // mulberry32
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startShow(call, together) {
  const d = await loadArchive(call.id);
  const all = [...d.selfie, ...d.photo, ...d.text, ...d.links];
  const has = new Set(all.map(x => x.email.toLowerCase()));
  const people = seededShuffle(state.members.filter(m => has.has(m.email.toLowerCase())), `${call.id}|${call.reveal_at}`)
    .map(m => ({ name: m.name, items: all.filter(x => x.email.toLowerCase() === m.email.toLowerCase()) }));
  if (!people.length) { alert('Nobody uploaded anything for this call.'); return; }
  const qs = call.questions || [];

  const el = document.createElement('div');
  el.className = 'show';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `${callName(call)} show`);
  el.innerHTML = `
    <div class="show-top">
      <span>${callName(call)}${call.title ? ` · ${esc(call.title)}` : ''}</span>
      <span class="muted" id="show-pos" aria-live="polite"></span>
      <button type="button" class="link" data-x>Close</button>
    </div>
    <div class="track" id="track"></div>
    <div class="show-foot">
      <ul class="who" aria-label="People">${people.map((p, i) => `<li><button type="button" class="link" data-p="${i}">${esc(p.name)}</button></li>`).join('')}</ul>
      <span class="muted small hint">${together ? 'Together: clicks move the show for everyone' : 'On your own'} · <span class="desk">scroll or ← →</span><span class="mob">swipe</span></span>
    </div>`;
  document.body.append(el);
  document.body.classList.add('noscroll');
  const track = $('#track', el);

  // Explicit aspect ratio so panels have their final width before the image loads.
  const showImg = it => `<img data-src="${esc(it.path)}" alt="${esc(altOf(it))}" style="aspect-ratio:${it.w || 4}/${it.h || 3}">`;

  function panels(p, i) {
    const selfie = p.items.find(x => x.qid === 'selfie');
    let html = `
      <section class="panel intro">
        <div><p class="label">[${i + 1}/${people.length}]</p><h2 class="who-name">${esc(p.name)}</h2></div>
        ${selfie ? showImg(selfie) : ''}
      </section>`;
    qs.forEach((q, qi) => {
      if (q.id === 'selfie') return;
      const its = p.items.filter(x => x.qid === q.id);
      if (!its.length) return;
      const head = `<p class="label">[Q${qi + 1}] ${esc(q.text)}</p>`;
      if (qType(q) === 'photo') {
        its.forEach((it, k) => {
          html += `<section class="panel ph">${k ? '<p class="label">&nbsp;</p>' : head}
            ${showImg(it)}<p class="small">${esc(it.text) || '&nbsp;'}</p></section>`;
        });
      } else if (qType(q) === 'link') {
        html += `<section class="panel txt">${head}${its.map(it => `
          <p class="say"><a href="${esc(safeHref(it.url))}" target="_blank" rel="noopener">${esc(it.label || hostOf(it.url))} ↗</a></p>`).join('')}</section>`;
      } else {
        html += `<section class="panel txt">${head}<p class="say">${esc(its[0].body)}</p></section>`;
      }
    });
    html += `<section class="panel end">${i < people.length - 1
      ? '<button type="button" class="next-btn" data-next>Next person →</button>'
      : '<p class="say">That\'s everyone.</p><button type="button" class="btn" data-x>Back to the archive</button>'}
      ${i ? '<button type="button" class="link" data-prev>← Previous person</button>' : ''}</section>`;
    return html;
  }

  // Name roulette before each person.
  async function roll(i) {
    track.innerHTML = `
      <section class="panel picker">
        <p class="label">[${i ? 'Next up' : "Who's first?"}]</p>
        <p class="who-name" id="roll"></p>
      </section>`;
    const r = $('#roll', el);
    const names = people.map(p => p.name);
    if (!reducedMotion()) for (let k = 0; k < 16; k++) { r.textContent = names[(i + k) % names.length]; await sleep(50 + k * 10); }
    r.textContent = people[i].name;
    r.classList.add('landed');
    await sleep(800);
  }

  let cur = -1, busy = false, queued = null, chan = null;
  async function go(i, broadcast = true) {
    if (i < 0 || i >= people.length) return;
    if (busy) { queued = i; return; }
    busy = true;
    cur = i;
    if (broadcast && chan) chan.send({ type: 'broadcast', event: 'go', payload: { i } });
    $('#show-pos', el).textContent = `${i + 1} / ${people.length}`;
    for (const b of $$('[data-p]', el)) b.classList.toggle('on', Number(b.dataset.p) === i);
    await roll(i);
    track.innerHTML = panels(people[i], i);
    track.scrollLeft = 0;
    if (el.contains(document.activeElement) && document.activeElement.matches('[data-next], [data-prev]')) $('[data-x]', el).focus();
    hydrate(track);
    busy = false;
    if (queued !== null) { const q = queued; queued = null; if (q !== cur) go(q, false); }
  }

  // Together: whoever clicks moves everyone watching (Supabase Realtime broadcast).
  if (together) {
    chan = api.sb.channel(`show-${call.id}`, { config: { broadcast: { self: false } } });
    chan.on('broadcast', { event: 'go' }, ({ payload }) => { if (payload?.i !== cur) go(payload.i, false); }).subscribe();
  }

  function step(dir) {
    const ps = $$('.panel', track);
    const x = track.scrollLeft, left = p => p.offsetLeft - ps[0].offsetLeft;
    const atEnd = x + track.clientWidth >= track.scrollWidth - 4;
    const target = dir > 0 ? (atEnd ? null : ps.find(p => left(p) > x + 20)) : [...ps].reverse().find(p => left(p) < x - 20);
    if (target) track.scrollTo({ left: left(target), behavior: reducedMotion() ? 'auto' : 'smooth' });
    else if (dir > 0 && !busy) go(cur + 1);
    else if (dir < 0 && !busy && x <= 0) go(cur - 1);
  }
  const onKey = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };
  function close() {
    el.remove();
    release();
    document.body.classList.remove('noscroll');
    document.removeEventListener('keydown', onKey);
    if (chan) api.sb.removeChannel(chan);
  }
  document.addEventListener('keydown', onKey);
  track.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { track.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  el.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) close();
    else if (e.target.closest('[data-next]')) go(cur + 1);
    else if (e.target.closest('[data-prev]')) go(cur - 1);
    else if (e.target.closest('[data-p]')) go(Number(e.target.closest('[data-p]').dataset.p));
  });
  const release = trapFocus(el);
  $('[data-x]', el).focus();
  go(0, false);
}

window.addEventListener('hashchange', route);
api.sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { state.session = null; route(); } });
boot();
