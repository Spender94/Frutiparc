const core = window.FrutiparcCore || {};

function createFallbackCore() {
  class FallbackSlotList {
    addSlot(slot) { this.activeSlot = slot; slot.init(this, 0, true); }
    activate(slot) { this.activeSlot = slot; slot.onActivate?.(); }
    rmSlot() {}
  }
  class FallbackSlot {
    init(slotList) { this.slotList = slotList; }
    addBox(box) { box.init?.(this, 0); this.activeBox = box; }
    activate(box) { this.activeBox = box; box.onActivate?.(); }
    move() {}
    rmBox() {}
  }
  class FallbackWinBox {
    constructor() { this.flShow = true; this.flClosed = false; }
    init(slot) { this.slot = slot; }
    activate() { this.slot?.activate?.(this); }
    onActivate() {}
    onDeactivate() {}
    onSlotActivate() {}
    onSlotDeactivate() {}
    hide() { this.flShow = false; }
    show() { this.flShow = true; }
    close() { this.flClosed = true; }
  }
  return { SlotList: FallbackSlotList, Slot: FallbackSlot, WinBox: FallbackWinBox };
}

const { SlotList, Slot, WinBox } = core.SlotList && core.Slot && core.WinBox ? core : createFallbackCore();

const dockItems = [
  ['📁', 'Bureau'], ['🧑‍🤝‍🧑', 'Forum'], ['💬', 'Salons'], ['🕘', 'Historique'],
  ['⚙️', 'Préférences'], ['🧾', 'Scores'], ['🍉', 'Frutiblogs'], ['🫐', 'Club'],
];

const TEST_ACCOUNT = 'kasparov';
const FRUTIBOUILLE_KEY = 'frutiparc.frutibouille.v1';

const HOOD_BG = {
  blue: 'linear-gradient(#9dd5ff, #5c8ed5)',
  pink: 'linear-gradient(#ffc4dd, #d77ab1)',
  green: 'linear-gradient(#caf39a, #7bb850)',
  gold: 'linear-gradient(#ffe18d, #d6a33e)',
};

const FACE_EMOJI = { berry: '🫐', apple: '🍎', pear: '🍐' };
const EYES_EMOJI = { happy: '🙂', cool: '😎', wink: '😉' };

const state = { users: [], messages: [], profile: null };
let chatWin = null;

class ChatWindowBox extends WinBox {
  constructor(el) {
    super();
    this.el = el;
  }

  onActivate() {
    super.onActivate();
    this.el.style.zIndex = 20;
  }

  onDeactivate() {
    super.onDeactivate();
    this.el.style.zIndex = 5;
  }

  hide() {
    super.hide();
    this.el.classList.add('minimized');
  }

  show() {
    super.show();
    this.el.classList.remove('minimized');
  }

  close() {
    super.close();
    this.el.remove();
  }
}

function renderDock() {
  const dock = document.getElementById('dock');
  dock.innerHTML = dockItems.map(([ico, label]) => `<div class="dock-item"><div class="ico">${ico}</div><div>${label}</div></div>`).join('');
}

function attachDragHandlers(handle, target = handle, { minTop = 0 } = {}) {
  let dragging = false;
  let dx = 0;
  let dy = 0;

  const getPoint = (event) => {
    if (event.touches && event.touches[0]) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    return { x: event.clientX, y: event.clientY };
  };

  const onMove = (event) => {
    if (!dragging) return;
    const point = getPoint(event);
    target.style.left = `${Math.max(0, point.x - dx)}px`;
    target.style.top = `${Math.max(minTop, point.y - dy)}px`;
    if (event.cancelable) event.preventDefault();
  };

  const onUp = () => {
    dragging = false;
    target.style.cursor = 'grab';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };

  const onDown = (event) => {
    const point = getPoint(event);
    dragging = true;
    dx = point.x - target.offsetLeft;
    dy = point.y - target.offsetTop;
    target.style.cursor = 'grabbing';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };

  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: true });
}

