// Single-file frontend (HTML/CSS/JS as one template string, no build step)
// for the web UI: Chat / Notes / Ingest tabs calling the JSON API in index.ts.
export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>myworkjournal</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #171a21;
    --border: #2a2e37;
    --text: #e6e8eb;
    --muted: #9aa2af;
    --accent: #6ea8fe;
    --accent-text: #06121f;
    --danger: #ff6b6b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f6f8;
      --panel: #ffffff;
      --border: #e1e4e9;
      --text: #1b1f27;
      --muted: #5b6472;
      --accent: #2563eb;
      --accent-text: #ffffff;
      --danger: #d1373f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  header .stats { font-size: 12px; color: var(--muted); }
  nav {
    display: flex;
    gap: 4px;
    padding: 8px 20px 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  nav button {
    background: none;
    border: none;
    color: var(--muted);
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  nav button.active { color: var(--text); border-bottom-color: var(--accent); }
  main { flex: 1; overflow: hidden; display: flex; }
  .view { flex: 1; display: none; flex-direction: column; overflow: hidden; }
  .view.active { display: flex; }

  /* Chat */
  #chat-log { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .msg { max-width: 720px; }
  .msg .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 4px; }
  .msg.user { align-self: flex-end; }
  .msg.user .bubble { background: var(--accent); color: var(--accent-text); }
  .bubble { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
  .sources { margin-top: 6px; font-size: 12px; color: var(--muted); }
  .sources code { background: var(--panel); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  #chat-form { display: flex; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); flex-shrink: 0; }
  #chat-input {
    flex: 1; resize: none; border: 1px solid var(--border); border-radius: 8px;
    background: var(--panel); color: var(--text); padding: 10px 12px; font-size: 14px; font-family: inherit;
  }
  button.primary { background: var(--accent); color: var(--accent-text); border: none; border-radius: 8px; padding: 0 18px; font-size: 14px; cursor: pointer; font-weight: 600; }
  button.primary:disabled { opacity: 0.5; cursor: default; }
  button.ghost { background: none; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }

  /* Notes / ingest panels */
  .panel-body { flex: 1; overflow-y: auto; padding: 20px; max-width: 720px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
  .card-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .card .title { font-size: 14px; font-weight: 500; }
  .card .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .section-title { font-size: 13px; font-weight: 600; color: var(--muted); margin: 4px 0 10px; }
  input[type=text], textarea {
    width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
    color: var(--text); padding: 10px 12px; font-size: 14px; font-family: inherit; margin-bottom: 10px;
  }
  textarea { resize: vertical; min-height: 100px; }
  label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 4px; }
  .empty { color: var(--muted); font-size: 13px; padding: 20px 0; }
  .danger-btn { background: none; border: 1px solid var(--border); color: var(--danger); border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
  .row { display: flex; gap: 10px; }
  .row > * { flex: 1; }
  #ingest-result, #note-status { font-size: 13px; color: var(--muted); margin-top: 6px; white-space: pre-wrap; }
</style>
</head>
<body>

<header>
  <h1>myworkjournal</h1>
  <span class="stats" id="stats-line">loading…</span>
</header>

<nav>
  <button data-view="chat" class="active">Chat</button>
  <button data-view="notes">Notes</button>
  <button data-view="ingest">Ingest</button>
</nav>

<main>
  <section class="view active" id="view-chat">
    <div id="chat-log"></div>
    <form id="chat-form">
      <textarea id="chat-input" rows="1" placeholder="Ask your knowledge base…"></textarea>
      <button class="primary" type="submit" id="chat-send">Ask</button>
      <button class="ghost" type="button" id="chat-reset">Reset</button>
    </form>
  </section>

  <section class="view" id="view-notes">
    <div class="panel-body">
      <div class="card">
        <label for="note-title">Title</label>
        <input type="text" id="note-title" placeholder="Note title" />
        <label for="note-content">Content</label>
        <textarea id="note-content" placeholder="Write your note…"></textarea>
        <button class="primary" id="note-save">Save note</button>
        <div id="note-status"></div>
      </div>
      <h3 class="section-title">Quick notes you saved</h3>
      <div id="notes-list"></div>
    </div>
  </section>

  <section class="view" id="view-ingest">
    <div class="panel-body">
      <div class="card">
        <label for="ingest-path">Directory path (on this machine)</label>
        <input type="text" id="ingest-path" placeholder="/absolute/path/to/folder" />
        <label for="ingest-ext">Extensions</label>
        <input type="text" id="ingest-ext" value=".txt,.md,.rtf" />
        <button class="primary" id="ingest-run">Ingest</button>
        <div id="ingest-result"></div>
      </div>
    </div>
  </section>
</main>

<script>
const sessionId = 'web-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Nav ──────────────────────────────────────────────────────────────────
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'notes') loadNotes();
  });
});

// ── Stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/api/stats');
    document.getElementById('stats-line').textContent =
      s.documentCount + ' docs · ' + s.chunkCount + ' chunks';
  } catch {
    document.getElementById('stats-line').textContent = 'stats unavailable';
  }
}

// ── Chat ─────────────────────────────────────────────────────────────────
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

function addMessage(role, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = '<div class="role">' + role + '</div><div class="bubble">' + html + '</div>';
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  chatInput.value = '';
  addMessage('user', esc(question));
  chatSend.disabled = true;
  const thinking = addMessage('assistant', 'Thinking…');

  try {
    const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ question, sessionId }) });
    let html = esc(data.answer);
    if (data.sources && data.sources.length) {
      html += '<div class="sources">Sources: ' + data.sources.map(s =>
        '<code>' + esc(s.filePath.split('/').pop()) + '</code>'
      ).join(' ') + '</div>';
    }
    thinking.querySelector('.bubble').innerHTML = html;
  } catch (err) {
    thinking.querySelector('.bubble').textContent = 'Error: ' + err.message;
  } finally {
    chatSend.disabled = false;
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

document.getElementById('chat-reset').addEventListener('click', async () => {
  await api('/api/reset', { method: 'POST', body: JSON.stringify({ sessionId }) });
  chatLog.innerHTML = '';
});

// ── Notes ────────────────────────────────────────────────────────────────
async function loadNotes() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const notes = await api('/api/notes');
    if (!notes.length) { list.innerHTML = '<div class="empty">No notes yet.</div>'; return; }
    list.innerHTML = notes.map(n => \`
      <div class="card card-row">
        <div>
          <div class="title">\${esc(n.title)}</div>
          <div class="meta">\${new Date(n.modifiedAt).toLocaleString()}</div>
        </div>
        <button class="danger-btn" data-file="\${esc(n.fileName)}">Delete</button>
      </div>
    \`).join('');
    list.querySelectorAll('.danger-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this note?')) return;
        await api('/api/notes/' + encodeURIComponent(btn.dataset.file), { method: 'DELETE' });
        loadNotes();
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="empty">Failed to load notes: ' + esc(err.message) + '</div>';
  }
}

document.getElementById('note-save').addEventListener('click', async () => {
  const title = document.getElementById('note-title').value.trim();
  const content = document.getElementById('note-content').value.trim();
  const status = document.getElementById('note-status');
  if (!title || !content) { status.textContent = 'Title and content are required.'; return; }
  status.textContent = 'Saving…';
  try {
    await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content }) });
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    status.textContent = 'Saved.';
    loadNotes();
    loadStats();
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
});

// ── Ingest ───────────────────────────────────────────────────────────────
document.getElementById('ingest-run').addEventListener('click', async () => {
  const inputPath = document.getElementById('ingest-path').value.trim();
  const extensions = document.getElementById('ingest-ext').value.trim();
  const result = document.getElementById('ingest-result');
  if (!inputPath) { result.textContent = 'Path is required.'; return; }
  result.textContent = 'Ingesting… this can take a while for large folders.';
  try {
    const r = await api('/api/ingest', { method: 'POST', body: JSON.stringify({ path: inputPath, extensions }) });
    result.textContent = \`Done. total=\${r.total} ingested=\${r.ingested} skipped=\${r.skipped} failed=\${r.failed}\`;
    loadStats();
  } catch (err) {
    result.textContent = 'Error: ' + err.message;
  }
});

loadStats();
</script>
</body>
</html>
`;
