// Zachte achtergrondmuziek, volledig in de browser opgewekt (Web Audio).
// Geen geluidsbestanden: een paar langzame akkoorden, wat galm en af en toe
// een klokje. Een "scène" beschrijft hoe het klinkt: akkoorden, helderheid,
// klokjes en eventueel een zacht doorlopend loopje.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// De scène van het slotscherm. Andere scènes komen uit de inhoud zelf.
export const LOBBY = {
  // alleen grote akkoorden: licht en open
  chords: [[50, 57, 64, 66], [55, 62, 66, 69], [57, 61, 64, 69], [54, 57, 62, 66]],
  chordSeconds: 10,
  pad: 0.5,
  cutoff: 1150,
  chime: { level: 0.14, every: 8, notes: [78, 81, 83, 86], phrase: 2 },
};

const KEY = 'kaart:geluid';
const VOICES = 4;

export function createSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master, padBus, padFilter, chimeBus, accentBus, arpBus, verb, out;
  let voices = [];
  let scene = LOBBY;
  let chordIndex = 0;
  let nextVoiceAt = 0;
  let voiceTurn = 0;
  let nextChimeAt = 0;
  let nextArpAt = 0;
  let arpStep = 0;
  let timer = null;
  let muted = false;
  try { muted = window.localStorage.getItem(KEY) === '0'; } catch { /* privémodus */ }
  const listeners = new Set();

  const state = () => ({ available: !!AC, muted, running: !!ctx && ctx.state === 'running' });
  const emit = () => listeners.forEach((fn) => fn(state()));

  function impulse(seconds) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // ruis die uitsterft en onderweg doffer wordt
        smooth += (Math.random() * 2 - 1 - smooth) * (0.55 - 0.45 * t);
        data[i] = smooth * Math.pow(1 - t, 2.6);
      }
    }
    return buffer;
  }

  function build() {
    ctx = new AC();
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -16;
    out.ratio.value = 3;
    out.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(out);

    verb = ctx.createConvolver();
    verb.buffer = impulse(5);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet).connect(master);

    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = scene.cutoff;
    padFilter.Q.value = 0.4;
    padBus = ctx.createGain();
    padBus.gain.value = scene.pad;
    padFilter.connect(padBus);
    padBus.connect(master);
    padBus.connect(verb);

    chimeBus = ctx.createGain();
    chimeBus.gain.value = scene.chime ? scene.chime.level : 0;
    const chimeDry = ctx.createGain();
    chimeDry.gain.value = 0.35;
    chimeBus.connect(chimeDry).connect(master);
    chimeBus.connect(verb);

    // Accenten (zoals bij het openen) hebben een eigen, vast volume.
    accentBus = ctx.createGain();
    accentBus.gain.value = 0.34;
    const accentDry = ctx.createGain();
    accentDry.gain.value = 0.4;
    accentBus.connect(accentDry).connect(master);
    accentBus.connect(verb);

    arpBus = ctx.createGain();
    arpBus.gain.value = scene.arp ? scene.arp.level : 0;
    const arpDry = ctx.createGain();
    arpDry.gain.value = 0.7;
    arpBus.connect(arpDry).connect(master);
    arpBus.connect(verb);

    // Het filter ademt heel langzaam mee.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const depth = ctx.createGain();
    depth.gain.value = 140;
    lfo.connect(depth).connect(padFilter.frequency);
    lfo.start();

    for (let i = 0; i < VOICES; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = [-0.5, 0.35, -0.15, 0.55][i];
        gain.connect(pan).connect(padFilter);
      } else {
        gain.connect(padFilter);
      }
      // Drie lagen per stem: de toon zelf, een octaaf erboven (anders blijft er
      // op een telefoonluidspreker weinig van over) en een dun, scherper laagje
      // waar het filter iets mee te doen heeft.
      const layers = [['triangle', 1, 0, 1], ['sine', 2, 7, 0.55], ['sawtooth', 1, -6, 0.2]];
      const oscs = layers.map(([type, ratio, detune, level]) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(gain);
        osc.start();
        return { osc, ratio };
      });
      voices.push({ oscs, gain });
    }

    ctx.onstatechange = emit;
  }

  // Eén stem tegelijk schuift naar het volgende akkoord, zodat het nooit stilvalt.
  // Met quick klinkt het nieuwe akkoord vrijwel meteen (start en scènewissel).
  function moveVoice(i, when, quick) {
    const chord = scene.chords[chordIndex % scene.chords.length];
    const freq = midi(chord[i % chord.length]);
    const v = voices[i];
    const fade = quick ? 0.25 : Math.min(3, scene.chordSeconds / 4);
    v.gain.gain.cancelScheduledValues(when);
    v.gain.gain.setTargetAtTime(0, when, fade / 4);
    for (const { osc, ratio } of v.oscs) osc.frequency.setValueAtTime(freq * ratio, when + fade);
    v.gain.gain.setTargetAtTime(0.15, when + fade, fade / 3);
  }

  // Een kort getokkeld toontje voor het loopje.
  function pluck(note, when, velocity) {
    const f = midi(note);
    for (const [type, ratio, amp] of [['triangle', 1, 1], ['sine', 2, 0.3]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(amp * velocity * 0.5, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
      osc.connect(gain).connect(arpBus);
      osc.start(when);
      osc.stop(when + 1.2);
    }
  }

  function chime(note, when, velocity, bus = chimeBus) {
    const f = midi(note);
    // Boventonen van een klokje: grondtoon, kleine terts, kwint, octaaf.
    const partials = [[0.5, 0.45, 5], [1, 1, 4.2], [1.2, 0.28, 2.4], [1.5, 0.18, 1.8], [2, 0.4, 2.6], [3, 0.1, 1.2]];
    for (const [ratio, amp, decay] of partials) {
      if (f * ratio > 9000) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(amp * velocity * 0.5, when + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(gain).connect(bus);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (now + 0.5 >= nextVoiceAt) {
      if (voiceTurn % VOICES === 0) chordIndex++;
      moveVoice(voiceTurn % VOICES, Math.max(now, nextVoiceAt));
      voiceTurn++;
      nextVoiceAt = Math.max(now, nextVoiceAt) + scene.chordSeconds / VOICES;
    }

    const a = scene.arp;
    if (a && a.level > 0) {
      if (nextArpAt < now) nextArpAt = now + 0.05;
      const chord = scene.chords[chordIndex % scene.chords.length];
      const order = [0, 1, 2, 3, 2, 1];
      while (nextArpAt < now + 0.5) {
        const note = chord[order[arpStep % order.length] % chord.length] + 12;
        pluck(note, nextArpAt, arpStep % order.length === 0 ? 1 : 0.7);
        arpStep++;
        nextArpAt += a.step;
      }
    }

    const c = scene.chime;
    if (c && c.level > 0 && now + 0.5 >= nextChimeAt) {
      let at = Math.max(now + 0.05, nextChimeAt);
      const count = 1 + Math.floor(Math.random() * (c.phrase || 1));
      let last = -1;
      for (let i = 0; i < count; i++) {
        let pick = Math.floor(Math.random() * c.notes.length);
        if (pick === last) pick = (pick + 1) % c.notes.length;
        last = pick;
        chime(c.notes[pick], at, 0.6 + Math.random() * 0.4);
        at += 0.5 + Math.random() * 0.9;
      }
      nextChimeAt = at + c.every * (0.6 + Math.random() * 0.8);
    }
  }

  function applyScene(seconds) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const tc = Math.max(0.05, seconds / 3);
    padBus.gain.setTargetAtTime(scene.pad, now, tc);
    padFilter.frequency.setTargetAtTime(scene.cutoff, now, tc);
    chimeBus.gain.setTargetAtTime(scene.chime ? scene.chime.level : 0, now, tc);
    arpBus.gain.setTargetAtTime(scene.arp ? scene.arp.level : 0, now, tc);
    if (seconds <= 3) {
      // Snelle wissel: alle stemmen meteen naar het nieuwe akkoord, zodat je de omslag hoort.
      chordIndex = 0;
      for (let i = 0; i < VOICES; i++) moveVoice(i, now + 0.05 + i * 0.12, true);
      voiceTurn = VOICES;
      nextVoiceAt = now + scene.chordSeconds;
    } else {
      nextVoiceAt = Math.min(nextVoiceAt, now + 0.2);
    }
    if (scene.chime) nextChimeAt = Math.min(nextChimeAt, now + 2 + Math.random() * 3);
  }

  function setLevel(seconds) {
    if (!ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, Math.max(0.05, seconds / 3));
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
      const now = ctx.currentTime;
      // Meteen hoorbaar: alle stemmen tegelijk erin en een eerste klokje.
      for (let i = 0; i < VOICES; i++) moveVoice(i, now + i * 0.08, true);
      voiceTurn = VOICES;
      nextVoiceAt = now + scene.chordSeconds;
      nextChimeAt = now + 1.2;
      setLevel(0.9);
      timer = window.setInterval(tick, 250);
    }
    if (ctx.state !== 'running') ctx.resume().then(emit, () => {});
    emit();
  }

  function setScene(next, seconds = 6) {
    if (!next || !Array.isArray(next.chords) || !next.chords.length) return;
    scene = { ...LOBBY, ...next };
    applyScene(seconds);
  }

  // Een kort oplopend rijtje klokjes, los van de scène.
  function accent(notes, gap = 0.12) {
    if (!ctx || muted || ctx.state !== 'running' || !Array.isArray(notes)) return;
    let at = ctx.currentTime + 0.03;
    notes.slice(0, 12).forEach((note, i) => {
      chime(note, at, 0.75 + 0.25 * (i / notes.length), accentBus);
      at += gap;
    });
  }

  function setMuted(value) {
    muted = !!value;
    try { window.localStorage.setItem(KEY, muted ? '0' : '1'); } catch { /* privémodus */ }
    if (!muted) start();
    setLevel(muted ? 0.6 : 2);
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
