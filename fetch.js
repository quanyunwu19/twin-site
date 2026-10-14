// OfficeTwin data access. Two modes, same call sites:
//   * lilac (serve.py): plain fetch, password gate is server-side.
//   * static hosting (GitHub Pages etc., window.OT_STATIC set by index.html): every page fragment and asset
//     is stored AES-256-GCM encrypted under an opaque file name; the key is derived from the password with
//     PBKDF2-SHA256 in the browser (tools/build_static.py produces the encrypted tree).
const STATIC = !!window.OT_STATIC;
let key = null, manifest = null;
const KEY_LS = 'ot-key';

export const isStatic = () => STATIC;
export const unlocked = () => !STATIC || !!key;

async function rawFetch(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (onProgress) onProgress(got, total); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf;
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));

async function decrypt(enc) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.subarray(0, 12) }, key, enc.subarray(12));
  return new Uint8Array(pt);
}
async function importRaw(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
async function loadManifest() {
  const m = await decrypt(await rawFetch('m.enc'));   // GCM tag fails => wrong password
  manifest = JSON.parse(new TextDecoder().decode(m));
}

/** Try the remembered key (localStorage, 30 days). Returns true when the site is usable. */
export async function tryRemembered() {
  if (!STATIC) return true;
  try {
    const rec = JSON.parse(localStorage.getItem(KEY_LS) || 'null');
    if (!rec || rec.exp < Date.now()) return false;
    key = await importRaw(unhex(rec.k)); await loadManifest(); return true;
  } catch (e) { key = null; manifest = null; try { localStorage.removeItem(KEY_LS); } catch (_) { /* ignore */ } return false; }
}

/** Derive the key from the password, verify it against the manifest; throws on a wrong password. */
export async function unlock(password, remember = true) {
  const auth = JSON.parse(new TextDecoder().decode(await rawFetch('auth.json')));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(auth.salt), iterations: auth.iter }, base, 256));
  key = await importRaw(raw);
  try { await loadManifest(); } catch (e) { key = null; manifest = null; throw new Error('wrong password'); }
  if (remember) { try { localStorage.setItem(KEY_LS, JSON.stringify({ k: hex(raw), exp: Date.now() + 30 * 86400e3 })); } catch (_) { /* ignore */ } }
}
export function lock() { key = null; manifest = null; try { localStorage.removeItem(KEY_LS); } catch (_) { /* ignore */ } }

/** Bytes of a site-relative URL ("assets/3d/x.bin", "pages/p0.zh.html"), decrypted in static mode. */
export async function otFetch(url, onProgress) {
  if (!STATIC) return rawFetch(url, onProgress);
  if (!key) throw new Error('locked');
  const e = manifest[url]; if (!e) throw new Error(`not in manifest: ${url}`);
  return decrypt(await rawFetch(e.f, onProgress));
}
export async function otText(url) { return new TextDecoder().decode(await otFetch(url)); }
export function sizeOf(url) { return STATIC && manifest && manifest[url] ? manifest[url].s : 0; }

const urls = {};
/** blob: URL for an image / video / pdf (cached). Plain mode returns the URL itself. */
export async function otURL(url, onProgress) {
  if (!STATIC) return url;
  if (urls[url]) return urls[url];
  const bytes = await otFetch(url, onProgress);
  return (urls[url] = URL.createObjectURL(new Blob([bytes], { type: manifest[url].t || 'application/octet-stream' })));
}
