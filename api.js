import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { processImage, extFor } from './image.js';

// Implicit flow: the magic link works even when opened on another device/browser.
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit', persistSession: true, detectSessionInUrl: true },
});

const BUCKET = 'media';
const ok = ({ data, error }) => { if (error) throw error; return data; };

// ── Auth ────────────────────────────────────────────────────────────────────
export const getSession = async () => (await sb.auth.getSession()).data.session;

export async function sendLink(email) {
  // Only members get an email. If the check itself fails (e.g. SQL not installed yet), go on.
  const { data: allowed, error } = await sb.rpc('is_allowed_email', { addr: email });
  if (!error && allowed === false) throw new Error('not-a-member');
  const redirect = location.origin + location.pathname;
  return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } }).then(ok);
}
export const verifyCode = (email, token) =>
  sb.auth.verifyOtp({ email, token, type: 'email' }).then(ok);
// Link in the email points to the site with a token_hash: we verify it only when the person
// taps "Log in", so mail scanners that pre-open links can't use it up.
export const verifyLink = (tokenHash, type = 'email') =>
  sb.auth.verifyOtp({ token_hash: tokenHash, type }).then(ok);
export const signOut = () => sb.auth.signOut();

// ── Reads ───────────────────────────────────────────────────────────────────
export const listMembers = () =>
  sb.from('members').select('email,name,is_admin,sort').order('sort').then(ok);

export const listCalls = () =>
  sb.from('calls').select('*').order('number', { ascending: false }).then(ok);

// RLS returns own rows + everyone's rows of revealed calls.
export const listSubmissions = (callId) => {
  let q = sb.from('submissions').select('*');
  if (callId) q = q.eq('call_id', callId);
  return q.then(ok);
};
export const listPhotos = (callId) => {
  let q = sb.from('photos').select('*').order('position').order('created_at');
  if (callId) q = q.eq('call_id', callId);
  return q.then(ok);
};
// Only my own rows: which calls I've started / submitted.
export const mySubmissions = (userId) =>
  sb.from('submissions').select('call_id,submitted_at').eq('user_id', userId).then(ok);
export const callProgress = (callId) => sb.rpc('call_progress', { cid: callId }).then(ok);

// ── Writes (members) ───────────────────────────────────────────────────────
export async function saveSubmission(callId, userId, fields) {
  const row = { call_id: callId, user_id: userId, ...fields, updated_at: new Date().toISOString() };
  return sb.from('submissions').upsert(row, { onConflict: 'call_id,user_id' }).select().single().then(ok);
}

async function uploadPair(callId, userId, file) {
  const img = await processImage(file);
  const id = crypto.randomUUID();
  const base = `${callId}/${userId}/${id}`;
  const path = `${base}-l.${extFor(img.large)}`;
  const thumb = `${base}-s.${extFor(img.thumb)}`;
  const store = sb.storage.from(BUCKET);
  ok(await store.upload(path, img.large, { contentType: img.large.type, cacheControl: '31536000' }));
  ok(await store.upload(thumb, img.thumb, { contentType: img.thumb.type, cacheControl: '31536000' }));
  return { path, thumb, w: img.w, h: img.h };
}

export async function uploadPhoto(callId, userId, questionId, file, position) {
  const media = await uploadPair(callId, userId, file);
  try {
    return await sb.from('photos').insert({ call_id: callId, question_id: questionId, ...media, position })
      .select().single().then(ok);
  } catch (e) {
    await removeFiles([media.path, media.thumb]);
    throw e;
  }
}

export const updatePhoto = (id, fields) =>
  sb.from('photos').update(fields).eq('id', id).then(ok);

export async function deletePhoto(photo) {
  ok(await sb.from('photos').delete().eq('id', photo.id));
  await removeFiles([photo.path, photo.thumb]);
}

export const removeFiles = (paths) =>
  sb.storage.from(BUCKET).remove(paths.filter(Boolean)).catch(() => {});

// ── Writes (admin) ──────────────────────────────────────────────────────────
export const saveCall = (call) =>
  (call.id
    ? sb.from('calls').update(call).eq('id', call.id)
    : sb.from('calls').insert(call)
  ).select().single().then(ok);
export const deleteCall = (id) => sb.from('calls').delete().eq('id', id).then(ok);

// ── Signed URLs (private bucket), cached per session ───────────────────────
const URL_TTL = 60 * 60 * 6;
const CACHE_KEY = 'mabusy:urls';
let urlCache = {};
try { urlCache = JSON.parse(sessionStorage.getItem(CACHE_KEY)) ?? {}; } catch {}

export async function signedUrls(paths) {
  const now = Date.now();
  const missing = [...new Set(paths.filter(p => p && !(urlCache[p]?.exp > now + 6e5)))];
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const data = ok(await sb.storage.from(BUCKET).createSignedUrls(chunk, URL_TTL));
    for (const d of data) if (d.signedUrl) urlCache[d.path] = { url: d.signedUrl, exp: now + URL_TTL * 1000 };
  }
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(urlCache)); } catch {}
  return Object.fromEntries(paths.map(p => [p, urlCache[p]?.url]));
}