function renderDesktopIcons() {
  const icons = [
    ['👩', 'lea21220', 16, 20], ['🐭', 'hiko', 95, 22], ['📁', 'Forum', 175, 22], ['🍓', 'Les salons', 255, 24],
    ['🍐', 'Mon historique', 335, 22], ['🪪', 'Préférences', 415, 23], ['🧾', 'Scores', 495, 25], ['🍉', 'Frutiblogs', 575, 23],
  ];
  const layer = document.getElementById('iconLayer');
  layer.innerHTML = icons.map(([ico, label, x, y], idx) => (
    `<div class="desktop-icon" data-id="${idx}" style="left:${x}px;top:${y}px"><div class="ico">${ico}</div><div class="label">${label}</div></div>`
  )).join('');

  layer.querySelectorAll('.desktop-icon').forEach((icon) => {
    attachDragHandlers(icon);
    icon.addEventListener('dblclick', () => {
      if (chatWin && !chatWin.flClosed) chatWin.activate();
    });
  });
}

function renderUsers() {
  const el = document.getElementById('userList');
  el.innerHTML = `<h4>Participants</h4>${state.users.map((u) => `<div class="user">${u}</div>`).join('')}`;
}

function hhmmss(iso) { if (!iso) return '--:--:--'; return new Date(iso).toTimeString().slice(0, 8); }

