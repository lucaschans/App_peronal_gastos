/* ============================================================
   MisCuentas — app.js
   Lógica principal: gestión de datos, UI, gráficos y PWA
   ============================================================ */

'use strict';

/* ==================== CONFIG ==================== */

const STORAGE_KEY = 'miscuentas_v1';

/** Mapa de palabras clave para clasificación automática */
const CATEGORY_KEYWORDS = {
  comida: [
    'cena', 'comida', 'almuerzo', 'desayuno', 'cafe', 'café', 'bar',
    'restaurante', 'pizza', 'burguer', 'burger', 'sushi', 'kebab',
    'mercado', 'supermercado', 'mercadona', 'lidl', 'alcampo', 'carrefour',
    'dia', 'ahorro', 'fruta', 'verdura', 'carne', 'pan', 'bocadillo',
    'tapa', 'menú', 'menu', 'delivery', 'glovo', 'uber eats', 'just eat',
  ],
  transporte: [
    'gasolina', 'gasolinera', 'repsol', 'bp', 'cepsa', 'diesel',
    'metro', 'bus', 'autobús', 'autobus', 'tren', 'renfe', 'taxi',
    'uber', 'cabify', 'bolt', 'bici', 'parking', 'peaje', 'toll',
    'avión', 'avion', 'vuelo', 'ryanair', 'iberia', 'vueling',
    'coche', 'moto', 'revisión', 'revision', 'taller', 'itv',
  ],
  ocio: [
    'netflix', 'spotify', 'hbo', 'disney', 'prime', 'apple tv',
    'cine', 'teatro', 'concierto', 'entrada', 'ticket', 'fiesta',
    'copa', 'copas', 'discoteca', 'club', 'bar', 'club nocturno',
    'videojuego', 'juego', 'steam', 'playstation', 'xbox', 'nintendo',
    'libro', 'kindle', 'amazon', 'gym', 'gimnasio', 'deporte', 'fútbol',
    'suscripción', 'suscripcion', 'viaje', 'hotel', 'airbnb', 'booking',
  ],
};

const CATEGORY_META = {
  comida:     { emoji: '🍽️', label: 'Comida' },
  transporte: { emoji: '🚗', label: 'Transporte' },
  ocio:       { emoji: '🎮', label: 'Ocio' },
  otros:      { emoji: '📦', label: 'Otros' },
};

/* ==================== STATE ==================== */

let transactions = [];   // Array of transaction objects
let currentType = 'expense';
let currentCat  = 'comida';
let pieChart    = null;
let lineChart   = null;
let filterType  = 'all';
let filterCat   = 'all';
let catAutoSet  = false;   // Si la categoría fue puesta automáticamente

/* ==================== UTILS ==================== */

/** Formatea un número como moneda EUR */
function formatEUR(amount) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Formatea una fecha ISO a texto legible */
function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Genera un ID único simple */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Devuelve la fecha de hoy en formato YYYY-MM-DD */
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/* ==================== CLASIFICACIÓN AUTOMÁTICA ==================== */

/**
 * Clasifica automáticamente una transacción según su descripción.
 * Recorre las palabras clave de cada categoría y devuelve
 * la primera coincidencia, o 'otros' si ninguna coincide.
 * @param {string} description
 * @returns {'comida'|'transporte'|'ocio'|'otros'}
 */
function classifyDescription(description) {
  const lower = description.toLowerCase().trim();
  if (!lower) return 'otros';

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat;
    }
  }
  return 'otros';
}

/* ==================== LOCAL STORAGE ==================== */

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  } catch (e) {
    console.warn('No se pudo guardar en localStorage:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    transactions = raw ? JSON.parse(raw) : [];
  } catch (e) {
    transactions = [];
  }
}

/* ==================== RENDER ==================== */

