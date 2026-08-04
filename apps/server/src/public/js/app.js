let currentFilter = 'all';
let cachedSources = [];
let enableToastAlerts = true;

function formatDate(dateStr) {
  if (!dateStr) return 'Pending';
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const past = new Date(dateStr);
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
}

function notify(message) {
  if (!enableToastAlerts) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

function updateCountdowns() {
  const now = new Date().getTime();
  cachedSources.forEach(s => {
    const timerEl = document.getElementById('countdown-' + s.id);
    if (!timerEl) return;

    if (s.status === 'paused') {
      timerEl.innerHTML = '<span class="status-paused">PAUSED</span>';
      return;
    }

    const intervalMs = (s.checkIntervalSec || 300) * 1000;
    const lastCheck = s.lastSuccessAt ? new Date(s.lastSuccessAt).getTime() : now;
    const nextCheck = lastCheck + intervalMs;
    const diffSec = Math.floor((nextCheck - now) / 1000);

    if (diffSec <= 0) {
      timerEl.innerHTML = '<span style="color: #38bdf8; font-weight: bold;">⚡ Checking now...</span>';
    } else {
      const min = Math.floor(diffSec / 60);
      const sec = diffSec % 60;
      const minStr = min < 10 ? '0' + min : min;
      const secStr = sec < 10 ? '0' + sec : sec;
      timerEl.innerHTML = `⏳ <b>${minStr}m ${secStr}s</b>`;
    }
  });
}

setInterval(updateCountdowns, 1000);

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  if (tabName === 'inbox') {
    document.getElementById('inbox-tab').classList.add('active');
    event.target.classList.add('active');
    fetchEvents();
    populateFeedFilters();
  } else if (tabName === 'sources') {
    document.getElementById('sources-tab').classList.add('active');
    event.target.classList.add('active');
    fetchSources();
    fetchCategories();
  } else if (tabName === 'settings') {
    document.getElementById('settings-tab').classList.add('active');
    event.target.classList.add('active');
    fetchSettings();
  }
}

