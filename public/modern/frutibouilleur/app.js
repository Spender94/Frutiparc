const canvas = document.getElementById('avatar');
const ctx = canvas.getContext('2d');
const codeInput = document.getElementById('fbouilleCode');
const controlsRoot = document.getElementById('controls');
const presetsRoot = document.getElementById('presets');

const PARTS = [
  { key: 'hood', label: 'Capuche', max: 5 },
  { key: 'eyes', label: 'Yeux', max: 5 },
  { key: 'mouth', label: 'Bouche', max: 5 },
  { key: 'nose', label: 'Nez', max: 4 },
  { key: 'pattern', label: 'Motif', max: 5 },
  { key: 'accessory', label: 'Accessoire', max: 4 },
  { key: 'hoodShade', label: 'Teinte capuche', max: 5 },
  { key: 'skin', label: 'Peau', max: 5 },
  { key: 'outline', label: 'Contour', max: 4 },
];

const STATE = Object.fromEntries(PARTS.map((p) => [p.key, 0]));

const PRESETS = [
  { name: 'Classique', code: '000503000000111010' },
  { name: 'Classique 2', code: '000503000000111011' },
  { name: 'Classique 3', code: '000503000000111012' },
  { name: 'Capuche claire', code: '010503000000111010' },
  { name: 'Capuche foncée', code: '020503000000111010' },
  { name: 'Regard doux', code: '000403000000111010' },
];

function clamp(v, max) {
  return Math.max(0, Math.min(max, Number(v) || 0));
}

function toCode() {
  return PARTS.map((p) => String(STATE[p.key]).padStart(2, '0')).join('');
}

function fromCode(code) {
  if (!/^\d{18}$/.test(code)) return false;
  PARTS.forEach((p, i) => {
    const raw = Number(code.slice(i * 2, i * 2 + 2));
    STATE[p.key] = clamp(raw, p.max);
  });
  return true;
}

function hoodColor() {
  return ['#9cd65f', '#8acc52', '#78bb44', '#66a739', '#4e8b2e', '#3f7425'][STATE.hood];
}

function skinColor() {
  return ['#f7dfb3', '#f2d2a1', '#edc38e', '#dfa978', '#cd8e5f', '#b9764e'][STATE.skin];
}

function drawAvatar() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#d9f3b2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Capuche
  ctx.fillStyle = hoodColor();
  ctx.beginPath();
  ctx.ellipse(130, 130, 96, 102, 0, 0, Math.PI * 2);
  ctx.fill();

  // Visage
  ctx.fillStyle = skinColor();
  ctx.beginPath();
  ctx.ellipse(130, 134, 58, 66, 0, 0, Math.PI * 2);
  ctx.fill();

  // Motif capuche
  if (STATE.pattern > 0) {
    ctx.strokeStyle = ['#ffffff','#ffe48a','#ffb6b6','#c6b6ff','#8fd8ff','#f4f4f4'][STATE.pattern];
    ctx.lineWidth = 5;
    for (let i = 0; i < STATE.pattern + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(70 + i * 18, 62);
      ctx.lineTo(95 + i * 18, 92);
      ctx.stroke();
    }
  }

  // Yeux
  const eyeY = 124 - STATE.eyes;
  ctx.fillStyle = '#2b2b2b';
  const eyeSize = 4 + STATE.eyes;
  ctx.beginPath(); ctx.ellipse(108, eyeY, eyeSize, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(152, eyeY, eyeSize, 5, 0, 0, Math.PI * 2); ctx.fill();

  // Nez
  ctx.strokeStyle = '#a86f50';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(130, 132);
  ctx.lineTo(130 + (STATE.nose - 2) * 2, 142 + STATE.nose);
  ctx.stroke();

  // Bouche
  ctx.strokeStyle = '#8a3c48';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const smile = STATE.mouth - 2;
  ctx.arc(130, 158, 16, 0.2 * Math.PI, 0.8 * Math.PI, smile < 0);
  ctx.stroke();

  // Accessoire
  if (STATE.accessory > 0) {
    ctx.fillStyle = ['#fbd1ff', '#ffd07a', '#8fe6ff', '#ffffff', '#ff9ea6'][STATE.accessory];
    ctx.beginPath();
    ctx.roundRect(95, 84, 70, 12, 6);
    ctx.fill();
  }

  // Contour
  ctx.strokeStyle = ['#4d6126','#324018','#24300f','#1b250b','#101707'][STATE.outline];
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(130, 130, 96, 102, 0, 0, Math.PI * 2);
  ctx.stroke();

  codeInput.value = toCode();
}

function renderControls() {
  controlsRoot.innerHTML = '';
  PARTS.forEach((part) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'control';

    const label = document.createElement('label');
    label.textContent = `${part.label} (${part.max})`;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(part.max);
    input.value = String(STATE[part.key]);
    input.addEventListener('input', () => {
      STATE[part.key] = clamp(input.value, part.max);
      drawAvatar();
    });

    wrapper.append(label, input);
    controlsRoot.appendChild(wrapper);
  });
}

function renderPresets() {
  presetsRoot.innerHTML = '';
  PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.textContent = `${preset.name} · ${preset.code}`;
    btn.addEventListener('click', () => {
      fromCode(preset.code);
      renderControls();
      drawAvatar();
    });
    presetsRoot.appendChild(btn);
  });
}

codeInput.addEventListener('change', () => {
  if (fromCode(codeInput.value.trim())) {
    renderControls();
    drawAvatar();
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(codeInput.value);
});

document.getElementById('randomBtn').addEventListener('click', () => {
  PARTS.forEach((p) => { STATE[p.key] = Math.floor(Math.random() * (p.max + 1)); });
  renderControls();
  drawAvatar();
});

if (!fromCode(PRESETS[0].code)) {
  PARTS.forEach((p) => (STATE[p.key] = 0));
}
renderControls();
renderPresets();
drawAvatar();
