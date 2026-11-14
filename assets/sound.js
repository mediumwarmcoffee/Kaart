// Achtergrondmuziek, volledig in de browser opgewekt (Web Audio), zonder bestanden.
// Een ontspannen groove in majeur: zachte elektrische piano, bas, een spaarzame
// melodie en licht slagwerk. Een "scène" bepaalt tempo, toonhoogte en welke
// partijen meedoen; zo kan de inhoud de muziek laten meebewegen met het verhaal.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Acht maten van acht tellen (achtste noten). Getallen zijn halve tonen boven
// de grondtoon; null is een rust.
const ROOT = 62;
// [bastoon, akkoordtonen]: rijke, open akkoorden (6/9, groot septiem, sus) in
// plaats van kale drieklanken.
const SIX_NINE = [0, [4, 7, 9, 14]];
const MAJ_SEVEN = [5, [9, 12, 14, 16]];
const SUS = [7, [9, 12, 14, 17]];
const CHORDS = [SIX_NINE, SIX_NINE, MAJ_SEVEN, MAJ_SEVEN, SIX_NINE, SUS, MAJ_SEVEN, SUS];
const _ = null;
// Korte frases met lucht ertussen, net naast de tel.
const LEAD = [
  _, 16, _, 19, _, _, 21, _,
  19, _, _, _, _, _, _, _,
  _, 21, _, 24, _, _, 26, _,
  24, _, _, 21, _, 19, _, _,
  _, 16, _, 19, _, _, 21, _,
  24, _, _, 21, _, _, 19, _,
  _, 16, _, 14, _, _, 16, _,
  14, _, _, _, _, 12, 14, _,
];
const STEPS = 8;

// De scène van het slotscherm: alleen piano en bas, de melodie om en om.
export const LOBBY = {
  bpm: 84,
  transpose: 0,
  sparse: true,
  levels: { stabs: 0.5, bass: 0.55, lead: 0.4, bell: 0, perc: 0 },
};

const PARTS = ['stabs', 'bass', 'lead', 'bell', 'perc'];
const KEY = 'kaart:geluid';

