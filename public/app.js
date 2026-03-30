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
  users: ['dalmatien17', 'groingroin'],
  messages: [
    { time: '23:24:47', user: 'system', text: 'Vous discutez maintenant sur le salon prototype.' },
    { time: '23:24:52', user: 'groingroin', text: 'sifflote' },
  ],
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

function renderMessages() {
  const el = document.getElementById('chatFeed');
  el.innerHTML = state.messages
    .map((m) => `<div class="msg"><span class="time">[${m.time}]</span><strong>${m.user}</strong> ${m.text}</div>`)
    .join('');
  el.scrollTop = el.scrollHeight;
}

function now() {
  return new Date().toTimeString().slice(0, 8);
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  state.messages.push({ time: now(), user: 'vous', text });
  input.value = '';
  renderMessages();
}

async function refreshShowcase() {
  const badge = document.getElementById('statusBadge');
  badge.textContent = 'connexion…';
  try {
    const res = await fetch('/api/mvp/showcase');
    const data = await res.json();
    document.getElementById('username').textContent = data.modules?.feString?.includes('Frutiparc') ? 'frutibot' : 'visiteur';
    document.getElementById('stats').textContent = `build ${data.version} · ${new Date(data.generatedAt).toLocaleTimeString()}`;
    badge.textContent = 'connecté';
  } catch (e) {
    badge.textContent = `erreur API: ${e.message}`;
  }
}

function boot() {
  renderDock();
  renderUsers();
  renderMessages();
  refreshShowcase();

  document.getElementById('refreshBtn').addEventListener('click', refreshShowcase);
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

boot();