function renderMessages() {
  const el = document.getElementById('chatFeed');
  el.innerHTML = state.messages.map((m) => `<div class="msg"><span class="time">[${hhmmss(m.time)}]</span><strong>${m.user}</strong> ${m.text}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function getCurrentSelection() {
  return {
    hood: document.getElementById('hoodSelect').value,
    face: document.getElementById('faceSelect').value,
    eyes: document.getElementById('eyesSelect').value,
  };
}

function serializeFrutibouille(selection) {
  return `${selection.hood}:${selection.face}:${selection.eyes}`;
}

function renderFrutibouilleAvatar(selection) {
  const top = document.getElementById('topAvatar');
  const mine = document.getElementById('myAvatar');
  const preview = document.getElementById('frutibouillePreview');

  const text = `${FACE_EMOJI[selection.face] || '🫐'}${EYES_EMOJI[selection.eyes] || '🙂'}`;
  const bg = HOOD_BG[selection.hood] || HOOD_BG.blue;

  [top, mine, preview].forEach((el) => {
    if (!el) return;
    el.textContent = text;
    el.style.background = bg;
  });
}

function lockOnFrutibouilleCreation() {
  const overlay = document.getElementById('frutibouilleOverlay');
  const createBtn = document.getElementById('createFrutibouilleBtn');
  const hood = document.getElementById('hoodSelect');
  const face = document.getElementById('faceSelect');
  const eyes = document.getElementById('eyesSelect');

  if (!overlay || !createBtn || !hood || !face || !eyes) return;

  const updatePreview = () => renderFrutibouilleAvatar(getCurrentSelection());

  [hood, face, eyes].forEach((el) => {
    el.addEventListener('change', updatePreview);
  });

  createBtn.addEventListener('click', () => {
    const selection = getCurrentSelection();
    state.profile = {
      login: TEST_ACCOUNT,
      fbouille: serializeFrutibouille(selection),
      ...selection,
    };
    localStorage.setItem(FRUTIBOUILLE_KEY, JSON.stringify(state.profile));
    overlay.classList.add('hidden');
    renderFrutibouilleAvatar(selection);
    state.messages.unshift({ time: new Date().toISOString(), user: 'system', text: `Frutibouille créée pour ${TEST_ACCOUNT}.` });
    renderMessages();
  });

  updatePreview();
  overlay.classList.remove('hidden');
}

function restoreFrutibouilleIfExists() {
  try {
    const raw = localStorage.getItem(FRUTIBOUILLE_KEY);
    if (!raw) return false;
    const profile = JSON.parse(raw);
    if (!profile || !profile.hood || !profile.face || !profile.eyes) return false;

    state.profile = profile;
    renderFrutibouilleAvatar(profile);
    document.getElementById('frutibouilleOverlay')?.classList.add('hidden');
    return true;
  } catch (_e) {
    return false;
  }
}

function applyOfflineDemo() {
  state.users = [TEST_ACCOUNT, 'frutibot'];
  state.messages = [
    { time: new Date().toISOString(), user: 'system', text: 'Mode démo local: API indisponible.' },
    { time: new Date().toISOString(), user: 'frutibot', text: 'L’interface reste utilisable même hors connexion.' },
  ];
  renderUsers();
  renderMessages();
}

async function fetchState() {
  try {
    const res = await fetch('/api/app/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.users = data.users || [];
    state.messages = data.messages || [];
    renderUsers();
    renderMessages();

  } catch (e) {
    applyOfflineDemo();
    console.warn('API /api/app/state inaccessible:', e.message);
  }
}

async function refreshShowcase() {
  try {
    const res = await fetch('/api/mvp/showcase');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    document.getElementById('username').textContent = TEST_ACCOUNT;
    document.getElementById('stats').textContent = `build ${data.version} · ${new Date(data.generatedAt).toLocaleTimeString()}`;
  } catch (e) {
    document.getElementById('username').textContent = TEST_ACCOUNT;
    document.getElementById('stats').textContent = 'build démo locale';
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await fetch('/api/app/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: TEST_ACCOUNT, text }),
    });

    if (res.ok) {
      input.value = '';
      await fetchState();
      return;
    }
  } catch (e) {
    console.warn('API /api/app/messages inaccessible:', e.message);
  }

  state.messages.push({ time: new Date().toISOString(), user: TEST_ACCOUNT, text });
  input.value = '';
  renderMessages();
}

function forceConnectedAccount() {
  document.getElementById('username').textContent = TEST_ACCOUNT;
  document.getElementById('statusBadge').textContent = `compte test · ${TEST_ACCOUNT}`;
}

function bindWindowInteractions(winBox) {
  const el = document.getElementById('chatWindow');
  const titleBar = document.getElementById('chatTitleBar');
  const minBtn = document.getElementById('minBtn');
  const closeBtn = document.getElementById('closeBtn');

  attachDragHandlers(titleBar, el, { minTop: 70 });

  const activateIfNotTool = (e) => {
    if (e.target.closest && e.target.closest('button')) return;
    winBox.activate();
  };

  titleBar.addEventListener('mousedown', activateIfNotTool);
  titleBar.addEventListener('touchstart', activateIfNotTool, { passive: true });

  minBtn.addEventListener('click', () => { if (winBox.flShow) winBox.hide(); else winBox.show(); });
  closeBtn.addEventListener('click', () => winBox.close());
  el.addEventListener('click', () => winBox.activate());
}

function boot() {
  renderDock();
  renderDesktopIcons();

  const slotList = new SlotList();
  const slot = new Slot();
  slotList.addSlot(slot, true);

  chatWin = new ChatWindowBox(document.getElementById('chatWindow'));
  slot.addBox(chatWin);
  bindWindowInteractions(chatWin);

  forceConnectedAccount();
  refreshShowcase();
  fetchState();
  setInterval(fetchState, 5000);

  if (!restoreFrutibouilleIfExists()) {
    lockOnFrutibouilleCreation();
  }

  document.getElementById('refreshBtn').addEventListener('click', () => { refreshShowcase(); fetchState(); });
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
}

function safeBoot() {
  try {
    boot();
  } catch (error) {
    console.error('Boot error:', error);
    document.getElementById('frutibouilleOverlay')?.classList.remove('hidden');
  }
}

safeBoot();
