const dockItems = [
  ['📁', 'Bureau'], ['🧑‍🤝‍🧑', 'Forum'], ['💬', 'Salons'], ['🕘', 'Historique'],
  ['⚙️', 'Préférences'], ['🧾', 'Scores'], ['🍉', 'Frutiblogs'], ['🫐', 'Club'],
];

class UISlotList {
  constructor() { this.arr = []; this.activeSlot = undefined; this.depth = -1; }
  addSlot(slot, flGo = false) { this.depth += 1; this.arr[this.depth] = slot; slot.init(this, this.depth, flGo); }
  rmSlot(slot) { const i = this.arr.indexOf(slot); if (i > -1) this.arr[i] = undefined; if (this.activeSlot === slot) this.activeSlot = undefined; }
  activate(slot) {
    if (!slot || this.activeSlot === slot || slot.flClose) return false;
    if (this.activeSlot) this.activeSlot.onDeactivate();
    this.activeSlot = slot;
    this.activeSlot.onActivate();
    return true;
  }
}

class UISlot {
  constructor() { this.arr = []; this.activeBox = null; this.flActive = false; this.flClose = false; }
  init(slotList, baseDepth, flGo = false) { this.slotList = slotList; this.baseDepth = baseDepth; if (flGo) this.slotList.activate(this); }
  addBox(box) { this.arr.push(box); box.init(this, this.arr.length - 1); this.activate(box); }
  rmBox(box) { const i = this.arr.indexOf(box); if (i > -1) this.arr.splice(i, 1); if (this.arr.length === 0) this.close(); }
  activate(box) {
    if (this.activeBox === box) return false;
    if (this.activeBox) this.activeBox.onDeactivate();
    this.activeBox = box;
    this.activeBox.onActivate();
    return true;
  }
  onActivate() { this.flActive = true; this.arr.forEach((b) => b.onSlotActivate()); }
  onDeactivate() { this.flActive = false; this.arr.forEach((b) => b.onSlotDeactivate()); }
  close() { this.flClose = true; this.slotList.rmSlot(this); }
}

class UIWinBox {
  constructor(el) {
    this.el = el;
    this.initialized = false;
    this.flShow = false;
    this.flActive = false;
    this.wasShow = false;
    this.flClosed = false;
  }
  init(slot, depth) { this.slot = slot; this.depth = depth; this.initialized = true; this.flShow = true; this.show(); return true; }
  close() { this.slot.rmBox(this); this.flClosed = true; this.el.remove(); }
  hide() { this.flShow = false; this.el.classList.add('minimized'); }
  show() { this.flShow = true; this.el.classList.remove('minimized'); }
  onActivate() { this.flActive = true; this.el.style.zIndex = 5; }
  onDeactivate() { this.flActive = false; this.el.style.zIndex = 2; }
  onSlotActivate() { if (this.wasShow) this.show(); this.wasShow = false; }
  onSlotDeactivate() { if (this.flShow) { this.wasShow = true; this.hide(); } else this.wasShow = false; }
  activate() { this.slot.activate(this); }
}

const state = { users: [], messages: [] };

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

async function fetchState() {
  const badge = document.getElementById('statusBadge');
  try {
    const res = await fetch('/api/app/state');
    const data = await res.json();
    state.users = data.users || [];
    state.messages = data.messages || [];
    renderUsers();
    renderMessages();
    badge.textContent = `connecté · ${data.status?.external || 'online'}`;
  } catch (e) { badge.textContent = `erreur API: ${e.message}`; }
}

async function refreshShowcase() {
  try {
    const res = await fetch('/api/mvp/showcase');
    const data = await res.json();
    document.getElementById('username').textContent = data.modules?.feString?.includes('Frutiparc') ? 'frutibot' : 'visiteur';
    document.getElementById('stats').textContent = `build ${data.version} · ${new Date(data.generatedAt).toLocaleTimeString()}`;
  } catch (e) {
    document.getElementById('stats').textContent = `build indisponible (${e.message})`;
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  const res = await fetch('/api/app/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'vous', text }) });
  if (res.ok) { input.value = ''; await fetchState(); }
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

  const slotList = new UISlotList();
  const slot = new UISlot();
  slotList.addSlot(slot, true);

  const winBox = new UIWinBox(document.getElementById('chatWindow'));
  slot.addBox(winBox);
  bindWindowInteractions(winBox);

  refreshShowcase();
  fetchState();
  setInterval(fetchState, 5000);

  document.getElementById('refreshBtn').addEventListener('click', () => { refreshShowcase(); fetchState(); });
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
}

boot();
