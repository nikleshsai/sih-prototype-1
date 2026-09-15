/**
 * Shared API client — fetch wrapper with JWT auth, error handling, toasts.
 * Included by all dashboard pages.
 *
 * Backend URL is configured in config.js (window.__API_BASE_URL__).
 * In development: 'http://localhost:4000'
 * In production (same-origin): ''
 */
const API = {
  baseUrl: (typeof window !== 'undefined' && window.__API_BASE_URL__) ? window.__API_BASE_URL__ : '',

  getToken() {
    return localStorage.getItem('access_token');
  },

  getUser() {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  },

  async request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const config = { method, headers, credentials: 'include' };
    if (body && method !== 'GET') config.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(this.baseUrl + path, config);
    } catch (e) {
      const msg = (typeof I18N !== 'undefined') ? I18N.t('error.networkError') : 'Network error. Please check your connection.';
      showToast(msg, 'error');
      throw e;
    }

    // Token expired — try refresh
    if (res.status === 401 && !opts.noRefresh) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.getToken()}`;
        config.headers = headers;
        res = await fetch(this.baseUrl + path, config);
      } else {
        this.logout();
        return null;
      }
    }

    let data;
    try { data = await res.json(); }
    catch { data = {}; }

    if (!res.ok) {
      // 403 = wrong role — clear session and redirect to login
      if (res.status === 403) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
        return null;
      }
      if (!opts.silent) {
        const msg = data.error || ((typeof I18N !== 'undefined') ? I18N.t('error.serverError') : 'Something went wrong');
        showToast(msg, 'error');
      }
      throw { status: res.status, data };
    }
    return data;
  },

  get(path, opts) { return this.request('GET', path, null, opts); },
  post(path, body, opts) { return this.request('POST', path, body, opts); },
  patch(path, body, opts) { return this.request('PATCH', path, body, opts); },
  delete(path, opts) { return this.request('DELETE', path, null, opts); },

  async refresh() {
    try {
      const res = await fetch(this.baseUrl + '/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      return true;
    } catch { return false; }
  },

  logout() {
    fetch(this.baseUrl + '/api/auth/logout', {
      method: 'POST', credentials: 'include',
      headers: { 'Authorization': `Bearer ${this.getToken()}` }
    }).catch(() => {});
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  },

  requireRole(role) {
    const user = this.getUser();
    const token = this.getToken();
    if (!token || !user.role) { window.location.href = '/login.html'; return false; }
    if (role && user.role !== role) { window.location.href = '/login.html'; return false; }
    return true;
  },
};

// Expose globally so all inline scripts can access it
window.API = API;

// ---- Toast Notifications ----
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---- Loading State ----
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '';
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

// ---- Utilities ----
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try { return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return dateStr; }
}

function formatCurrency(inr) {
  if (inr === null || inr === undefined) return '';
  return '\u20B9' + Number(inr).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatKg(kg) {
  if (kg === null || kg === undefined) return '';
  if (kg >= 1000) return (kg / 1000).toFixed(1) + ' tonnes';
  return kg.toLocaleString('en-IN') + ' kg';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return formatDate(dateStr);
}

function statusBadge(status) {
  const map = {
    pending: 'badge-warn', approved: 'badge-success', rejected: 'badge-danger',
    info_required: 'badge-info', active: 'badge-success', expired: 'badge-muted',
    matched: 'badge-info', confirmed: 'badge-primary', in_fulfillment: 'badge-info',
    delivered: 'badge-success', cancelled: 'badge-danger', disputed: 'badge-danger',
    planned: 'badge-warn', in_transit: 'badge-info', paid: 'badge-success',
    unpaid: 'badge-danger', partial: 'badge-warn',
  };
  const label = (typeof I18N !== 'undefined' && I18N.t(`order.status.${status}`) !== `order.status.${status}`)
    ? I18N.t(`order.status.${status}`)
    : (status?.replace(/_/g, ' ') || '');
  return `<span class="badge ${map[status] || 'badge-muted'}">${escapeHtml(label)}</span>`;
}

function confidenceBadge(conf) {
  const labels = { unavailable: 'No Data', low: 'Low Confidence', medium: 'Medium Confidence', high: 'High Confidence' };
  const cls = { unavailable: 'badge-muted', low: 'badge-danger', medium: 'badge-warn', high: 'badge-success' };
  return `<span class="badge ${cls[conf] || 'badge-muted'}">${labels[conf] || conf}</span>`;
}

function demandDirection(dir) {
  if (dir === 'increasing') return '<span class="demand-arrow increasing">Increasing</span>';
  if (dir === 'decreasing') return '<span class="demand-arrow decreasing">Decreasing</span>';
  return '<span class="demand-arrow stable">Stable</span>';
}

// ---- Mini Bar Chart ----
function renderDemandBars(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container || !data || !data.length) return;
  const normalized = data.map(d => ({
    val: d.quantity_kg ?? d.quantity_kg_sold ?? 0,
    date: d.date || d.sale_date || '',
    type: d.type || (d.source === 'seeded' ? 'seeded' : 'actual'),
  }));
  const maxVal = Math.max(...normalized.map(d => d.val), 1);
  container.innerHTML = normalized.map(d => {
    const pct = Math.round((d.val / maxVal) * 100);
    const label = d.date ? String(d.date).slice(5) : '';
    const displayVal = d.val >= 1000 ? (d.val / 1000).toFixed(1) + 't' : (d.val ? d.val + 'kg' : '');
    return `
      <div class="demand-bar-item">
        <div class="demand-bar-val">${displayVal}</div>
        <div class="demand-bar-fill ${d.type}" style="height:${Math.max(pct, 2)}%"></div>
        <div class="demand-bar-label">${label}</div>
      </div>`;
  }).join('');
}

// ---- Sidebar active state ----
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href && path.endsWith(href.split('/').pop())) {
      item.classList.add('active');
    }
  });
}

// ---- Sidebar toggle (mobile) ----
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
  setActiveNav();
});