/** Actualiza las cifras del balance card */
function renderBalance() {
  const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const balanceEl = document.getElementById('balance-amount');
  balanceEl.textContent = formatEUR(balance);
  balanceEl.classList.toggle('negative', balance < 0);
  balanceEl.classList.toggle('positive', balance > 0);

  document.getElementById('total-income').textContent  = formatEUR(income);
  document.getElementById('total-expense').textContent = formatEUR(expense);
}

/** Actualiza las quick-stats del mes actual */
function renderMonthStats() {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  // Label del mes
  document.getElementById('current-month-label').textContent =
    now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  // Filtrar gastos del mes actual
  const thisMonth = transactions.filter(t => {
    if (t.type !== 'expense') return false;
    const d = new Date(t.date + 'T00:00:00');
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const totals = { comida: 0, transporte: 0, ocio: 0, otros: 0 };
  thisMonth.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

  document.getElementById('stat-food').textContent      = formatEUR(totals.comida);
  document.getElementById('stat-transport').textContent = formatEUR(totals.transporte);
  document.getElementById('stat-leisure').textContent   = formatEUR(totals.ocio);
  document.getElementById('stat-others').textContent    = formatEUR(totals.otros);
}

/** Renderiza la lista de movimientos */
function renderMovements() {
  const list      = document.getElementById('movements-list');
  const emptyState = document.getElementById('empty-state');

  // Filtrado
  let filtered = transactions.filter(t => {
    if (filterType !== 'all' && t.type !== filterType) return false;
    if (filterCat  !== 'all' && t.category !== filterCat) return false;
    return true;
  });

  // Orden cronológico inverso
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  list.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('visible');
    return;
  }
  emptyState.classList.remove('visible');

  // Agrupar por fecha
  const grouped = {};
  filtered.forEach(t => {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  });

  Object.entries(grouped).forEach(([date, items]) => {
    // Separador de fecha
    const sep = document.createElement('div');
    sep.style.cssText = `
      font-size: 11px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; color: var(--text-3);
      padding: 8px 4px 4px;
    `;
    sep.textContent = formatDate(date);
    list.appendChild(sep);

    items.forEach(t => {
      const meta  = CATEGORY_META[t.category] || CATEGORY_META.otros;
      const sign  = t.type === 'income' ? '+' : '-';
      const item  = document.createElement('div');
      item.className = 'movement-item';
      item.dataset.id = t.id;

      item.innerHTML = `
        <div class="movement-icon ${t.type}">${meta.emoji}</div>
        <div class="movement-body">
          <div class="movement-desc">${escapeHTML(t.description || 'Sin descripción')}</div>
          <div class="movement-meta">
            <span class="movement-cat">${meta.label}</span>
          </div>
        </div>
        <div class="movement-right">
          <div class="movement-amount ${t.type}">${sign}${formatEUR(t.amount)}</div>
          <button class="delete-btn" data-id="${t.id}" title="Eliminar">✕</button>
        </div>
      `;
      list.appendChild(item);
    });
  });

  // Event delegation para el botón eliminar
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteTransaction(btn.dataset.id);
    });
  });
}

/** Escapa HTML para evitar XSS */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==================== GRÁFICOS ==================== */

const CHART_COLORS = {
  comida:     '#ff8c61',
  transporte: '#7c6fff',
  ocio:       '#3dffa0',
  otros:      '#ffcb47',
};

