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

const state = { users: [], messages: [] };
let chatWin = null;
let apiReachable = false;

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
    let dragging = false; let dx = 0; let dy = 0;
    icon.addEventListener('pointerdown', (e) => {
      dragging = true;
      dx = e.clientX - icon.offsetLeft;
      dy = e.clientY - icon.offsetTop;
      icon.setPointerCapture(e.pointerId);
      icon.style.cursor = 'grabbing';
    });
    icon.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      icon.style.left = `${Math.max(0, e.clientX - dx)}px`;
      icon.style.top = `${Math.max(0, e.clientY - dy)}px`;
    });
    icon.addEventListener('pointerup', (e) => {
      dragging = false;
      icon.releasePointerCapture(e.pointerId);
      icon.style.cursor = 'grab';
    });

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

function applyOfflineDemo() {
  state.users = ['visiteur', 'frutibot'];
  state.messages = [
    { time: new Date().toISOString(), user: 'system', text: 'Mode démo local: API indisponible.' },
    { time: new Date().toISOString(), user: 'frutibot', text: 'L’interface reste utilisable même hors connexion.' },
  ];
  renderUsers();
  renderMessages();
}

async function fetchState() {
  const badge = document.getElementById('statusBadge');
  try {
    const res = await fetch('/api/app/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.users = data.users || [];
    state.messages = data.messages || [];
    renderUsers();
    renderMessages();

    apiReachable = true;
    badge.textContent = `connecté · ${data.status?.external || 'online'}`;
  } catch (e) {
    if (!apiReachable) applyOfflineDemo();
    badge.textContent = 'hors-ligne · mode démo';
    console.warn('API /api/app/state inaccessible:', e.message);
  }
}

async function refreshShowcase() {
  try {
    const res = await fetch('/api/mvp/showcase');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    document.getElementById('username').textContent = data.modules?.feString?.includes('Frutiparc') ? 'frutibot' : 'visiteur';
    document.getElementById('stats').textContent = `build ${data.version} · ${new Date(data.generatedAt).toLocaleTimeString()}`;
  } catch (e) {
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
      body: JSON.stringify({ user: 'vous', text }),
    });

    if (res.ok) {
      input.value = '';
      await fetchState();
      return;
    }
  } catch (e) {
    console.warn('API /api/app/messages inaccessible:', e.message);
  }

  state.messages.push({ time: new Date().toISOString(), user: 'vous', text });
  input.value = '';
  renderMessages();
}

function connectRealtime() {
  const badge = document.getElementById('statusBadge');
  try {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${window.location.host}`);

    ws.addEventListener('open', () => {
      if (apiReachable) return;
      badge.textContent = 'connecté · websocket';
    });
    ws.addEventListener('close', () => {
      if (apiReachable) return;
      badge.textContent = 'hors-ligne · mode démo';
    });

    return ws;
  } catch (e) {
    badge.textContent = 'hors-ligne · mode démo';
    return null;
  }
}

function bindWindowInteractions(winBox) {
  const el = document.getElementById('chatWindow');
  const titleBar = document.getElementById('chatTitleBar');
  const minBtn = document.getElementById('minBtn');
  const closeBtn = document.getElementById('closeBtn');

  let dragging = false; let dx = 0; let dy = 0;
  titleBar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    dx = e.clientX - el.offsetLeft;
    dy = e.clientY - el.offsetTop;
    titleBar.setPointerCapture(e.pointerId);
    winBox.activate();
  });
  titleBar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    el.style.left = `${Math.max(0, e.clientX - dx)}px`;
    el.style.top = `${Math.max(70, e.clientY - dy)}px`;
  });
  titleBar.addEventListener('pointerup', (e) => {
    dragging = false;
    titleBar.releasePointerCapture(e.pointerId);
  });

  minBtn.addEventListener('click', () => { if (winBox.flShow) winBox.hide(); else winBox.show(); });
  closeBtn.addEventListener('click', () => winBox.close());
  el.addEventListener('pointerdown', () => winBox.activate());
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

  connectRealtime();
  refreshShowcase();
  fetchState();
  setInterval(fetchState, 5000);

  document.getElementById('refreshBtn').addEventListener('click', () => { refreshShowcase(); fetchState(); });
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
}

boot();
