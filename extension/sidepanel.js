// State
let entries = [];
let inlineEditingId = null;
let showAllEntries = false;
let selectedIds = new Set();
let savedClientNames = [];

// DOM Elements
const dateInput = document.getElementById('date-input');
const clientInput = document.getElementById('client-input');
const timeInput = document.getElementById('time-input');
const taskInput = document.getElementById('task-input');
const submitBtn = document.getElementById('submit-btn');
const toggleBtn = document.getElementById('toggle-btn');
const newWindowBtn = document.getElementById('new-window-btn');
const closeBtn = document.getElementById('close-btn');
const entriesList = document.getElementById('entries-list');
const entriesLabel = document.getElementById('entries-label');
const headerStats = document.getElementById('header-stats');

// Status elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Selection elements
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const selectedCount = document.getElementById('selected-count');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');

function setStatus(type, message) {
  statusDot.className = '';
  if (type === 'connected') {
    statusDot.classList.add('connected');
  } else if (type === 'error') {
    statusDot.classList.add('error');
  } else if (type === 'saving') {
    statusDot.classList.add('saving');
  }
  statusText.textContent = message;
}

// Utility: get today's date in Eastern time (YYYY-MM-DD)
function getTodayEastern() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Utility: escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// API Functions
async function fetchEntries() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/time-entries`);
    if (response.ok) {
      entries = await response.json();
      setStatus('connected', `Connected — ${entries.length} entries`);
    } else {
      setStatus('error', 'Server error — data may not be saved');
    }
  } catch (error) {
    console.error('Failed to fetch entries:', error);
    setStatus('error', 'Cannot reach server — check config.js URL');
  }
  render();
}

async function fetchClientNames() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/client-names`);
    if (response.ok) {
      savedClientNames = await response.json();
    }
  } catch (error) {
    console.error('Failed to fetch client names:', error);
  }
}

