// Demo backend: same interface as api.js, fake data kept in memory only.
// Open the site with ?demo to use it. Nothing is read from or written to Supabase.
export const isDemo = true;

const H = 3600e3;
const now = Date.now();
const ME = 'u-giampaolo';

const members = [
  { email: 'carla@demo', name: 'Carla', is_admin: false, sort: 1 },
  { email: 'clarice@demo', name: 'Clarice', is_admin: false, sort: 2 },
  { email: 'gauri@demo', name: 'Gauri', is_admin: false, sort: 3 },
  { email: 'xinyi@demo', name: 'Xinyi', is_admin: false, sort: 4 },
  { email: 'giampaolo@demo', name: 'Giampaolo', is_admin: true, sort: 5 },
];
const uid = m => `u-${m.name.toLowerCase()}`;

const Q1 = [
  { id: 'selfie', text: 'Selfie', type: 'photo', required: true, multiple: false },
  { id: 'window', text: 'The view from your window right now', type: 'photo', required: true, multiple: true },
  { id: 'where', text: 'Where are you right now, and what time is it there as you write this?', type: 'text', required: true, multiple: false },
  { id: 'weekday', text: 'What does a normal weekday look like for you these days?', type: 'text', required: false, multiple: false },
  { id: 'miss', text: 'One thing you miss from our MA days.', type: 'text', required: false, multiple: false },
  { id: 'rec', text: 'Recommend one thing: a song, a show, a book or a food.', type: 'link', required: false, multiple: true },
];

let calls = [
  { id: 902, number: 2, title: 'October', questions: Q1.map(q => ({ ...q })), is_open: true,
    reveal_at: new Date(now + 3 * 24 * H).toISOString(), created_at: new Date(now - 2 * 24 * H).toISOString() },
  // Unlocked 2 hours ago: it's "the day of the call", so the show prompt appears.
  { id: 901, number: 1, title: 'September', questions: Q1.map(q => ({ ...q })), is_open: false,
    reveal_at: new Date(now - 2 * H).toISOString(), created_at: new Date(now - 30 * 24 * H).toISOString() },
];

const content = {
  Carla: {
    where: 'Barcelona, 19:40. Balcony, finally some sun.',
    weekday: 'Studio 9 to 6, then volleyball on the beach twice a week. Trying to cook more.',
    miss: 'Late-night crits with too much coffee and nobody wanting to go home.',
    rec: [{ url: 'https://open.spotify.com/', label: 'Rosalía · new album on repeat' }],
    window: ['Rooftops of Gràcia', 'Sunset from the studio'],
  },
  Clarice: {
    where: 'Hong Kong, 01:40. Can\'t sleep, so here I am.',
    weekday: 'Freelance branding projects, lots of calls with Europe in the evening.',
    miss: 'Our Friday lunches at the canteen.',
    rec: [{ url: 'https://www.netflix.com/', label: 'The Bear, season 3' }, { url: 'https://www.goodreads.com/', label: 'Book: Tomorrow, and Tomorrow…' }],
    window: ['Harbour at night'],
  },
  Gauri: {
    where: 'Pune, 23:10. Monsoon just ended.',
    weekday: 'Teaching two design classes and working on my own illustration series.',
    miss: 'Walking back home all together after the studio closed.',
    rec: [{ url: 'https://www.youtube.com/', label: 'A documentary about Indian type design' }],
    window: ['After the rain', 'Street below'],
  },
  Xinyi: {
    where: 'Shanghai, 01:40. Just back from a gallery opening.',
    weekday: 'UX at a big tech company. Long days, but good team.',
    miss: 'The workshop smell and building models at 3am.',
    rec: [{ url: 'https://open.spotify.com/', label: 'Lo-fi playlist I work with' }],
    window: ['Skyline, very hazy today'],
  },
  Giampaolo: {
    where: 'Lecce, 19:40. Just finished work.',
    weekday: 'Design projects in the morning, coding side projects (like this one) in the evening.',
    miss: 'Everyone in the same room at the same time.',
    rec: [{ url: 'https://www.youtube.com/', label: 'A talk on archive design' }],
    window: ['Old town rooftops', 'Lemon tree in the courtyard'],
  },
};

const img = (seed, w, h) => ({
  path: `https://picsum.photos/seed/${seed}/${w}/${h}`,
  thumb: `https://picsum.photos/seed/${seed}/${Math.round(w / 2.5)}/${Math.round(h / 2.5)}`,
  w, h,
});

