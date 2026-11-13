// Slotscherm: haalt de versleutelde bundel op, ontsleutelt hem in de browser
// en zet de inhoud op de pagina. Er gaat niets terug naar een server.

import { open, unpack, fromBase64Url, VaultError } from './vault.js';

const PAYLOAD = 'data/card.bin';

const html = document.documentElement;
const gate = document.getElementById('gate');
const form = document.getElementById('gate-form');
const input = document.getElementById('gate-input');
const button = document.getElementById('gate-button');
const label = button.querySelector('.button__label');
const note = document.getElementById('gate-note');
const stage = document.getElementById('stage');

const TEXT = {
  open: 'Openen',
  busy: 'Openen…',
  wrong: 'Dat is het niet. Probeer het nog eens.',
  offline: 'Laden lukt niet. Controleer je verbinding en probeer het opnieuw.',
  old: 'Deze browser kan de pagina niet openen. Probeer Safari of Chrome.',
};

// Het geheim staat achter de # en blijft daardoor in de browser.
function readSecret() {
  try {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return null;
    const bytes = fromBase64Url(decodeURIComponent(raw));
    return bytes.length >= 16 ? bytes : null;
  } catch {
    return null;
  }
}

function setProgress(fraction) {
  button.style.setProperty('--progress', String(Math.max(0, Math.min(1, fraction))));
}

async function fetchPayload() {
  const response = await fetch(PAYLOAD, { cache: 'no-cache' });
  if (!response.ok) throw new VaultError('network');
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) {
    const all = new Uint8Array(await response.arrayBuffer());
    setProgress(1);
    return all;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    setProgress(received / total);
  }
  const all = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  setProgress(1);
  return all;
}

// Het ophalen begint meteen, terwijl het wachtwoord nog getypt wordt.
let download = null;
function startDownload() {
  setProgress(0);
  download = fetchPayload();
  download.catch(() => {});
  return download;
}

function runScript(bytes) {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    el.onload = el.onerror = () => resolve();
    document.body.append(el);
  });
}

async function mount(bundle) {
  const { manifest } = bundle;

  // Beeld, lettertypen en geluid worden losse, lokale blob-adressen.
  const urls = new Map();
  for (const file of manifest.files) {
    if (/^(image|font|audio|video)\//.test(file.type)) {
      urls.set(file.path, URL.createObjectURL(new Blob([bundle.bytes(file.path)], { type: file.type })));
    }
  }
  const resolve = (ref) => urls.get(String(ref).replace(/^\.\//, ''));

  for (const path of manifest.styles || []) {
    const css = bundle.text(path).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, quote, ref) => {
      const url = resolve(ref);
      return url ? `url("${url}")` : all;
    });
    const el = document.createElement('style');
    el.textContent = css;
    document.head.append(el);
  }

  // Een <template> is inert: er wordt niets opgevraagd voordat de verwijzingen
  // zijn omgezet. Wat niet in de bundel zit, wordt weggehaald.
  const template = document.createElement('template');
  template.innerHTML = bundle.text(manifest.markup);
  for (const el of template.content.querySelectorAll('[src], [poster], [data-src]')) {
    for (const attr of ['src', 'poster', 'data-src']) {
      const ref = el.getAttribute(attr);
      if (ref === null) continue;
      const url = resolve(ref);
      if (url) el.setAttribute(attr, url);
      else el.removeAttribute(attr);
    }
  }

  for (const el of template.content.querySelectorAll('[srcset]')) {
    const candidates = el.getAttribute('srcset').split(',').map((part) => {
      const [ref, ...descriptors] = part.trim().split(/\s+/);
      const url = resolve(ref);
      return url ? [url, ...descriptors].join(' ') : null;
    }).filter(Boolean);
    if (candidates.length) el.setAttribute('srcset', candidates.join(', '));
    else el.removeAttribute('srcset');
  }

  stage.replaceChildren(template.content);
  if (manifest.title) document.title = manifest.title;
  stage.hidden = false;

  for (const path of manifest.scripts || []) await runScript(bundle.bytes(path));
}

function leaveGate() {
  html.dataset.state = 'open';
  input.blur();
  input.value = '';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    window.scrollTo(0, 0);
    gate.classList.add('is-leaving');
    window.setTimeout(() => {
      gate.remove();
      document.dispatchEvent(new CustomEvent('card:open'));
    }, reduce ? 0 : 620);
  }, reduce ? 0 : 420);
}

let working = false;

async function submit(event) {
  event.preventDefault();
  if (working) return;
  const password = input.value;
  if (!password.trim()) {
    input.focus();
    return;
  }

  working = true;
  html.dataset.state = 'busy';
  gate.classList.remove('is-wrong');
  note.textContent = '';
  label.textContent = TEXT.busy;

  try {
    let bytes;
    try {
      bytes = await download;
    } catch {
      bytes = await startDownload();
    }
    const plain = await open(crypto, bytes, secret, password);
    await mount(unpack(plain));
    leaveGate();
  } catch (error) {
    const wrong = error instanceof VaultError && error.code === 'key';
    html.dataset.state = 'locked';
    label.textContent = TEXT.open;
    note.textContent = wrong ? TEXT.wrong : TEXT.offline;
    if (wrong) {
      void gate.offsetWidth;
      gate.classList.add('is-wrong');
      input.select();
    }
    working = false;
  }
}

const secret = readSecret();

if (!secret) {
  html.dataset.state = 'nokey';
} else if (!window.crypto || !crypto.subtle) {
  html.dataset.state = 'locked';
  note.textContent = TEXT.old;
  button.disabled = true;
} else {
  html.dataset.state = 'locked';
  startDownload();
  form.addEventListener('submit', submit);
  input.addEventListener('input', () => {
    gate.classList.remove('is-wrong');
    if (!working) note.textContent = '';
  });
}