/** Renderiza o actualiza el pie chart de categorías */
function renderPieChart() {
  const ctx = document.getElementById('pie-chart');
  const expenses = transactions.filter(t => t.type === 'expense');

  const totals = { comida: 0, transporte: 0, ocio: 0, otros: 0 };
  expenses.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

  const labels = Object.keys(totals).map(k => CATEGORY_META[k].label);
  const data   = Object.values(totals);
  const colors = Object.keys(totals).map(k => CHART_COLORS[k]);

  const isEmpty = data.every(v => v === 0);
  toggleChartEmpty(isEmpty);
  if (isEmpty) return;

  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: 'rgba(255,255,255,0.05)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(240,240,255,0.55)',
            font: { family: "'DM Sans', sans-serif", size: 12 },
            padding: 14,
            boxWidth: 12, boxHeight: 12,
            borderRadius: 6,
          },
        },
        tooltip: {
          backgroundColor: '#1e1e32',
          titleColor: '#f0f0ff',
          bodyColor: 'rgba(240,240,255,0.7)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: ctx => `  ${formatEUR(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

/** Renderiza o actualiza el line chart de evolución del balance */
function renderLineChart() {
  const ctx = document.getElementById('line-chart');

  // Tomar los últimos 30 días
  const today = new Date();
  const days  = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  // Balance acumulado día a día
  let running = 0;
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  const dataPoints = days.map(day => {
    sorted.forEach(t => {
      if (t.date === day) {
        running += t.type === 'income' ? t.amount : -t.amount;
      }
    });
    return running;
  });

  const isEmpty = dataPoints.every(v => v === 0);
  if (isEmpty) { toggleChartEmpty(true); return; }
  toggleChartEmpty(false);

  // Labels simplificados (cada 5 días)
  const labels = days.map((d, i) => {
    if (i % 5 !== 0) return '';
    const [, m, day] = d.split('-');
    return `${day}/${m}`;
  });

  if (lineChart) lineChart.destroy();

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Balance',
        data: dataPoints,
        borderColor: '#7c6fff',
        backgroundColor: 'rgba(124,111,255,0.08)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: dataPoints.map((_, i) => i % 5 === 0 ? 4 : 0),
        pointBackgroundColor: '#7c6fff',
        pointBorderColor: '#0f0f1a',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e32',
          titleColor: '#f0f0ff',
          bodyColor: 'rgba(240,240,255,0.7)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            title: items => {
              const d = days[items[0].dataIndex];
              return formatDate(d);
            },
            label: ctx => `  Balance: ${formatEUR(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: 'rgba(240,240,255,0.35)', font: { size: 10 }, maxRotation: 0 },
          border: { display: false },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: 'rgba(240,240,255,0.35)', font: { size: 10 }, callback: v => formatEUR(v) },
          border: { display: false },
        },
      },
    },
  });
}

/** Muestra/oculta el mensaje de gráfico vacío */
function toggleChartEmpty(isEmpty) {
  document.getElementById('chart-empty').style.display = isEmpty ? 'block' : 'none';
}

/** Activa el chart correcto según la tab */
let activeChart = 'pie';
function switchChart(type) {
  activeChart = type;
  document.getElementById('pie-chart').classList.toggle('active-chart', type === 'pie');
  document.getElementById('line-chart').classList.toggle('active-chart', type === 'line');
  if (type === 'pie') renderPieChart();
  else renderLineChart();
}

/* ==================== ACTIONS ==================== */

/** Añade una nueva transacción */
function addTransaction(data) {
  transactions.push({
    id:          genId(),
    type:        data.type,
    amount:      data.amount,
    description: data.description,
    category:    data.category,
    date:        data.date,
  });
  saveToStorage();
  renderAll();
  showToast(data.type === 'income' ? '✅ Ingreso añadido' : '💸 Gasto añadido');
}

/** Elimina una transacción por ID */
function deleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveToStorage();
  renderAll();
  showToast('🗑️ Movimiento eliminado');
}

/** Borra todos los datos */
function clearAll() {
  if (!transactions.length) return;
  if (!confirm('¿Seguro que quieres borrar todos los movimientos?')) return;
  transactions = [];
  saveToStorage();
  renderAll();
  showToast('🧹 Todo borrado');
}

/** Renderiza todo de una vez */
function renderAll() {
  renderBalance();
  renderMonthStats();
  renderMovements();
  if (activeChart === 'pie') renderPieChart();
  else renderLineChart();
}

/* ==================== MODAL ==================== */

function openModal() {
  document.getElementById('modal-add').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // Default: hoy
  document.getElementById('input-date').value = todayISO();
  // Limpiar campos
  document.getElementById('input-amount').value = '';
  document.getElementById('input-desc').value   = '';
  // Reset categoría
  catAutoSet = false;
  setCategory('comida');
  document.getElementById('badge-auto').style.display = 'inline';
  // Focus al importe
  setTimeout(() => document.getElementById('input-amount').focus(), 350);
}

function closeModal() {
  document.getElementById('modal-add').classList.add('hidden');
  document.body.style.overflow = '';
}

/** Cambia el tipo (gasto/ingreso) */
function setType(type) {
  currentType = type;
  document.getElementById('type-expense').classList.toggle('active', type === 'expense');
  document.getElementById('type-income').classList.toggle('active', type === 'income');
}

/** Cambia la categoría seleccionada */
function setCategory(cat, auto = false) {
  currentCat = cat;
  document.querySelectorAll('.cat-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.cat === cat);
  });
  if (auto) {
    catAutoSet = true;
    document.getElementById('badge-auto').style.display = 'inline';
  }
}

/** Valida y guarda el formulario */
function submitForm() {
  const amountRaw = parseFloat(document.getElementById('input-amount').value);
  const desc      = document.getElementById('input-desc').value.trim();
  const date      = document.getElementById('input-date').value;

  if (isNaN(amountRaw) || amountRaw <= 0) {
    showToast('⚠️ Introduce un importe válido');
    document.getElementById('input-amount').focus();
    return;
  }
  if (!date) {
    showToast('⚠️ Selecciona una fecha');
    return;
  }

  addTransaction({
    type:        currentType,
    amount:      Math.round(amountRaw * 100) / 100,
    description: desc || 'Sin descripción',
    category:    currentCat,
    date,
  });

  closeModal();
}

/* ==================== TOAST ==================== */

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ==================== EVENT LISTENERS ==================== */

function bindEvents() {
  // FAB
  document.getElementById('fab-btn').addEventListener('click', openModal);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-add').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Type buttons
  document.getElementById('type-expense').addEventListener('click', () => setType('expense'));
  document.getElementById('type-income').addEventListener('click',  () => setType('income'));

  // Category pills
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      catAutoSet = false;
      document.getElementById('badge-auto').style.display = 'none';
      setCategory(pill.dataset.cat);
    });
  });

  // Auto-classify on description input
  document.getElementById('input-desc').addEventListener('input', e => {
    // Solo auto-clasifica si el usuario no ha seleccionado manualmente
    if (!catAutoSet || true) {
      const auto = classifyDescription(e.target.value);
      setCategory(auto, true);
    }
  });

  // Submit
  document.getElementById('submit-btn').addEventListener('click', submitForm);

  // Allow Enter to submit in amount field
  document.getElementById('input-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('input-desc').focus();
  });
  document.getElementById('input-desc').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitForm();
  });

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);

  // Filter toggle
  document.getElementById('btn-filter').addEventListener('click', () => {
    const bar = document.getElementById('filter-bar');
    const btn = document.getElementById('btn-filter');
    bar.classList.toggle('hidden');
    btn.classList.toggle('active');
  });

  document.getElementById('filter-type').addEventListener('change', e => {
    filterType = e.target.value;
    renderMovements();
  });
  document.getElementById('filter-cat').addEventListener('change', e => {
    filterCat = e.target.value;
    renderMovements();
  });

  // Chart tabs
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      switchChart(tab.dataset.chart);
    });
  });

  // Swipe-to-close modal on mobile
  let touchStartY = 0;
  const sheet = document.getElementById('modal-sheet');
  sheet.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 80) closeModal(); // swipe down > 80px
  }, { passive: true });
}

/* ==================== SPLASH & INIT ==================== */

function hideSplash() {
  const splash = document.getElementById('splash');
  const app    = document.getElementById('app');
  setTimeout(() => {
    splash.classList.add('fade-out');
    app.classList.remove('hidden');
    setTimeout(() => splash.remove(), 500);
  }, 900);
}

function init() {
  loadFromStorage();
  bindEvents();
  renderAll();
  hideSplash();

  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('SW registrado:', reg.scope))
      .catch(err => console.warn('SW error:', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