export function createSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master, out, verb, noise;
  const bus = {};
  let scene = LOBBY;
  let step = 0;
  let nextStepAt = 0;
  let timer = null;
  let muted = false;
  try { muted = window.localStorage.getItem(KEY) === '0'; } catch { /* privémodus */ }
  const listeners = new Set();

  const state = () => ({ available: !!AC, muted, running: !!ctx && ctx.state === 'running' });
  const emit = () => listeners.forEach((fn) => fn(state()));

  function build() {
    ctx = new AC();
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -14;
    out.ratio.value = 3;
    out.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(out);

    // Een beetje ruimte, bewust kort: veel galm maakt het zwaarmoedig.
    const length = Math.floor(ctx.sampleRate * 1.4);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    verb = ctx.createConvolver();
    verb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    verb.connect(wet).connect(master);

    for (const name of [...PARTS, 'accent']) {
      const g = ctx.createGain();
      g.gain.value = name === 'accent' ? 0.5 : (scene.levels[name] || 0);
      g.connect(master);
      if (name !== 'bass' && name !== 'perc') g.connect(verb);
      bus[name] = g;
    }

    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = n;

    ctx.onstatechange = emit;
  }

  // Eén toon: lagen van [golfvorm, veelvoud van de toonhoogte, sterkte, uitsterftijd].
  function tone(note, when, level, layers, target) {
    const f = midi(note);
    for (const [type, ratio, amp, decay] of layers) {
      if (f * ratio > 10000) continue;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp * level, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(g).connect(target);
      osc.start(when);
      osc.stop(when + decay + 0.05);
    }
  }

  // Elektrische piano: rond, met een lange uitklank en een zacht tikje.
  const KEYS = [['sine', 1, 0.28, 1.5], ['sine', 2, 0.07, 0.8], ['sine', 6, 0.012, 0.1]];
  const KEYS_SHORT = [['sine', 1, 0.2, 0.6], ['sine', 2, 0.05, 0.3]];
  const BASS = [['sine', 1, 0.55, 0.55], ['triangle', 2, 0.16, 0.4]];
  // Melodie: vibrafoon-achtig, zingt even door.
  const VIBES = [['sine', 1, 0.42, 1.2], ['sine', 4, 0.06, 0.25], ['triangle', 1, 0.07, 0.5]];
  // Klokje met alleen heldere boventonen (octaaf en kwint), zonder de kleine terts
  // die echte klokken somber maakt.
  const BELL = [['sine', 1, 0.42, 1.6], ['sine', 2, 0.2, 1.0], ['sine', 3, 0.1, 0.6], ['sine', 4, 0.05, 0.35]];

  function shaker(when, level) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.16 * level, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    src.connect(hp).connect(g).connect(bus.perc);
    src.start(when, Math.random() * 0.8, 0.08);
  }

  function thump(when, level) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(60, when + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.36 * level, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    osc.connect(g).connect(bus.perc);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  // Een droog tikje op tel 2 en 4.
  function rim(when, level) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.5 * level, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(bp).connect(g).connect(bus.perc);
    src.start(when, Math.random() * 0.8, 0.07);
  }

  function playStep(i, when) {
    const bar = Math.floor(i / STEPS) % CHORDS.length;
    const beat = i % STEPS;
    const base = ROOT + (scene.transpose || 0);
    const [root, chord] = CHORDS[bar];

    // Piano en bas volgen hetzelfde 3-3-2-patroon: dat geeft de groove.
    if (beat === 0) for (const n of chord) tone(base + n, when, 1, KEYS, bus.stabs);
    if (beat === 3 || beat === 6) for (const n of chord) tone(base + n, when, 0.8, KEYS_SHORT, bus.stabs);
    if (beat === 0) tone(base + root - 12, when, 1, BASS, bus.bass);
    if (beat === 3) tone(base + root - 5, when, 0.7, BASS, bus.bass);
    if (beat === 6) tone(base + root - 12, when, 0.8, BASS, bus.bass);

    const note = LEAD[i % LEAD.length];
    if (note !== null && (!scene.sparse || Math.floor(bar / 2) % 2 === 0)) {
      tone(base + note, when, 0.9, VIBES, bus.lead);
      tone(base + note + 12, when, 0.9, BELL, bus.bell);
    }

    if (beat === 0 || beat === 5) thump(when, beat === 0 ? 1 : 0.7);
    if (beat === 2 || beat === 6) rim(when, 1);
    shaker(when, beat % 2 === 1 ? 0.8 : 0.4);
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (nextStepAt < now - 0.2) nextStepAt = now + 0.05;
    while (nextStepAt < now + 0.3) {
      playStep(step, nextStepAt);
      step++;
      nextStepAt += 60 / scene.bpm / 2;
    }
  }

  function applyScene(seconds) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const tc = Math.max(0.03, seconds / 3);
    for (const name of PARTS) bus[name].gain.setTargetAtTime(scene.levels[name] || 0, now, tc);
  }

  function setLevel(seconds) {
    if (!ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.62, ctx.currentTime, Math.max(0.03, seconds / 3));
  }

  // Mag alleen na een tik of toets: browsers laten geluid niet vanzelf starten.
  function start() {
    if (!AC || muted) return;
    if (!ctx) {
      // iPhone: zonder dit zwijgt Web Audio zodra de belschakelaar op stil staat.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* niet ondersteund */ }
      try { build(); } catch { ctx = null; return; }
      // Een leeg geluidje binnen de aanraking zelf maakt de uitvoer op iOS vrij.
      try {
        const blip = ctx.createBufferSource();
        blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        blip.connect(ctx.destination);
        blip.start(0);
      } catch { /* niet erg */ }
      nextStepAt = ctx.currentTime + 0.06;
      setLevel(0.5);
      timer = window.setInterval(tick, 80);
    }
    if (ctx.state !== 'running') ctx.resume().then(emit, () => {});
    emit();
  }

  function setScene(next, seconds = 2) {
    if (!next || typeof next.bpm !== 'number' || !next.levels) return;
    scene = {
      bpm: Math.max(60, Math.min(140, next.bpm)),
      transpose: Math.max(-12, Math.min(12, next.transpose || 0)),
      sparse: !!next.sparse,
      levels: next.levels,
    };
    applyScene(seconds);
  }

  // Een kort oplopend rijtje klokjes, los van de scène (bij het openen).
  function accent(notes, gap = 0.1) {
    if (!ctx || muted || ctx.state !== 'running' || !Array.isArray(notes)) return;
    let at = ctx.currentTime + 0.03;
    notes.slice(0, 12).forEach((note, i) => {
      tone(note, at, 0.7 + 0.3 * (i / notes.length), BELL, bus.accent);
      at += gap;
    });
  }

  function setMuted(value) {
    muted = !!value;
    try { window.localStorage.setItem(KEY, muted ? '0' : '1'); } catch { /* privémodus */ }
    if (!muted) start();
    setLevel(muted ? 0.4 : 1);
    emit();
  }

  // Niet doorspelen als de pagina uit beeld is.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (!muted) ctx.resume();
  });

  return {
    start,
    scene: setScene,
    accent,
    mute: setMuted,
    toggle: () => setMuted(!muted),
    state,
    onchange: (fn) => { listeners.add(fn); fn(state()); },
    // voor controles: het punt waar al het geluid samenkomt
    get tap() { return ctx ? { ctx, node: out } : null; },
  };
}