async function populateFeedFilters() {
  const catRes = await fetch('/api/categories');
  const categories = await catRes.json();
  const catSelect = document.getElementById('feed-category-filter');
  if (Array.isArray(categories)) {
    catSelect.innerHTML = '<option value="all">All Categories</option>' + 
      categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  const srcRes = await fetch('/api/sources');
  const sources = await srcRes.json();
  const srcSelect = document.getElementById('feed-source-filter');
  if (Array.isArray(sources)) {
    srcSelect.innerHTML = '<option value="all">All Sources</option>' + 
      sources.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }
}

function filterEvents(folder) {
  currentFilter = folder;
  document.querySelectorAll('.folder-btn').forEach(btn => btn.classList.remove('active-folder'));
  const activeBtn = document.getElementById('folder-' + folder);
  if (activeBtn) activeBtn.classList.add('active-folder');
  fetchEvents();
}

async function fetchEvents() {
  const search = document.getElementById('search-input').value;
  const categoryId = document.getElementById('feed-category-filter')?.value || 'all';
  const sourceId = document.getElementById('feed-source-filter')?.value || 'all';
  const sort = document.getElementById('feed-sort')?.value || 'newest';

  const url = `/api/events?status=${currentFilter}&search=${encodeURIComponent(search)}&categoryId=${categoryId}&sourceId=${sourceId}&sort=${sort}`;
  const res = await fetch(url);
  const events = await res.json();

  const listEl = document.getElementById('events-list');
  if (!Array.isArray(events) || events.length === 0) {
    listEl.innerHTML = '<p style="color: #94a3b8; padding: 2rem 0; text-align: center;">No items inside this folder view.</p>';
    return;
  }

  listEl.innerHTML = events.map(ev => `
    <div class="event-card">
      <span class="badge">${ev.source ? ev.source.name : 'SOURCE'}</span>
      <h3 style="margin: 0.5rem 0;">
        <a href="${ev.directLink}" target="_blank" class="event-title-link">${ev.title} ↗</a>
      </h3>
      <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">${ev.description || ev.originalContent}</p>
      <div style="color: #64748b; font-size: 0.8rem;">
        Published: ${formatDate(ev.publishedAt)} <span style="color: #38bdf8; margin-left: 6px; font-weight: 500;">(${timeAgo(ev.publishedAt)})</span>
      </div>
      
      <div class="actions">
        <button class="btn ${ev.isStarred ? 'btn-warning' : ''}" onclick="toggleEvent('${ev.id}', { isStarred: !${ev.isStarred} })">${ev.isStarred ? '★ Starred' : '☆ Star'}</button>
        <button class="btn ${ev.isRead ? 'btn-success' : ''}" onclick="toggleEvent('${ev.id}', { isRead: !${ev.isRead} })">${ev.isRead ? '✓ Read' : '✉ Mark Read'}</button>
        <button class="btn" onclick="toggleEvent('${ev.id}', { isArchived: !${ev.isArchived} })">${ev.isArchived ? '📂 Unarchive' : '📦 Archive'}</button>
        <a href="${ev.directLink}" target="_blank" class="btn btn-primary" style="text-decoration: none; display: inline-block;">🔗 Read Full Article ↗</a>
      </div>
    </div>
  `).join('');
}

async function toggleEvent(id, payload) {
  await fetch('/api/events/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  notify('Item moved / state updated.');
  fetchEvents();
}

async function fetchSources() {
  const res = await fetch('/api/sources');
  cachedSources = await res.json();

  const bodyEl = document.getElementById('sources-body');
  if (!Array.isArray(cachedSources) || cachedSources.length === 0) {
    bodyEl.innerHTML = '<tr><td colspan="6">No sources added yet. Use the form above to add your first source!</td></tr>';
    return;
  }

  bodyEl.innerHTML = cachedSources.map(s => {
    const badgeClass = (s.type === 'auto' || !s.type) ? 'badge-auto' : 'badge';
    const displayType = (s.type === 'auto' || !s.type) ? 'AUTO-DETECT' : s.type.toUpperCase();
    const statusClass = s.status === 'active' ? 'status-active' : s.status === 'paused' ? 'status-paused' : 'status-error';

    return `
      <tr>
        <td><strong>${s.name}</strong><br><small style="color: #94a3b8;">${s.url}</small></td>
        <td><span class="${badgeClass}">${displayType}</span></td>
        <td><span id="countdown-${s.id}">Calculating...</span></td>
        <td class="${statusClass}">${s.status.toUpperCase()}</td>
        <td>${formatDate(s.lastSuccessAt)}</td>
        <td>
          <button class="btn" onclick="triggerSource('${s.id}')">Fetch Now</button>
          <button class="${s.status === 'active' ? 'btn btn-warning' : 'btn btn-success'}" onclick="toggleSourceStatus('${s.id}', '${s.status}')">${s.status === 'active' ? '⏸️ Pause' : '▶️ Activate'}</button>
          <button class="btn" onclick="editSource('${s.id}')">✏️ Edit</button>
          <button class="btn btn-danger" onclick="deleteSource('${s.id}')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  updateCountdowns();
}

async function toggleSourceStatus(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'paused' : 'active';
  await fetch('/api/sources/' + id + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  notify('Source status changed to: ' + newStatus.toUpperCase());
  fetchSources();
}

async function fetchCategories() {
  const res = await fetch('/api/categories');
  const categories = await res.json();
  const selectEl = document.getElementById('source-category');
  
  let html = '<option value="">Select Category...</option>';
  if (Array.isArray(categories)) {
    html += categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  html += '<option value="__NEW__">➕ Add Custom New Category...</option>';
  selectEl.innerHTML = html;
}

function handleCategoryChange(select) {
  const customGroup = document.getElementById('custom-category-group');
  customGroup.style.display = select.value === '__NEW__' ? 'block' : 'none';
}

async function handleSourceSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('edit-source-id').value;
  const name = document.getElementById('source-name').value;
  const url = document.getElementById('source-url').value;
  const type = document.getElementById('source-type').value || 'auto';
  const min = parseInt(document.getElementById('source-min').value) || 0;
  const sec = parseInt(document.getElementById('source-sec').value) || 0;
  const checkIntervalSec = (min * 60) + sec;
  let categoryId = document.getElementById('source-category').value;

  if (categoryId === '__NEW__') {
    const customName = document.getElementById('custom-category-name').value;
    if (!customName) return notify('Please enter custom category name.');
    const catRes = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: customName })
    });
    const newCat = await catRes.json();
    categoryId = newCat.id;
  }

  const method = editId ? 'PUT' : 'POST';
  const endpoint = editId ? '/api/sources/' + editId : '/api/sources';

  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url, type, categoryId, checkIntervalSec })
  });

  if (res.ok) {
    notify(editId ? 'Source updated successfully!' : 'Source added successfully!');
    resetForm();
    fetchSources();
    fetchCategories();
  } else {
    notify('Failed to save source.');
  }
}

function editSource(id) {
  const source = cachedSources.find(s => s.id === id);
  if (!source) return;

  document.getElementById('edit-source-id').value = source.id;
  document.getElementById('source-name').value = source.name;
  document.getElementById('source-url').value = source.url;
  document.getElementById('source-type').value = source.type || 'auto';
  
  const totalSec = source.checkIntervalSec || 300;
  document.getElementById('source-min').value = Math.floor(totalSec / 60);
  document.getElementById('source-sec').value = totalSec % 60;
  
  if (source.categoryId) {
    document.getElementById('source-category').value = source.categoryId;
  }

  document.getElementById('form-title').innerText = '✏️ Edit Source: ' + source.name;
  document.getElementById('submit-btn').innerText = 'Save Source Changes';
  document.getElementById('cancel-btn').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('edit-source-id').value = '';
  document.getElementById('source-name').value = '';
  document.getElementById('source-url').value = '';
  document.getElementById('source-min').value = 5;
  document.getElementById('source-sec').value = 0;
  document.getElementById('custom-category-group').style.display = 'none';
  document.getElementById('form-title').innerText = '➕ Add New Source';
  document.getElementById('submit-btn').innerText = '+ Add Source & Start Auto-Fetching';
  document.getElementById('cancel-btn').style.display = 'none';
}

async function deleteSource(id) {
  if (!confirm('Are you sure you want to delete this source? All associated event logs will be removed.')) return;
  const res = await fetch('/api/sources/' + id, { method: 'DELETE' });
  if (res.ok) {
    notify('Source deleted!');
    fetchSources();
  } else {
    notify('Failed to delete source.');
  }
}

async function triggerSource(id) {
  await fetch('/api/sources/' + id + '/trigger', { method: 'POST' });
  notify('Fetch job triggered!');
  fetchSources();
  fetchEvents();
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  const settings = await res.json();

  document.getElementById('telegram-enabled').checked = settings.telegramEnabled;
  document.getElementById('telegram-chat-id').value = settings.telegramChatId || '';
  document.getElementById('email-enabled').checked = settings.emailEnabled;
  document.getElementById('recipient-email').value = settings.recipientEmail || '';
  document.getElementById('notify-empty').checked = settings.notifyWhenEmpty || false;
  document.getElementById('dedup-enabled').checked = settings.deduplicationEnabled ?? true;
  document.getElementById('toast-enabled').checked = settings.showToastAlerts ?? true;

  enableToastAlerts = settings.showToastAlerts ?? true;
}

async function saveSettings(e) {
  e.preventDefault();
  const telegramEnabled = document.getElementById('telegram-enabled').checked;
  const telegramChatId = document.getElementById('telegram-chat-id').value;
  const emailEnabled = document.getElementById('email-enabled').checked;
  const recipientEmail = document.getElementById('recipient-email').value;
  const notifyWhenEmpty = document.getElementById('notify-empty').checked;
  const deduplicationEnabled = document.getElementById('dedup-enabled').checked;
  const showToastAlerts = document.getElementById('toast-enabled').checked;

  enableToastAlerts = showToastAlerts;

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramEnabled, telegramChatId, emailEnabled, recipientEmail, notifyWhenEmpty, deduplicationEnabled, showToastAlerts })
  });

  if (res.ok) {
    notify('Settings saved successfully!');
  } else {
    notify('Failed to save settings.');
  }
}

// Initial Load
fetchEvents();
populateFeedFilters();