async function saveClientName(name) {
  if (!name || !name.trim()) return;
  try {
    await fetch(`${API_BASE_URL}/api/client-names`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    await fetchClientNames();
  } catch (error) {
    console.error('Failed to save client name:', error);
  }
}

async function createEntry(entry) {
  setStatus('saving', 'Saving...');
  try {
    const response = await fetch(`${API_BASE_URL}/api/time-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    if (response.ok) {
      const newEntry = await response.json();
      entries.unshift(newEntry);
      saveClientName(entry.client);
      setStatus('connected', 'Saved');
    } else {
      setStatus('error', 'Failed to save — server error');
    }
  } catch (error) {
    console.error('Failed to create entry:', error);
    setStatus('error', 'Failed to save — cannot reach server');
  }
  render();
}

async function updateEntry(id, data) {
  setStatus('saving', 'Saving...');
  try {
    const response = await fetch(`${API_BASE_URL}/api/time-entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      const updated = await response.json();
      entries = entries.map(e => e.id === id ? updated : e);
      setStatus('connected', 'Updated');
    } else {
      setStatus('error', 'Failed to update — server error');
    }
  } catch (error) {
    console.error('Failed to update entry:', error);
    setStatus('error', 'Failed to update — cannot reach server');
  }
  render();
}

async function deleteEntry(id) {
  setStatus('saving', 'Deleting...');
  try {
    const response = await fetch(`${API_BASE_URL}/api/time-entries/${id}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      entries = entries.filter(e => e.id !== id);
      selectedIds.delete(id);
      setStatus('connected', 'Deleted');
    } else {
      setStatus('error', 'Failed to delete — server error');
    }
  } catch (error) {
    console.error('Failed to delete entry:', error);
    setStatus('error', 'Failed to delete — cannot reach server');
  }
  render();
}

async function deleteSelectedEntries() {
  if (selectedIds.size === 0) return;

  const idsToDelete = [...selectedIds];
  const total = idsToDelete.length;
  let deleted = 0;
  let failed = 0;

  setStatus('saving', `Deleting ${total} entries...`);

  for (const id of idsToDelete) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/time-entries/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        entries = entries.filter(e => e.id !== id);
        selectedIds.delete(id);
        deleted++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('Failed to delete entry:', id, error);
      failed++;
    }
  }

  if (failed === 0) {
    setStatus('connected', `Deleted ${deleted} entries`);
  } else {
    setStatus('error', `Deleted ${deleted}, failed ${failed}`);
  }

  render();
}

function updateSelectionUI() {
  const displayEntries = showAllEntries ? entries : entries.filter(e => e.date === getTodayEastern());
  const allIds = displayEntries.map(e => e.id);
  const selectedInView = allIds.filter(id => selectedIds.has(id)).length;

  selectedCount.textContent = `${selectedIds.size} selected`;
  deleteSelectedBtn.disabled = selectedIds.size === 0;
  selectAllCheckbox.checked = allIds.length > 0 && selectedInView === allIds.length;
  selectAllCheckbox.indeterminate = selectedInView > 0 && selectedInView < allIds.length;
}

function toggleSelectAll() {
  const displayEntries = showAllEntries ? entries : entries.filter(e => e.date === getTodayEastern());
  const allIds = displayEntries.map(e => e.id);
  const allSelected = allIds.every(id => selectedIds.has(id));

  if (allSelected) {
    allIds.forEach(id => selectedIds.delete(id));
  } else {
    allIds.forEach(id => selectedIds.add(id));
  }

  render();
}

function toggleEntrySelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  updateSelectionUI();
  const checkbox = document.querySelector(`.entry-checkbox[data-id="${id}"]`);
  if (checkbox) checkbox.checked = selectedIds.has(id);
}

// Inline editing
function openInlineEdit(entry) {
  closeInlineEdit();
  inlineEditingId = entry.id;

  const taskItem = document.querySelector(`.task-item[data-id="${entry.id}"]`);
  if (!taskItem) return;

  const taskRow = taskItem.querySelector('.task-row');
  taskRow.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'inline-edit-form';
  form.innerHTML = `
    <div class="inline-edit-row-top">
      <input type="date" class="inline-input inline-date" value="${escapeHtml(entry.date)}">
      <input type="text" class="inline-input inline-client" value="${escapeHtml(entry.client)}" placeholder="Client">
      <input type="number" class="inline-input inline-hours" step="0.25" value="${escapeHtml(String(entry.time))}" placeholder="Hours">
    </div>
    <input type="text" class="inline-input inline-task" value="${escapeHtml(entry.task)}" placeholder="Task">
    <div class="inline-edit-actions">
      <button class="inline-cancel-btn">Cancel</button>
      <button class="inline-save-btn">Save</button>
    </div>
  `;
  taskItem.appendChild(form);
  form.querySelector('.inline-task').focus();
}

function closeInlineEdit() {
  if (inlineEditingId === null) return;

  const taskItem = document.querySelector(`.task-item[data-id="${inlineEditingId}"]`);
  if (taskItem) {
    const form = taskItem.querySelector('.inline-edit-form');
    if (form) form.remove();
    const taskRow = taskItem.querySelector('.task-row');
    if (taskRow) taskRow.style.display = '';
  }

  inlineEditingId = null;
}

function handleInlineSave(id) {
  const taskItem = document.querySelector(`.task-item[data-id="${id}"]`);
  if (!taskItem) return;

  const form = taskItem.querySelector('.inline-edit-form');
  if (!form) return;

  const data = {
    date: form.querySelector('.inline-date').value,
    client: form.querySelector('.inline-client').value.trim(),
    time: form.querySelector('.inline-hours').value,
    task: form.querySelector('.inline-task').value.trim()
  };

  if (!data.client || !data.time || !data.task) return;

  inlineEditingId = null;
  updateEntry(id, data);
}

// Form submission
function handleSubmit() {
  const data = {
    date: dateInput.value,
    client: clientInput.value,
    time: timeInput.value,
    task: taskInput.value
  };

  if (!data.client || !data.time || !data.task) return;

  createEntry({ ...data, id: Date.now() });
  resetForm();
}

function resetForm() {
  dateInput.value = getTodayEastern();
  clientInput.value = '';
  timeInput.value = '';
  taskInput.value = '';
}

// Group entries by date, then by client
function groupByDateAndClient(entriesToGroup) {
  const grouped = {};
  entriesToGroup.forEach(entry => {
    const dateKey = entry.date;
    const clientKey = entry.client.trim().toLowerCase();
    if (!grouped[dateKey]) grouped[dateKey] = {};
    if (!grouped[dateKey][clientKey]) {
      grouped[dateKey][clientKey] = { displayName: entry.client.trim(), entries: [] };
    }
    grouped[dateKey][clientKey].entries.push(entry);
  });
  return grouped;
}

// Client autocomplete
const clientSuggestions = document.getElementById('client-suggestions');

function getUniqueClients() {
  const seen = {};
  savedClientNames.forEach(name => {
    const key = name.trim().toLowerCase();
    if (!seen[key]) seen[key] = name.trim();
  });
  entries.forEach(e => {
    const key = e.client.trim().toLowerCase();
    if (!seen[key]) seen[key] = e.client.trim();
  });
  return Object.values(seen).sort();
}

function showSuggestions() {
  const typed = clientInput.value.trim().toLowerCase();
  if (!typed) { clientSuggestions.style.display = 'none'; return; }
  const matches = getUniqueClients().filter(c => c.toLowerCase().includes(typed));
  if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === typed)) {
    clientSuggestions.style.display = 'none'; return;
  }
  clientSuggestions.innerHTML = matches.map(c => `<div class="suggestion-item">${escapeHtml(c)}</div>`).join('');
  clientSuggestions.style.display = 'block';
}

function hideSuggestions() {
  setTimeout(() => { clientSuggestions.style.display = 'none'; }, 150);
}

clientInput.addEventListener('input', showSuggestions);
clientInput.addEventListener('focus', showSuggestions);
clientInput.addEventListener('blur', hideSuggestions);
clientSuggestions.addEventListener('click', (e) => {
  if (e.target.classList.contains('suggestion-item')) {
    clientInput.value = e.target.textContent;
    clientSuggestions.style.display = 'none';
    timeInput.focus();
  }
});

// Render function
function render() {
  inlineEditingId = null;

  const todayString = getTodayEastern();
  const todayEntries = entries.filter(e => e.date === todayString);
  const todayTotal = todayEntries.reduce((sum, e) => sum + parseFloat(e.time || 0), 0);
  const allEntriesTotal = entries.reduce((sum, e) => sum + parseFloat(e.time || 0), 0);

  const displayEntries = showAllEntries ? entries : todayEntries;

  // Header stats
  let statsText = `Today: ${todayTotal.toFixed(2)}h`;
  if (showAllEntries) statsText += ` \u2022 Total: ${allEntriesTotal.toFixed(2)}h`;
  headerStats.textContent = statsText;

  // Labels and buttons
  entriesLabel.textContent = showAllEntries ? 'All Entries' : "Today's Entries";
  toggleBtn.textContent = showAllEntries ? 'Show Today' : 'View All';

  // Selection toolbar only in View All mode
  const selectionToolbar = document.getElementById('selection-toolbar');
  selectionToolbar.style.display = showAllEntries ? 'flex' : 'none';
  if (showAllEntries) updateSelectionUI();

  // Render entries
  if (displayEntries.length === 0) {
    entriesList.innerHTML = `<div class="empty-state">No entries for ${showAllEntries ? 'any date' : 'today'}</div>`;
    return;
  }

  const grouped = groupByDateAndClient(displayEntries);
  const dates = Object.keys(grouped).sort().reverse();
  let html = '';

  dates.forEach(date => {
    const clients = grouped[date];

    let dayTotal = 0;
    Object.keys(clients).forEach(clientKey => {
      clients[clientKey].entries.forEach(e => { dayTotal += parseFloat(e.time || 0); });
    });

    if (showAllEntries) {
      html += `<div class="date-section">`;
      html += `<div class="date-heading"><span>${escapeHtml(date)}</span><span class="date-total">${dayTotal.toFixed(2)}h</span></div>`;
    }

    Object.keys(clients).forEach(clientKey => {
      const { displayName, entries: clientEntries } = clients[clientKey];
      const clientTotal = clientEntries.reduce((sum, e) => sum + parseFloat(e.time || 0), 0);

      html += `<div class="client-group">`;
      html += `<div class="client-group-header">`;
      html += `<span class="client-group-name">${escapeHtml(displayName)}</span>`;
      html += `<span class="client-group-hours">${clientTotal.toFixed(2)}h</span>`;
      html += `</div>`;

      clientEntries.forEach(entry => {
        const isChecked = selectedIds.has(entry.id) ? 'checked' : '';
        html += `<div class="task-item" data-id="${entry.id}">`;
        html += `<div class="task-row${showAllEntries ? ' task-row-selectable' : ''}">`;
        if (showAllEntries) html += `<input type="checkbox" class="entry-checkbox" data-id="${entry.id}" ${isChecked}>`;
        html += `<span class="task-text">${escapeHtml(entry.task)}</span>`;
        html += `<div class="task-right">`;
        html += `<span class="task-hours-badge">${escapeHtml(String(entry.time))}h</span>`;
        html += `<button class="edit-btn" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += `<button class="delete-btn" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
      });

      html += `</div>`;
    });

    if (showAllEntries) html += `</div>`;
  });

  entriesList.innerHTML = html;
}

// Event Listeners
submitBtn.addEventListener('click', handleSubmit);

toggleBtn.addEventListener('click', () => {
  showAllEntries = !showAllEntries;
  selectedIds.clear();
  render();
});

newWindowBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
});

closeBtn.addEventListener('click', () => {
  window.close();
});

taskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSubmit();
});

// Event delegation for entry buttons and checkboxes
entriesList.addEventListener('click', (e) => {
  const target = e.target;

  if (target.classList.contains('inline-save-btn')) {
    const taskItem = target.closest('.task-item');
    if (taskItem) handleInlineSave(parseInt(taskItem.dataset.id));
    return;
  }
  if (target.classList.contains('inline-cancel-btn')) {
    closeInlineEdit();
    return;
  }

  const taskItem = target.closest('.task-item');
  if (!taskItem) return;

  const id = parseInt(taskItem.dataset.id);
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  if (target.classList.contains('entry-checkbox')) {
    toggleEntrySelection(id);
  } else if (target.classList.contains('edit-btn')) {
    openInlineEdit(entry);
  } else if (target.classList.contains('delete-btn')) {
    deleteEntry(id);
  }
});

selectAllCheckbox.addEventListener('change', toggleSelectAll);

deleteSelectedBtn.addEventListener('click', () => {
  if (selectedIds.size === 0) return;
  if (confirm(`Are you sure you want to delete ${selectedIds.size} entries?`)) {
    deleteSelectedEntries();
  }
});

// Initialize
dateInput.value = getTodayEastern();
fetchClientNames();
fetchEntries();
