const API_BASE = window.location.origin;

// State
let refreshInterval: number | null = null;

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).dataset.section;

    // Update active nav
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    (e.target as HTMLElement).classList.add('active');

    // Show section
    document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
    document.getElementById(target)?.classList.add('active');
  });
});

// Modal
export const createStrategyModal = {
  show() {
    document.getElementById('create-strategy-modal')?.classList.add('show');
  },
  hide() {
    document.getElementById('create-strategy-modal')?.classList.remove('show');
  }
};

// Form submission
document.getElementById('create-strategy-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target as HTMLFormElement);
  const data = Object.fromEntries(formData.entries());

  // Convert to appropriate types
  data.amount_usd = parseFloat(data.amount_usd);
  data.interval_minutes = parseInt(data.interval_minutes);

  try {
    const response = await fetch(`${API_BASE}/api/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      alert('Strategy created successfully!');
      createStrategyModal.hide();
      (e.target as HTMLFormElement).reset();
      loadData();
    } else {
      alert('Failed to create strategy');
    }
  } catch (error) {
    console.error('Create strategy error:', error);
    alert('Error creating strategy');
  }
});

// Load all data
async function loadData() {
  await Promise.all([
    loadPortfolio(),
    loadTrades(),
    loadStrategies(),
    loadPositions(),
    loadNotifications(),
    loadRiskStats(),
  ]);
  updateLastUpdateTime();
}

async function loadPortfolio() {
  try {
    const response = await fetch(`${API_BASE}/api/portfolio`);
    const data = await response.json();

    document.getElementById('portfolio-value').textContent = formatCurrency(data.total_value_usd);

    // Calculate 24h P&L (would need snapshot from 24h ago)
    document.getElementById('pnl-24h').textContent = '$0.00';
  } catch (error) {
    console.error('Failed to load portfolio:', error);
  }
}

async function loadTrades() {
  try {
    const response = await fetch(`${API_BASE}/api/trades?limit=10`);
    const trades = await response.json();

    const tbody = document.querySelector('#trades-table tbody');
    if (!tbody) return;

    tbody.innerHTML = trades.map(trade => `
      <tr>
        <td>${new Date(trade.created_at).toLocaleString()}</td>
        <td>${trade.symbol}</td>
        <td><span class="badge badge-${trade.side}">${trade.side}</span></td>
        <td>$${trade.price?.toFixed(2) || 'market'}</td>
        <td>${trade.filled_quantity?.toFixed(6)}</td>
        <td>$${(trade.filled_quantity * (trade.avg_fill_price || trade.price)).toFixed(2)}</td>
        <td><span class="badge badge-${trade.status.toLowerCase()}">${trade.status}</span></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load trades:', error);
  }
}

async function loadStrategies() {
  try {
    const response = await fetch(`${API_BASE}/api/strategies`);
    const strategies = await response.json();

    const tbody = document.querySelector('#strategies-table tbody');
    if (!tbody) return;

    tbody.innerHTML = strategies.map(strategy => `
      <tr>
        <td>${strategy.name}</td>
        <td>${strategy.type}</td>
        <td><code>${JSON.stringify(strategy.config)}</code></td>
        <td>
          <input type="checkbox" ${strategy.is_enabled ? 'checked' : ''} data-id="${strategy.id}" onchange="toggleStrategy(this)">
        </td>
        <td>
          <button class="btn-secondary" onclick="deleteStrategy('${strategy.id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load strategies:', error);
  }
}

async function loadPositions() {
  try {
    const response = await fetch(`${API_BASE}/api/positions`);
    const positions = await response.json();

    const tbody = document.querySelector('#positions-table tbody');
    if (!tbody) return;

    tbody.innerHTML = positions.map(pos => `
      <tr>
        <td>${pos.symbol}</td>
        <td>${pos.side}</td>
        <td>${pos.quantity.toFixed(6)}</td>
        <td>$${pos.entry_price.toFixed(2)}</td>
        <td>$${pos.current_price?.toFixed(2) || 'N/A'}</td>
        <td class="${pos.unrealized_pnl >= 0 ? 'positive' : 'negative'}">
          $${pos.unrealized_pnl?.toFixed(2) || '0.00'}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6">No open positions</td></tr>';
  } catch (error) {
    console.error('Failed to load positions:', error);
  }
}

async function loadNotifications() {
  try {
    const response = await fetch(`${API_BASE}/api/notifications?limit=20`);
    const notifications = await response.json();

    const container = document.getElementById('notifications-list');
    if (!container) return;

    container.innerHTML = notifications.map(notif => `
      <div class="notification-item ${notif.is_read ? '' : 'unread'}">
        <h4>${notif.title}</h4>
        <p>${notif.message}</p>
        <div class="notification-time">${new Date(notif.created_at).toLocaleString()}</div>
      </div>
    `).join('') || '<p>No notifications</p>';
  } catch (error) {
    console.error('Failed to load notifications:', error);
  }
}

async function loadRiskStats() {
  try {
    const response = await fetch(`${API_BASE}/api/risk/stats`);
    const stats = await response.json();

    document.getElementById('daily-trades').textContent = `${stats.tradesToday}/${stats.maxTradesPerDay}`;
  } catch (error) {
    console.error('Failed to load risk stats:', error);
  }
}

function updateLastUpdateTime() {
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

// Toggle strategy
window.toggleStrategy = async (checkbox: HTMLInputElement) => {
  const strategyId = checkbox.dataset.id;
  try {
    await fetch(`${API_BASE}/api/strategies/${strategyId}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: checkbox.checked }),
    });
    alert(`Strategy ${checkbox.checked ? 'enabled' : 'disabled'}`);
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    alert('Failed to update strategy');
  }
};

// Delete strategy
window.deleteStrategy = async (id: string) => {
  if (!confirm('Delete this strategy?')) return;

  try {
    await fetch(`${API_BASE}/api/strategies/${id}`, { method: 'DELETE' });
    loadData();
  } catch (error) {
    alert('Failed to delete strategy');
  }
};

// Connection status
function updateStatus(connected: boolean) {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');

  if (connected) {
    indicator?.classList.add('connected');
    indicator?.classList.remove('disconnected');
    text!.textContent = 'Connected';
  } else {
    indicator?.classList.add('disconnected');
    indicator?.classList.remove('connected');
    text!.textContent = 'Disconnected';
  }
}

// Initialize
window.addEventListener('load', () => {
  loadData();
  refreshInterval = window.setInterval(loadData, 10000); // Refresh every 10s

  // Test API connection
  fetch(`${API_BASE}/health`)
    .then(() => updateStatus(true))
    .catch(() => updateStatus(false));
});

// Cleanup
window.addEventListener('beforeunload', () => {
  if (refreshInterval) clearInterval(refreshInterval);
});