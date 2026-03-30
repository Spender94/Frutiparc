const dockItems = [
  ['📁', 'Bureau'],
  ['🧑‍🤝‍🧑', 'Forum'],
  ['💬', 'Salons'],
  ['🕘', 'Historique'],
  ['⚙️', 'Préférences'],
  ['🧾', 'Scores'],
  ['🍉', 'Frutiblogs'],
  ['🫐', 'Club'],
];

const state = {
  users: [],
  messages: [],
};

function renderDock() {
  const dock = document.getElementById('dock');
  dock.innerHTML = dockItems.map(([ico, label]) => (
    `<div class="dock-item"><div class="ico">${ico}</div><div>${label}</div></div>`
  )).join('');
}

function renderUsers() {
  const el = document.getElementById('userList');
  el.innerHTML = `<h4>Participants</h4>${state.users.map((u) => `<div class="user">${u}</div>`).join('')}`;
}

function toHHMMSS(isoDate) {
  if (!isoDate) return '--:--:--';
  const d = new Date(isoDate);
  return d.toTimeString().slice(0, 8);
}

function renderMessages() {
  const el = document.getElementById('chatFeed');
  el.innerHTML = state.messages
    .map((m) => `<div class="msg"><span class="time">[${toHHMMSS(m.time)}]</span><strong>${m.user}</strong> ${m.text}</div>`)
    .join('');
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
  } catch (e) {
    badge.textContent = `erreur API: ${e.message}`;
  }
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

  const res = await fetch('/api/app/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'vous', text }),
  });

  if (res.ok) {
    input.value = '';
    await fetchState();
  }
}

function boot() {
  renderDock();
  refreshShowcase();
  fetchState();
  setInterval(fetchState, 5000);

  document.getElementById('refreshBtn').addEventListener('click', () => {
    refreshShowcase();
    fetchState();
  });
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

boot();
