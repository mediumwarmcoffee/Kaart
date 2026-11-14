// Een beetje feest op het slotscherm: losse snippers die langzaam dwarrelen,
// en een korte uitbarsting als het slot opengaat.

const COLORS = ['#c9402a', '#e9a79a', '#e7c36f', '#2f5d50', '#222222'];
const SHAPES = ['dot', 'chip', 'strip'];

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function piece() {
  const el = document.createElement('i');
  el.className = `bit bit--${pick(SHAPES)}`;
  el.style.setProperty('--c', pick(COLORS));
  return el;
}

// Rustig dwarrelen, achter de tekst.
export function drift(container, count = 16) {
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('span');
    wrap.className = 'bit-fall';
    const duration = rand(16, 30);
    wrap.style.setProperty('--x', `${rand(2, 98).toFixed(1)}%`);
    wrap.style.setProperty('--t', `${duration.toFixed(1)}s`);
    wrap.style.setProperty('--d', `${(-rand(0, duration)).toFixed(1)}s`);
    wrap.style.setProperty('--y', `${rand(4, 96).toFixed(1)}%`);
    const el = piece();
    el.style.setProperty('--sway', `${rand(14, 38).toFixed(0)}px`);
    el.style.setProperty('--st', `${rand(5, 9).toFixed(1)}s`);
    el.style.setProperty('--r', `${rand(-50, 50).toFixed(0)}deg`);
    wrap.append(el);
    container.append(wrap);
  }
}

// Kort en uitbundig, vanaf de knop.
export function burst(container, origin, count = 46) {
  if (reduce() || !origin || !container.animate) return;
  const box = container.getBoundingClientRect();
  const from = origin.getBoundingClientRect();
  const x = from.left + from.width / 2 - box.left;
  const y = from.top + from.height / 2 - box.top;
  for (let i = 0; i < count; i++) {
    const el = piece();
    el.classList.add('bit--burst');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    container.append(el);
    const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const reach = rand(90, 330);
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    const spin = rand(-540, 540);
    el.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) rotate(${(spin * 0.6).toFixed(0)}deg)`, opacity: 1, offset: 0.45, easing: 'ease-in' },
      { transform: `translate(calc(-50% + ${(dx * 1.15).toFixed(0)}px), calc(-50% + ${(dy + 260).toFixed(0)}px)) rotate(${spin.toFixed(0)}deg)`, opacity: 0 },
    ], { duration: rand(1100, 1700), easing: 'cubic-bezier(0.12, 0.7, 0.3, 1)', fill: 'forwards' });
  }
}
