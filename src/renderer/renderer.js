'use strict';

const state = {
  tools: [],
  search: '',
  category: 'All',
  editingId: null,
};

const els = {};

function $(sel) {
  return document.querySelector(sel);
}

async function refresh() {
  state.tools = await window.launcher.list();
  renderCategories();
  renderTools();
}

function categories() {
  const set = new Set();
  for (const t of state.tools) if (t.category) set.add(t.category);
  return ['All', ...[...set].sort((a, b) => a.localeCompare(b))];
}

function renderCategories() {
  const wrap = els.categories;
  wrap.innerHTML = '';
  const cats = categories();
  // Hide the bar entirely if the user has no categories beyond "All".
  wrap.hidden = cats.length <= 1;
  if (!cats.includes(state.category)) state.category = 'All';
  for (const cat of cats) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (cat === state.category ? ' chip--active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.category = cat;
      renderCategories();
      renderTools();
    });
    wrap.appendChild(chip);
  }
}

function filteredTools() {
  const q = state.search.toLowerCase();
  return state.tools.filter((t) => {
    const matchesCat = state.category === 'All' || t.category === state.category;
    const matchesSearch =
      !q ||
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });
}

function renderTools() {
  const grid = els.grid;
  grid.innerHTML = '';
  const tools = filteredTools();
  els.empty.hidden = tools.length > 0;
  const collator = new Intl.Collator();
  tools.sort((a, b) => collator.compare(a.name, b.name));
  for (const tool of tools) grid.appendChild(toolCard(tool));
}

function toolCard(tool) {
  const card = document.createElement('div');
  card.className = 'card';

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = tool.name;
  body.appendChild(title);

  if (tool.category) {
    const tag = document.createElement('span');
    tag.className = 'card__tag';
    tag.textContent = tool.category;
    body.appendChild(tag);
  }

  if (tool.description) {
    const desc = document.createElement('p');
    desc.className = 'card__desc';
    desc.textContent = tool.description;
    body.appendChild(desc);
  }

  const pathEl = document.createElement('p');
  pathEl.className = 'card__path';
  pathEl.textContent = tool.path;
  pathEl.title = tool.path;
  body.appendChild(pathEl);

  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'card__actions';

  const launchBtn = document.createElement('button');
  launchBtn.className = 'btn btn--primary';
  launchBtn.textContent = 'Launch';
  launchBtn.addEventListener('click', () => launch(tool.id));
  actions.appendChild(launchBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn--ghost';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openModal(tool));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn--ghost btn--danger';
  delBtn.textContent = 'Remove';
  delBtn.addEventListener('click', () => removeTool(tool));
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

async function launch(id) {
  try {
    await window.launcher.launch(id);
    toast('Launching…');
  } catch (err) {
    toast(err.message || 'Launch failed.', 'error');
  }
}

async function removeTool(tool) {
  const ok = confirm(
    `Remove "${tool.name}" from the launcher?\n\n(This only removes it from the list — it does not delete the program.)`
  );
  if (!ok) return;
  await window.launcher.remove(tool.id);
  await refresh();
}

function openModal(tool) {
  state.editingId = tool ? tool.id : null;
  els.modalTitle.textContent = tool ? 'Edit tool' : 'Add tool';
  els.fName.value = tool?.name || '';
  els.fCategory.value = tool?.category || '';
  els.fDescription.value = tool?.description || '';
  els.fPath.value = tool?.path || '';
  els.fArgs.value = tool?.args || '';
  els.fCwd.value = tool?.cwd || '';
  els.modal.hidden = false;
  els.fName.focus();
}

function closeModal() {
  els.modal.hidden = true;
  state.editingId = null;
}

async function saveModal() {
  const tool = {
    id: state.editingId || undefined,
    name: els.fName.value,
    category: els.fCategory.value,
    description: els.fDescription.value,
    path: els.fPath.value,
    args: els.fArgs.value,
    cwd: els.fCwd.value,
  };
  try {
    await window.launcher.save(tool);
    closeModal();
    await refresh();
  } catch (err) {
    toast(err.message || 'Could not save.', 'error');
  }
}

let toastTimer = null;
function toast(message, kind) {
  els.toast.textContent = message;
  els.toast.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.className = 'toast';
  }, 2800);
}

function baseName(p) {
  const parts = p.split(/[\\/]/);
  const file = parts[parts.length - 1] || p;
  return file.replace(/\.(exe|bat|cmd|com)$/i, '');
}

function init() {
  els.categories = $('#categories');
  els.grid = $('#grid');
  els.empty = $('#empty');
  els.search = $('#search');
  els.toast = $('#toast');
  els.modal = $('#modal');
  els.modalTitle = $('#modalTitle');
  els.fName = $('#fName');
  els.fCategory = $('#fCategory');
  els.fDescription = $('#fDescription');
  els.fPath = $('#fPath');
  els.fArgs = $('#fArgs');
  els.fCwd = $('#fCwd');

  $('#addBtn').addEventListener('click', () => openModal(null));
  $('#revealBtn').addEventListener('click', () => window.launcher.revealConfig());

  $('#browseExe').addEventListener('click', async () => {
    const p = await window.launcher.pickExe();
    if (p) {
      els.fPath.value = p;
      if (!els.fName.value) els.fName.value = baseName(p);
    }
  });

  $('#browseCwd').addEventListener('click', async () => {
    const p = await window.launcher.pickFolder();
    if (p) els.fCwd.value = p;
  });

  $('#modalSave').addEventListener('click', saveModal);
  $('#modalCancel').addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.hidden) closeModal();
  });

  els.search.addEventListener('input', () => {
    state.search = els.search.value;
    renderTools();
  });

  window.launcher.onLaunchError((payload) => toast(payload.message, 'error'));

  // Re-load the tool list when a tool is added from the recommended section.
  window.addEventListener('tm-tools-changed', () => { refresh(); });

  refresh();
}

window.addEventListener('DOMContentLoaded', init);
