// Downscales photos in the browser before upload: the original never leaves the device.
// Redrawing on a canvas also drops all EXIF metadata (GPS position included).

const LARGE = 1600;  // long side of the full view
const THUMB = 480;   // long side of grid thumbnails

let heicLib;
function loadHeic2any() {
  heicLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    s.onload = () => resolve(window.heic2any);
    s.onerror = () => reject(new Error('Could not load the HEIC converter'));
    document.head.append(s);
  });
  return heicLib;
}

function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

const isHeic = f => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

async function decode(file) {
  try {
    return await loadImg(file); // browsers apply EXIF orientation when decoding
  } catch {
    if (!isHeic(file)) throw new Error(`“${file.name}” is not an image we can read`);
    const heic2any = await loadHeic2any();
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return loadImg(Array.isArray(out) ? out[0] : out);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise(r => canvas.toBlob(r, type, quality));
}

async function render(img, maxSide, quality) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  let blob = await toBlob(c, 'image/webp', quality);
  // Older Safari can't encode WebP and silently returns PNG: fall back to JPEG.
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(c, 'image/jpeg', quality);
  return { blob, w, h };
}

export async function processImage(file) {
  const img = await decode(file);
  const large = await render(img, LARGE, 0.82);
  const thumb = await render(img, THUMB, 0.76);
  return { large: large.blob, thumb: thumb.blob, w: large.w, h: large.h };
}

export const extFor = blob => (blob.type === 'image/webp' ? 'webp' : 'jpg');