let subs = [];
let photos = [];
let pid = 0;
for (const m of members) {
  const c = content[m.name];
  subs.push({
    call_id: 901, user_id: uid(m), author_email: m.email,
    answers: { where: c.where, weekday: c.weekday, miss: c.miss, rec: c.rec },
    submitted_at: new Date(now - 26 * H).toISOString(), updated_at: new Date(now - 26 * H).toISOString(),
  });
  photos.push({ id: `p${pid++}`, call_id: 901, question_id: 'selfie', user_id: uid(m), author_email: m.email,
    ...img(`mabusy-${m.name}-selfie`, 600, 800), caption: '', position: 0 });
  c.window.forEach((cap, k) => photos.push({
    id: `p${pid++}`, call_id: 901, question_id: 'window', user_id: uid(m), author_email: m.email,
    ...img(`mabusy-${m.name}-window-${k}`, k % 2 ? 800 : 900, k % 2 ? 600 : 1100), caption: cap, position: k,
  }));
}
// Call 002 (open): Clarice submitted, Gauri has a draft, the others haven't started.
const clarice = members[1], gauri = members[2];
subs.push({ call_id: 902, user_id: uid(clarice), author_email: clarice.email, answers: { where: 'Hong Kong, again.' },
  submitted_at: new Date(now - 5 * H).toISOString(), updated_at: new Date(now - 5 * H).toISOString() });
photos.push({ id: `p${pid++}`, call_id: 902, question_id: 'selfie', user_id: uid(clarice), author_email: clarice.email,
  ...img('mabusy-Clarice-oct', 600, 800), caption: '', position: 0 });
subs.push({ call_id: 902, user_id: uid(gauri), author_email: gauri.email, answers: {},
  submitted_at: null, updated_at: new Date(now - H).toISOString() });

const revealed = id => new Date(calls.find(c => c.id === id)?.reveal_at) <= Date.now();
const visible = r => r.user_id === ME || revealed(r.call_id);
const accepting = id => { const c = calls.find(x => x.id === id); return c?.is_open && !revealed(id); };
const locked = () => { throw new Error('new row violates row-level security policy'); };
const later = v => new Promise(r => setTimeout(() => r(v), 120));

// ── Auth ──
export const sb = {
  auth: { onAuthStateChange() {} },
  channel() { const c = { on: () => c, subscribe: () => c, send() {} }; return c; },
  removeChannel() {},
};
export const getSession = async () => ({ user: { id: ME, email: 'giampaolo@demo' } });
export const sendLink = async () => {};
export const verifyCode = async () => {};
export const verifyLink = async () => {};
export const signOut = async () => { location.href = location.pathname; };

// ── Reads ──
export const listMembers = () => later(members.map(m => ({ ...m })));
export const listCalls = () => later([...calls].sort((a, b) => b.number - a.number).map(c => ({ ...c })));
export const listSubmissions = id => later(subs.filter(s => (!id || s.call_id === id) && visible(s)).map(s => ({ ...s })));
export const listPhotos = id => later(photos.filter(p => (!id || p.call_id === id) && visible(p))
  .sort((a, b) => a.position - b.position).map(p => ({ ...p })));
export const mySubmissions = () => later(subs.filter(s => s.user_id === ME).map(s => ({ call_id: s.call_id, submitted_at: s.submitted_at })));
export const callProgress = id => later(members.map(m => {
  const s = subs.find(x => x.call_id === id && x.author_email === m.email);
  const p = photos.some(x => x.call_id === id && x.author_email === m.email);
  return { name: m.name, started: !!s || p, ready: !!s?.submitted_at };
}));

// ── Writes ──
export async function saveSubmission(call_id, user_id, fields) {
  if (!accepting(call_id)) locked();
  const old = subs.find(s => s.call_id === call_id && s.user_id === user_id) || { submitted_at: null };
  subs = subs.filter(s => s !== old);
  const row = { ...old, call_id, user_id, author_email: 'giampaolo@demo', ...fields, updated_at: new Date().toISOString() };
  subs.push(row);
  return later({ ...row });
}
export async function uploadPhoto(call_id, user_id, question_id, file, position) {
  if (!accepting(call_id)) locked();
  const url = URL.createObjectURL(file);
  const size = await new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([4, 3]); i.src = url; });
  const p = { id: `n${pid++}`, call_id, question_id, user_id, author_email: 'giampaolo@demo',
    path: url, thumb: url, w: size[0], h: size[1], caption: '', position };
  photos.push(p);
  return later({ ...p });
}
export const updatePhoto = async (id, fields) => { Object.assign(photos.find(p => p.id === id) || {}, fields); };
export const deletePhoto = async p => { photos = photos.filter(x => x.id !== p.id); };
export const removeFiles = async () => {};
export async function saveCall(c) {
  if (calls.some(x => x.number === c.number && x.id !== c.id)) throw new Error('duplicate key value violates unique constraint "calls_number_key"');
  if (c.id) calls = calls.map(x => (x.id === c.id ? { ...x, ...c } : x));
  else calls.push({ ...c, id: Date.now(), created_at: new Date().toISOString() });
}
export async function deleteCall(id) { calls = calls.filter(c => c.id !== id); subs = subs.filter(s => s.call_id !== id); photos = photos.filter(p => p.call_id !== id); }

// Demo images are plain URLs: no signing needed.
export const signedUrls = async paths => Object.fromEntries(paths.map(p => [p, p]));
