#!/usr/bin/env node
// Verzegelt een map met inhoud tot data/card.bin, of haalt die er weer uit.
// Geen afhankelijkheden; Node 20 of nieuwer.
//
//   node tools/kaart.mjs new   <geheim.json> <basis-url>
//   node tools/kaart.mjs seal  <geheim.json> <bronmap> [data/card.bin]
//   node tools/kaart.mjs open  <geheim.json> <doelmap> [data/card.bin]
//   node tools/kaart.mjs check <geheim.json> [data/card.bin]
//
// geheim.json = { "url": "https://…/#<sleutel>", "password": "…" }
// Dat bestand en de bronmap horen NIET in deze repository.

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  seal, open, pack, unpack, fromBase64Url, toBase64Url, normalizePassword, DEFAULT_ITERATIONS,
} from '../assets/vault.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'card.bin');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.txt': 'text/plain', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function readSecret(file) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    fail(`kan ${file} niet lezen`);
  }
  const fragment = String(raw.url || '').split('#')[1];
  if (!fragment) fail('in geheim.json ontbreekt de sleutel achter de # in "url"');
  const secret = fromBase64Url(fragment);
  if (secret.length < 16) fail('de sleutel in de link is te kort');
  if (!raw.password || !normalizePassword(raw.password)) fail('in geheim.json ontbreekt "password"');
  return { secret, password: raw.password, url: raw.url };
}

async function walk(dir, prefix = '') {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if ((await stat(full)).isDirectory()) out.push(...await walk(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

// Elke verwijzing naar een bestand moet in de bundel zitten; anders zou de
// browser het bij de server gaan opvragen.
function lint(meta, files) {
  const have = new Set(files.map((f) => f.path));
  const text = (p) => new TextDecoder().decode(files.find((f) => f.path === p).data);
  const external = /^(https?:|mailto:|tel:|data:|blob:|#)/i;
  const problems = [];
  const need = (ref, where) => {
    if (!ref || external.test(ref)) return;
    if (!have.has(ref.replace(/^\.\//, ''))) problems.push(`${where}: ${ref}`);
  };
  for (const p of [meta.markup, ...(meta.styles || []), ...(meta.scripts || [])]) {
    if (!have.has(p)) problems.push(`kaart.json verwijst naar ontbrekend bestand: ${p}`);
  }
  if (have.has(meta.markup)) {
    const markup = text(meta.markup);
    for (const m of markup.matchAll(/\s(?:src|poster|data-src)\s*=\s*["']([^"']*)["']/g)) need(m[1], meta.markup);
    for (const m of markup.matchAll(/\ssrcset\s*=\s*["']([^"']*)["']/g)) {
      for (const part of m[1].split(',')) need(part.trim().split(/\s+/)[0], meta.markup);
    }
  }
  for (const p of meta.styles || []) {
    if (!have.has(p)) continue;
    for (const m of text(p).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) need(m[1], p);
  }
  return problems;
}

async function cmdNew(file, baseUrl) {
  if (!file || !baseUrl) fail('gebruik: new <geheim.json> <basis-url>');
  const secret = webcrypto.getRandomValues(new Uint8Array(32));
  const url = `${baseUrl.replace(/#.*$/, '')}#${toBase64Url(secret)}`;
  await writeFile(file, `${JSON.stringify({ url, password: '' }, null, 2)}\n`, { flag: 'wx' })
    .catch(() => fail(`${file} bestaat al; die overschrijf ik niet`));
  console.log(`✓ nieuwe sleutel in ${file} — vul nog een wachtwoord in`);
}

async function cmdSeal(secretFile, srcDir, outFile = DEFAULT_OUT) {
  if (!secretFile || !srcDir) fail('gebruik: seal <geheim.json> <bronmap> [uitvoer]');
  const { secret, password } = await readSecret(secretFile);
  const meta = JSON.parse(await readFile(path.join(srcDir, 'kaart.json'), 'utf8'));
  const files = [];
  for (const f of await walk(srcDir)) {
    if (f.rel === 'kaart.json') continue;
    const type = TYPES[path.extname(f.rel).toLowerCase()];
    if (!type) fail(`onbekend bestandstype: ${f.rel}`);
    files.push({ path: f.rel, type, data: new Uint8Array(await readFile(f.full)) });
  }
  const problems = lint(meta, files);
  if (problems.length) fail(`verwijzingen zonder bestand:\n  ${problems.join('\n  ')}`);

  const bundle = pack(files, meta);
  const sealed = await seal(webcrypto, bundle, secret, password, DEFAULT_ITERATIONS);

  // Meteen terug openen: wat we wegschrijven moet aantoonbaar te openen zijn.
  const again = await open(webcrypto, sealed, secret, password);
  if (again.length !== bundle.length || again.some((b, i) => b !== bundle[i])) fail('controle na verzegelen mislukt');

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, sealed);
  const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
  console.log(`✓ ${files.length} bestanden, ${kb(bundle.length)} → ${path.relative(process.cwd(), outFile)} (${kb(sealed.length)})`);
}

async function cmdOpen(secretFile, outDir, inFile = DEFAULT_OUT) {
  if (!secretFile || !outDir) fail('gebruik: open <geheim.json> <doelmap> [invoer]');
  const { secret, password } = await readSecret(secretFile);
  const plain = await open(webcrypto, new Uint8Array(await readFile(inFile)), secret, password)
    .catch(() => fail('sleutel of wachtwoord klopt niet'));
  const bundle = unpack(plain);
  const { files, v, ...meta } = bundle.manifest;
  for (const f of files) {
    const target = path.join(outDir, f.path);
    if (!path.resolve(target).startsWith(path.resolve(outDir) + path.sep)) fail(`onveilig pad in bundel: ${f.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bundle.bytes(f.path));
  }
  await writeFile(path.join(outDir, 'kaart.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`✓ ${files.length} bestanden uitgepakt in ${outDir}`);
}

async function cmdCheck(secretFile, inFile = DEFAULT_OUT) {
  if (!secretFile) fail('gebruik: check <geheim.json> [invoer]');
  const { secret, password } = await readSecret(secretFile);
  const plain = await open(webcrypto, new Uint8Array(await readFile(inFile)), secret, password)
    .catch(() => fail('sleutel of wachtwoord klopt niet'));
  const { manifest } = unpack(plain);
  console.log(`✓ te openen; ${manifest.files.length} bestanden, ${(plain.length / 1024).toFixed(0)} kB`);
}

const [command, ...args] = process.argv.slice(2);
const commands = { new: cmdNew, seal: cmdSeal, open: cmdOpen, check: cmdCheck };
if (!commands[command]) fail('gebruik: kaart.mjs new | seal | open | check  (zie de kop van dit bestand)');
await commands[command](...args);
