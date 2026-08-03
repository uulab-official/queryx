const rows = [
  ['2024-03-30', '1,284', '$186,942.00'], ['2024-03-29', '1,192', '$172,580.40'], ['2024-03-28', '1,348', '$201,320.00'],
  ['2024-03-27', '1,109', '$164,050.20'], ['2024-03-26', '1,241', '$182,735.00'], ['2024-03-25', '1,008', '$149,220.80'],
  ['2024-03-24', '982', '$138,611.50'], ['2024-03-23', '1,064', '$158,940.00'], ['2024-03-22', '1,312', '$193,281.25'],
  ['2024-03-21', '1,179', '$176,450.00'], ['2024-03-20', '1,203', '$179,826.60'], ['2024-03-19', '1,087', '$161,504.00'],
];
const tableColumns = {
  orders: [['id', 'uuid', 'PK'], ['customer_id', 'uuid'], ['status', 'varchar(24)'], ['total_amount', 'numeric(12,2)'], ['created_at', 'timestamptz'], ['updated_at', 'timestamptz']],
  customers: [['id', 'uuid', 'PK'], ['email', 'varchar(255)'], ['name', 'varchar(120)'], ['plan', 'varchar(32)'], ['created_at', 'timestamptz']],
  products: [['id', 'uuid', 'PK'], ['sku', 'varchar(48)'], ['name', 'varchar(180)'], ['price', 'numeric(10,2)'], ['active', 'boolean']],
  subscriptions: [['id', 'uuid', 'PK'], ['customer_id', 'uuid'], ['status', 'varchar(24)'], ['plan', 'varchar(32)'], ['renewal_date', 'date']],
};
const body = document.querySelector('#resultBody');
const filterInput = document.querySelector('#filterInput');
const toast = document.querySelector('#toast');
let toastTimer;

function renderRows(query = '') {
  const normalized = query.trim().toLowerCase();
  const filtered = rows.filter(row => row.join(' ').toLowerCase().includes(normalized));
  body.innerHTML = filtered.map((row, index) => `<tr><td class="checkbox-col"><input type="checkbox" aria-label="Select row ${index + 1}" /></td>${row.map(cell => `<td>${cell}</td>`).join('')}<td></td></tr>`).join('');
  document.querySelector('#resultCount').textContent = `${filtered.length === rows.length ? 30 : filtered.length} rows`;
  document.querySelector('#jsonContent').textContent = JSON.stringify(filtered.map(row => ({ day: row[0], orders: Number(row[1].replace(',', '')), revenue: row[2] })), null, 2);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

renderRows();
filterInput.addEventListener('input', event => renderRows(event.target.value));

document.querySelector('#runButton').addEventListener('click', () => {
  const button = document.querySelector('#runButton');
  button.innerHTML = '<span class="play">◌</span> Running…';
  button.style.opacity = '.75';
  setTimeout(() => { button.innerHTML = '<span class="play">▶</span> Run <span class="toolbar-shortcut">⌘↵</span>'; button.style.opacity = '1'; document.querySelector('#resultTime').textContent = '· 164ms'; showToast('Query completed successfully'); }, 650);
});
document.querySelector('#formatButton').addEventListener('click', () => showToast('Query formatted'));

document.querySelectorAll('[data-result-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-result-view]').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const isJson = button.dataset.resultView === 'json';
  document.querySelector('#gridWrap').hidden = isJson;
  document.querySelector('#jsonView').hidden = !isJson;
}));

document.querySelectorAll('[data-sort]').forEach(header => header.addEventListener('click', () => {
  const index = { day: 0, orders: 1, revenue: 2 }[header.dataset.sort];
  rows.sort((a, b) => a[index].localeCompare(b[index], undefined, { numeric: true }));
  renderRows(filterInput.value);
  showToast(`Sorted by ${header.dataset.sort}`);
}));

document.querySelectorAll('.tree-caret').forEach(caret => caret.parentElement.addEventListener('click', event => {
  if (event.target.closest('[data-table]')) return;
  const row = event.currentTarget;
  const next = row.nextElementSibling;
  if (!next || !next.classList.contains('tree-children')) return;
  const closed = next.style.display === 'none';
  next.style.display = closed ? '' : 'none';
  const indicator = row.querySelector('.tree-caret');
  if (indicator) indicator.textContent = closed ? '⌄' : '›';
}));

document.querySelectorAll('[data-table]').forEach(item => item.addEventListener('click', () => {
  document.querySelectorAll('[data-table]').forEach(node => node.classList.remove('selected'));
  item.classList.add('selected');
  const table = item.dataset.table;
  document.querySelector('#inspectorTable').textContent = table;
  document.querySelector('#columnList').innerHTML = tableColumns[table].map((column, index) => `<div class="column-row"><span class="key-symbol ${index === 0 ? '' : 'empty'}">${index === 0 ? '⌁' : '•'}</span><div><strong>${column[0]}</strong><small>${column[1]}</small></div>${column[2] ? `<span class="null-badge">${column[2]}</span>` : ''}</div>`).join('');
  showToast(`Opened ${table}`);
}));

document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  if (action === 'theme') document.body.classList.toggle('light-preview');
  if (action === 'new-connection') showToast('New connection dialog is ready');
  if (action === 'command') showToast('Command palette · type to search commands');
  if (action === 'settings') showToast('Settings are stored locally');
}));

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); document.querySelector('#runButton').click(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); filterInput.focus(); }
});
