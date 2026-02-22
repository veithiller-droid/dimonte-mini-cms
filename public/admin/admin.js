const els = {
  userInfo: document.getElementById('userInfo'),
  logoutBtn: document.getElementById('logoutBtn'),
  postForm: document.getElementById('postForm'),
  postId: document.getElementById('postId'),
  title: document.getElementById('title'),
  category: document.getElementById('category'),
  post_date: document.getElementById('post_date'),
  status: document.getElementById('status'),
  body: document.getElementById('body'),
  saveBtn: document.getElementById('saveBtn'),
  resetBtn: document.getElementById('resetBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  postsList: document.getElementById('postsList'),
  formTitle: document.getElementById('formTitle'),
  formMessage: document.getElementById('formMessage'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMessage(msg, isError = false) {
  els.formMessage.textContent = msg || '';
  els.formMessage.classList.toggle('error', !!isError);
  els.formMessage.classList.toggle('success', !isError && !!msg);
}

function resetForm() {
  els.postId.value = '';
  els.title.value = '';
  els.category.value = '';
  els.status.value = 'draft';
  els.body.value = '';
  els.formTitle.textContent = 'Neuer Eintrag';
  els.saveBtn.textContent = 'Speichern';
  setMessage('');
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  els.post_date.value = `${yyyy}-${mm}-${dd}`;
}

async function api(path, options = {}) {
  const r = await fetch(path, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    const msg = data.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function checkAuth() {
  try {
    const data = await api('/api/me');
    if (!data.authenticated) {
      window.location.href = '/admin/login.html';
      return false;
    }
    els.userInfo.textContent = `Eingeloggt: ${data.username}`;
    return true;
  } catch {
    window.location.href = '/admin/login.html';
    return false;
  }
}

function renderPosts(items) {
  if (!items || items.length === 0) {
    els.postsList.innerHTML = '<p class="muted">Noch keine Einträge.</p>';
    return;
  }

  els.postsList.innerHTML = items
    .map((item) => {
      const date = String(item.post_date).slice(0, 10);
      return `
        <article class="list-item" data-id="${item.id}">
          <div class="list-item-head">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="badge ${item.status === 'published' ? 'published' : 'draft'}">
              ${item.status}
            </span>
          </div>
          <div class="muted small">
            ${escapeHtml(item.category || '—')} · ${escapeHtml(date)}
          </div>
          <div class="list-item-actions">
            <button data-action="edit" data-id="${item.id}" class="btn-secondary">Bearbeiten</button>
            <button data-action="publish" data-id="${item.id}" class="btn-secondary">Publish</button>
            <button data-action="delete" data-id="${item.id}" class="btn-danger">Löschen</button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadPosts() {
  const data = await api('/api/posts');
  renderPosts(data.items || []);
}

async function loadPostIntoForm(id) {
  const data = await api(`/api/posts/${id}`);
  const p = data.item;

  els.postId.value = p.id;
  els.title.value = p.title || '';
  els.category.value = p.category || '';
  els.post_date.value = String(p.post_date).slice(0, 10);
  els.status.value = p.status || 'draft';
  els.body.value = p.body || '';

  els.formTitle.textContent = `Eintrag bearbeiten (#${p.id})`;
  els.saveBtn.textContent = 'Aktualisieren';
  setMessage('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function savePost(e) {
  e.preventDefault();
  setMessage('');

  const id = els.postId.value ? Number(els.postId.value) : null;

  const payload = {
    title: els.title.value.trim(),
    category: els.category.value.trim(),
    post_date: els.post_date.value,
    status: els.status.value,
    body: els.body.value.trim(),
  };

  try {
    if (!payload.title || !payload.post_date || !payload.body) {
      setMessage('Titel, Datum und Text sind Pflichtfelder.', true);
      return;
    }

    if (id) {
      await api(`/api/posts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setMessage('Eintrag aktualisiert.');
    } else {
      await api('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setMessage('Eintrag gespeichert.');
      resetForm();
    }

    await loadPosts();
  } catch (err) {
    setMessage(err.message || 'Fehler beim Speichern.', true);
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}
  window.location.href = '/admin/login.html';
}

els.postForm.addEventListener('submit', savePost);
els.resetBtn.addEventListener('click', resetForm);
els.reloadBtn.addEventListener('click', () => loadPosts().catch((e) => setMessage(e.message, true)));
els.logoutBtn.addEventListener('click', logout);

els.postsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);
  if (!Number.isInteger(id)) return;

  try {
    if (action === 'edit') {
      await loadPostIntoForm(id);
      return;
    }

    if (action === 'publish') {
      await api(`/api/posts/${id}/publish`, { method: 'POST' });
      setMessage(`Eintrag #${id} veröffentlicht.`);
      await loadPosts();
      return;
    }

    if (action === 'delete') {
      const ok = window.confirm(`Eintrag #${id} wirklich löschen?`);
      if (!ok) return;
      await api(`/api/posts/${id}`, { method: 'DELETE' });
      setMessage(`Eintrag #${id} gelöscht.`);
      if (Number(els.postId.value) === id) resetForm();
      await loadPosts();
    }
  } catch (err) {
    setMessage(err.message || 'Aktion fehlgeschlagen.', true);
  }
});

(async function init() {
  const ok = await checkAuth();
  if (!ok) return;
  resetForm();
  try {
    await loadPosts();
  } catch (e) {
    setMessage(e.message || 'Fehler beim Laden.', true);
  }
})();