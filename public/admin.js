/**
 * Duet Karaoke Maker - Admin Dashboard Controller
 * 
 * Secure management of all user song tokens, real-time statistics,
 * instant search, and complete Add (+), Remove (-), and Set (=) token management.
 * All credentials are authenticated server-side with salted cryptography.
 */

const ADMIN_CONFIG = {
  supabaseUrl: 'https://gezplzqucotwwjlvnrkk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlenBsenF1Y290d3dqbHZucmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjc4MDEsImV4cCI6MjEwNTg0MzgwMX0.xS4YnlrDCR5SQrZ8VJfWHlHNZa_3fnSmPxoTaIRfpgQ',
  whatsappNumber: '919743247790'
};

let supabaseAdmin = null;
let allUsers = [];
let currentFilter = 'all'; // 'all' | 'zero' | 'active'
let currentSearch = '';
let topupMode = 'add'; // 'add' | 'remove' | 'set'

// Initialize Supabase client
function initSupabase() {
  if (typeof supabase !== 'undefined' && ADMIN_CONFIG.supabaseUrl && ADMIN_CONFIG.anonKey) {
    try {
      supabaseAdmin = supabase.createClient(ADMIN_CONFIG.supabaseUrl, ADMIN_CONFIG.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'duet_karaoke_admin_session'
        },
        db: {
          schema: 'public'
        },
        global: {
          headers: {
            'x-client-info': 'duet-karaoke-maker-admin',
            'x-connection-pool': 'supavisor-transaction-6543'
          }
        }
      });
    } catch (e) {
      console.warn('[Admin] Note on Supabase client:', e);
    }
  }
}

// Get authentication headers for server API requests
function getAuthHeaders() {
  const token = sessionStorage.getItem('karaoke_admin_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Admin-Token'] = token;
  }
  return headers;
}

// Check session with server
async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/session', {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        unlockAdminPanel(data.email || 'Admin');
        return true;
      }
    }
  } catch (_) {}
  showAuthGate();
  return false;
}

function showAuthGate() {
  const overlay = document.getElementById('admin-gate-overlay');
  const main = document.getElementById('admin-main');
  const actions = document.getElementById('admin-header-actions');
  if (overlay) overlay.style.display = 'flex';
  if (main) main.style.display = 'none';
  if (actions) actions.style.display = 'none';
}

function unlockAdminPanel(modeLabel = 'Verified Admin') {
  sessionStorage.setItem('karaoke_admin_unlocked', 'true');
  const overlay = document.getElementById('admin-gate-overlay');
  const main = document.getElementById('admin-main');
  const actions = document.getElementById('admin-header-actions');
  const tag = document.getElementById('admin-auth-tag');

  if (overlay) overlay.style.display = 'none';
  if (main) main.style.display = 'block';
  if (actions) actions.style.display = 'flex';
  if (tag) tag.textContent = escapeHtml(modeLabel);
  loadUsers();
}

async function lockAdminPanel() {
  sessionStorage.removeItem('karaoke_admin_unlocked');
  sessionStorage.removeItem('karaoke_admin_token');
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (_) {}
  if (supabaseAdmin) {
    try { await supabaseAdmin.auth.signOut(); } catch (_) {}
  }
  const overlay = document.getElementById('admin-gate-overlay');
  const main = document.getElementById('admin-main');
  const actions = document.getElementById('admin-header-actions');
  const pwdInput = document.getElementById('admin-password-input');

  if (overlay) overlay.style.display = 'flex';
  if (main) main.style.display = 'none';
  if (actions) actions.style.display = 'none';
  if (pwdInput) pwdInput.value = '';
}

// Fetch all users from server API or Supabase
async function loadUsers() {
  const tbody = document.getElementById('users-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading users securely from database...</td></tr>';
  }

  try {
    let users = null;
    let fetchError = null;

    // 1. Fetch via Server Admin API (Bypasses RLS restrictions safely via admin session token)
    try {
      const res = await fetch('/api/admin/users', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          users = data.users;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        fetchError = errData.message || `Server returned HTTP ${res.status}`;
      }
    } catch (apiErr) {
      console.warn('[Admin] Server users endpoint error:', apiErr);
      fetchError = apiErr.message;
    }

    // 2. Direct Supabase Client Fallback (If server API not reachable)
    if (!users && supabaseAdmin) {
      try {
        const rpcRes = await supabaseAdmin.rpc('admin_get_all_users');
        if (!rpcRes.error && Array.isArray(rpcRes.data)) {
          users = rpcRes.data;
        } else {
          const tableRes = await supabaseAdmin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });
          if (!tableRes.error && Array.isArray(tableRes.data)) {
            users = tableRes.data;
          }
        }
      } catch (sbErr) {
        console.warn('[Admin] Direct Supabase query error:', sbErr);
      }
    }

    if (!users) {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="table-empty">
              <div style="margin-bottom: 8px;">Could not retrieve users from database.</div>
              <div style="font-size: 0.8rem; color: #8b9bb4;">
                ${fetchError ? escapeHtml(fetchError) : 'Please check server connection or run supabase_security_setup.sql in your Supabase SQL editor.'}
              </div>
            </td>
          </tr>`;
      }
      allUsers = [];
      updateMetrics([]);
      return;
    }

    allUsers = users;
    updateMetrics(allUsers);
    renderUsersTable();
    populateEmailDatalist();
    updateTopupCalcPreview();
  } catch (err) {
    console.error('[Admin] Fetch error:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty">
            Error loading users: ${escapeHtml(err.message)}
          </td>
        </tr>`;
    }
  }
}

// Populate datalist for instant autocomplete in top form
function populateEmailDatalist() {
  let datalist = document.getElementById('user-email-datalist');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'user-email-datalist';
    document.body.appendChild(datalist);
    const emailInput = document.getElementById('direct-email-input');
    if (emailInput) {
      emailInput.setAttribute('list', 'user-email-datalist');
    }
  }
  datalist.innerHTML = allUsers
    .filter(u => u.email)
    .map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.email)} (${u.credits || 0} tokens)</option>`)
    .join('');
}

// Compute & display dashboard metrics
function updateMetrics(users) {
  const total = users.length;
  const zeroCredits = users.filter(u => (u.credits || 0) <= 0).length;
  const activeUsers = users.filter(u => (u.credits || 0) > 0).length;
  const totalCredits = users.reduce((acc, u) => acc + (u.credits || 0), 0);

  setText('stat-total-users', total);
  setText('stat-zero-credits', zeroCredits);
  setText('stat-active-users', activeUsers);
  setText('stat-total-credits', totalCredits);

  setText('count-filter-all', total);
  setText('count-filter-zero', zeroCredits);
  setText('count-filter-active', activeUsers);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Render user rows with filter and search (XSS sanitized)
function renderUsersTable() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  
  let filtered = allUsers.filter(u => {
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const id = (u.id || '').toLowerCase();
      if (!email.includes(q) && !id.includes(q)) return false;
    }

    const creds = u.credits || 0;
    if (currentFilter === 'zero') return creds <= 0;
    if (currentFilter === 'active') return creds > 0;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          ${allUsers.length === 0 ? 'No registered users found yet.' : 'No users match your search/filter.'}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((u, idx) => {
    const credits = u.credits ?? 0;
    let badgeClass = 'good';
    if (credits <= 0) badgeClass = 'zero';
    else if (credits <= 2) badgeClass = 'low';

    const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Recent';
    const email = escapeHtml(u.email || 'No email');
    const safeUserId = escapeHtml(u.id || '');
    const rowId = `user-row-${idx}`;

    return `
      <tr data-user-id="${safeUserId}" data-email="${email}">
        <td>
          <div class="user-email-cell">
            <span class="user-email-text-full">${email}</span>
            <button type="button" class="btn-copy-mini btn-action-copy" data-copy="${email}" title="Copy Email">Copy</button>
            ${credits <= 0 ? `<a href="https://wa.me/${ADMIN_CONFIG.whatsappNumber}?text=Hi+${encodeURIComponent(u.email || '')}+your+karaoke+tokens+are+ready" target="_blank" rel="noopener noreferrer" class="btn-copy-mini" title="Send WhatsApp Message">WhatsApp</a>` : ''}
          </div>
        </td>
        <td>
          <div class="remaining-credits-cell">
            <span class="credit-badge ${badgeClass}" id="badge-rem-${rowId}">
              ${credits} ${credits === 1 ? 'Token' : 'Tokens'}
            </span>
            <span class="sub-label">Current Balance</span>
          </div>
        </td>
        <td>
          <div class="adding-credits-cell">
            <div class="adding-controls-row">
              <div class="adding-input-wrap">
                <input type="number" 
                       id="adj-input-${rowId}" 
                       class="row-add-input" 
                       value="10" 
                       min="1" 
                       max="10000" 
                       data-row-id="${rowId}"
                       data-credits="${credits}"
                       title="Token adjustment amount">
                <span class="adding-unit">Tokens</span>
              </div>
              <div class="row-preset-chips" data-row-id="${rowId}" data-credits="${credits}">
                <button type="button" class="btn-preset-chip" data-preset="2">2</button>
                <button type="button" class="btn-preset-chip" data-preset="5">5</button>
                <button type="button" class="btn-preset-chip active" data-preset="10">10</button>
                <button type="button" class="btn-preset-chip" data-preset="20">20</button>
              </div>
            </div>
            <div class="row-calc-preview" id="row-calc-${rowId}">
              <span class="calc-arrow">→</span> +Add: <strong class="text-success">${credits + 10}</strong> &nbsp;|&nbsp; -Remove: <strong class="text-danger">${Math.max(0, credits - 10)}</strong>
            </div>
          </div>
        </td>
        <td>
          <div class="action-buttons-cell" style="display: flex; gap: 8px; align-items: center;">
            <button type="button" 
                    class="btn-row-add btn-action-row-add" 
                    id="btn-add-${rowId}" 
                    data-user-id="${safeUserId}" 
                    data-email="${email}" 
                    data-row-id="${rowId}" 
                    data-credits="${credits}"
                    title="Add tokens to user account">
              + Add (<span id="btn-add-val-${rowId}">+10</span>)
            </button>
            <button type="button" 
                    class="btn-row-remove btn-action-row-remove" 
                    id="btn-remove-${rowId}" 
                    data-user-id="${safeUserId}" 
                    data-email="${email}" 
                    data-row-id="${rowId}" 
                    data-credits="${credits}"
                    title="Remove tokens from user account">
              - Remove (<span id="btn-rem-val-${rowId}">-10</span>)
            </button>
          </div>
        </td>
        <td style="color: var(--text-muted); font-size: 0.85rem; white-space: nowrap;">
          ${escapeHtml(dateStr)}
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" 
                    class="btn-row-set btn-action-set" 
                    data-user-id="${safeUserId}" 
                    data-email="${email}" 
                    data-credits="${credits}"
                    title="Set exact token balance">
              Set...
            </button>
            <button type="button" 
                    class="btn-reset-zero btn-action-reset" 
                    data-user-id="${safeUserId}" 
                    data-email="${email}" 
                    data-credits="${credits}"
                    title="Reset tokens to 0">
              Reset (0)
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Modify tokens securely via Server Admin Endpoint (Add, Remove, or Set)
async function updateCredits({ email, amount, mode = 'add', userId = null, btn = null }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) {
    showToast('Customer email is required.', 'error');
    return false;
  }

  const num = Math.abs(parseInt(amount, 10));
  if (isNaN(num) || (num <= 0 && mode !== 'set')) {
    showToast('Please enter a valid positive token amount.', 'warning');
    return false;
  }

  if (btn) {
    btn.disabled = true;
    btn.dataset.prevHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Updating...';
  }

  try {
    const res = await fetch('/api/admin/update-credits', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        email: cleanEmail,
        amount: num,
        mode
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || data.error || 'Server rejected token update');
    }

    const newCredits = data.credits;
    let toastMsg = '';
    if (mode === 'add') {
      toastMsg = `✓ Added ${num} tokens to ${cleanEmail}. (New Balance: ${newCredits})`;
    } else if (mode === 'remove') {
      toastMsg = `✓ Removed ${num} tokens from ${cleanEmail}. (New Balance: ${newCredits})`;
    } else {
      toastMsg = `✓ Set token balance for ${cleanEmail} to ${newCredits}.`;
    }
    showToast(toastMsg, 'success');

    // Update local user state immediately
    const user = allUsers.find(u => (userId && u.id === userId) || (u.email && u.email.toLowerCase() === cleanEmail));
    if (user) {
      user.credits = newCredits;
    } else {
      allUsers.unshift({
        id: userId || 'new',
        email: cleanEmail,
        credits: newCredits,
        created_at: new Date().toISOString()
      });
    }

    updateMetrics(allUsers);
    renderUsersTable();
    populateEmailDatalist();
    updateTopupCalcPreview();
    return true;
  } catch (err) {
    console.error('[Admin] Update tokens error:', err);
    showToast(`Error: ${err.message}`, 'error');
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      if (btn.dataset.prevHtml) {
        btn.innerHTML = btn.dataset.prevHtml;
      }
    }
  }
}

// Inline Row Amount Change
function onRowAmountChange(rowId, currentCredits) {
  const input = document.getElementById(`adj-input-${rowId}`);
  const calcEl = document.getElementById(`row-calc-${rowId}`);
  const btnAddVal = document.getElementById(`btn-add-val-${rowId}`);
  const btnRemVal = document.getElementById(`btn-rem-val-${rowId}`);
  if (!input) return;

  const raw = parseInt(input.value, 10);
  const safeVal = isNaN(raw) || raw < 1 ? 1 : raw;
  const newAdd = (currentCredits || 0) + safeVal;
  const newRem = Math.max(0, (currentCredits || 0) - safeVal);

  if (calcEl) {
    calcEl.innerHTML = `<span class="calc-arrow">→</span> +Add: <strong class="text-success">${newAdd}</strong> &nbsp;|&nbsp; -Remove: <strong class="text-danger">${newRem}</strong>`;
  }
  if (btnAddVal) btnAddVal.textContent = `+${safeVal}`;
  if (btnRemVal) btnRemVal.textContent = `-${safeVal}`;

  const row = input.closest('tr');
  if (row) {
    row.querySelectorAll('.btn-preset-chip').forEach(btn => {
      const val = parseInt(btn.getAttribute('data-preset'), 10);
      btn.classList.toggle('active', val === safeVal);
    });
  }
}

// Live calculation preview in quick top-up banner
function updateTopupCalcPreview() {
  const emailInput = document.getElementById('direct-email-input');
  const amountInput = document.getElementById('direct-amount-input');
  const previewRem = document.getElementById('calc-preview-remaining');
  const previewAction = document.getElementById('calc-preview-added');
  const previewTotal = document.getElementById('calc-preview-total');
  const submitBtn = document.getElementById('btn-grant-submit');

  const email = (emailInput?.value || '').trim().toLowerCase();
  const rawAmt = parseInt(amountInput?.value || '0', 10);
  const amt = isNaN(rawAmt) || rawAmt < 0 ? 0 : rawAmt;

  const existing = allUsers.find(u => (u.email || '').toLowerCase() === email);
  const current = existing ? (existing.credits || 0) : 0;
  
  let total = current;
  let actionText = '';
  let btnLabel = '';

  if (topupMode === 'add') {
    total = current + amt;
    actionText = `+${amt} Tokens`;
    btnLabel = `+ Add ${amt} Tokens →`;
  } else if (topupMode === 'remove') {
    total = Math.max(0, current - amt);
    actionText = `-${amt} Tokens`;
    btnLabel = `- Remove ${amt} Tokens →`;
  } else {
    total = Math.max(0, amt);
    actionText = `= ${amt} Tokens`;
    btnLabel = `Set to ${amt} Tokens →`;
  }

  if (previewRem) previewRem.textContent = existing ? `${current} Tokens` : (email ? '0 (New)' : '--');
  if (previewAction) previewAction.textContent = actionText;
  if (previewTotal) previewTotal.textContent = `${total} Tokens`;
  if (submitBtn) submitBtn.textContent = btnLabel;
}

// Toast notification helper
function showToast(msg, type = 'success') {
  const toast = document.getElementById('admin-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast show ${type}`;
  setTimeout(() => {
    toast.className = 'admin-toast';
  }, 4000);
}

// XSS Escape Helper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global Event Setup
window.addEventListener('DOMContentLoaded', () => {
  initSupabase();

  // Verify server session
  checkAdminSession();

  // Gate Tab Switching (Admin Login vs Secret PIN)
  const tabEmail = document.getElementById('tab-email');
  const tabPin = document.getElementById('tab-pin');
  const formEmail = document.getElementById('form-admin-email');
  const formPin = document.getElementById('form-admin-pin');

  tabEmail?.addEventListener('click', () => {
    tabEmail.classList.add('active');
    tabPin?.classList.remove('active');
    if (formEmail) formEmail.style.display = 'block';
    if (formPin) formPin.style.display = 'none';
    document.getElementById('admin-password-input')?.focus();
  });

  tabPin?.addEventListener('click', () => {
    tabPin.classList.add('active');
    tabEmail?.classList.remove('active');
    if (formEmail) formEmail.style.display = 'none';
    if (formPin) formPin.style.display = 'block';
    document.getElementById('admin-pin-input')?.focus();
  });

  // Unified Server Authentication Handler
  async function performAdminAuth({ email, password, submitBtn }) {
    const errEl = document.getElementById('gate-error');
    if (!password) {
      if (errEl) {
        errEl.textContent = 'Please enter your password or PIN.';
        errEl.style.display = 'block';
      }
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Authenticating with server...';
      }

      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || 'feroznadafm@gmail.com', password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (errEl) {
          errEl.textContent = data.message || 'Invalid administrator credentials. Access denied.';
          errEl.style.display = 'block';
        }
        return;
      }

      if (errEl) errEl.style.display = 'none';
      if (data.token) {
        sessionStorage.setItem('karaoke_admin_token', data.token);
      }

      // Securely bridge to Supabase session if returned
      if (supabaseAdmin) {
        try {
          if (data.supabaseSession?.access_token && data.supabaseSession?.refresh_token) {
            await supabaseAdmin.auth.setSession({
              access_token: data.supabaseSession.access_token,
              refresh_token: data.supabaseSession.refresh_token
            });
          }
        } catch (_) {}
      }

      unlockAdminPanel(data.email || 'Verified Admin');
    } catch (err) {
      if (errEl) {
        errEl.textContent = `Server connection error: ${err.message}`;
        errEl.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.id === 'btn-pin-submit' ? 'Unlock Dashboard →' : 'Sign In as Admin →';
      }
    }
  }

  // Email Gate submit
  document.getElementById('form-admin-email')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('admin-email-input')?.value.trim().toLowerCase();
    const password = document.getElementById('admin-password-input')?.value;
    const submitBtn = document.getElementById('btn-email-submit');
    performAdminAuth({ email, password, submitBtn });
  });

  // PIN Gate submit
  document.getElementById('form-admin-pin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('admin-pin-input')?.value.trim();
    const submitBtn = document.getElementById('btn-pin-submit');
    performAdminAuth({ email: 'feroznadafm@gmail.com', password: pin, submitBtn });
  });

  // Lock button
  document.getElementById('btn-admin-lock')?.addEventListener('click', lockAdminPanel);

  // Refresh button
  document.getElementById('btn-refresh-data')?.addEventListener('click', () => {
    loadUsers();
    showToast('Refreshing user list...', 'success');
  });

  // Top-up Mode Switching (+ Add, - Remove, = Set)
  document.querySelectorAll('.btn-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      topupMode = btn.getAttribute('data-mode') || 'add';
      updateTopupCalcPreview();
    });
  });

  // Top-up Preset Chips (2, 6, 10, 20, 50)
  document.querySelectorAll('#direct-amount-presets .btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#direct-amount-presets .btn-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-amount');
      const amountInput = document.getElementById('direct-amount-input');
      if (amountInput) amountInput.value = val;
      updateTopupCalcPreview();
    });
  });

  // Live calculation preview listeners in quick top-up
  document.getElementById('direct-email-input')?.addEventListener('input', updateTopupCalcPreview);
  document.getElementById('direct-amount-input')?.addEventListener('input', updateTopupCalcPreview);

  // Direct Top-up Form Submission
  document.getElementById('form-direct-topup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('direct-email-input')?.value.trim();
    const amount = parseInt(document.getElementById('direct-amount-input')?.value || '0', 10);
    const submitBtn = document.getElementById('btn-grant-submit');

    if (!email) {
      showToast('Please enter customer email.', 'warning');
      document.getElementById('direct-email-input')?.focus();
      return;
    }

    if (isNaN(amount) || (amount <= 0 && topupMode !== 'set')) {
      showToast('Please enter a valid token amount.', 'warning');
      document.getElementById('direct-amount-input')?.focus();
      return;
    }

    const success = await updateCredits({
      email,
      amount,
      mode: topupMode,
      btn: submitBtn
    });

    if (success) {
      document.getElementById('direct-email-input').value = '';
      updateTopupCalcPreview();
    }
  });

  // Table Body Event Delegation (Safe from XSS, handles dynamic rows)
  const tbody = document.getElementById('users-table-body');
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      // 1. Copy email button
      const copyBtn = e.target.closest('.btn-action-copy');
      if (copyBtn) {
        const text = copyBtn.getAttribute('data-copy');
        if (text) {
          navigator.clipboard?.writeText(text);
          showToast(`Copied: ${text}`, 'success');
        }
        return;
      }

      // 2. Preset chips in table row
      const presetBtn = e.target.closest('.btn-preset-chip');
      if (presetBtn) {
        const chipsContainer = presetBtn.closest('.row-preset-chips');
        const rowId = chipsContainer?.getAttribute('data-row-id');
        const currentCredits = parseInt(chipsContainer?.getAttribute('data-credits') || '0', 10);
        const amount = parseInt(presetBtn.getAttribute('data-preset') || '10', 10);
        const input = document.getElementById(`adj-input-${rowId}`);
        if (input) {
          input.value = amount;
          onRowAmountChange(rowId, currentCredits);
        }
        return;
      }

      // 3. Row + Add button
      const addBtn = e.target.closest('.btn-action-row-add');
      if (addBtn) {
        const userId = addBtn.getAttribute('data-user-id');
        const email = addBtn.getAttribute('data-email');
        const rowId = addBtn.getAttribute('data-row-id');
        const input = document.getElementById(`adj-input-${rowId}`);
        const raw = input ? parseInt(input.value, 10) : 10;
        const amount = isNaN(raw) || raw < 1 ? 1 : raw;

        await updateCredits({
          email,
          amount,
          mode: 'add',
          userId,
          btn: addBtn
        });
        return;
      }

      // 4. Row - Remove button
      const remBtn = e.target.closest('.btn-action-row-remove');
      if (remBtn) {
        const userId = remBtn.getAttribute('data-user-id');
        const email = remBtn.getAttribute('data-email');
        const rowId = remBtn.getAttribute('data-row-id');
        const currentCredits = parseInt(remBtn.getAttribute('data-credits') || '0', 10);
        const input = document.getElementById(`adj-input-${rowId}`);
        const raw = input ? parseInt(input.value, 10) : 10;
        const amount = isNaN(raw) || raw < 1 ? 1 : raw;

        if (currentCredits <= 0) {
          showToast(`Customer already has 0 tokens.`, 'warning');
          return;
        }

        await updateCredits({
          email,
          amount,
          mode: 'remove',
          userId,
          btn: remBtn
        });
        return;
      }

      // 5. Row Set... button (Prompt for exact token balance)
      const setBtn = e.target.closest('.btn-action-set');
      if (setBtn) {
        const userId = setBtn.getAttribute('data-user-id');
        const email = setBtn.getAttribute('data-email');
        const currentCredits = parseInt(setBtn.getAttribute('data-credits') || '0', 10);

        const promptVal = window.prompt(`Set exact token balance for ${email}:`, currentCredits);
        if (promptVal === null) return; // User cancelled

        const num = parseInt(promptVal.trim(), 10);
        if (isNaN(num) || num < 0) {
          showToast('Please enter a valid non-negative number.', 'warning');
          return;
        }

        await updateCredits({
          email,
          amount: num,
          mode: 'set',
          userId,
          btn: setBtn
        });
        return;
      }

      // 6. Row Reset (0) button
      const resetBtn = e.target.closest('.btn-action-reset');
      if (resetBtn) {
        const userId = resetBtn.getAttribute('data-user-id');
        const email = resetBtn.getAttribute('data-email');

        const confirmed = window.confirm(`Are you sure you want to reset tokens for ${email} to 0?`);
        if (!confirmed) return;

        await updateCredits({
          email,
          amount: 0,
          mode: 'set',
          userId,
          btn: resetBtn
        });
        return;
      }
    });

    // Input changes on token adjustment field
    tbody.addEventListener('input', (e) => {
      const input = e.target.closest('.row-add-input');
      if (input) {
        const rowId = input.getAttribute('data-row-id');
        const currentCredits = parseInt(input.getAttribute('data-credits') || '0', 10);
        onRowAmountChange(rowId, currentCredits);
      }
    });

    // Enter key triggers + Add
    tbody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest('.row-add-input');
        if (input) {
          e.preventDefault();
          const tr = input.closest('tr');
          const addBtn = tr?.querySelector('.btn-action-row-add');
          if (addBtn) addBtn.click();
        }
      }
    });
  }

  // Search input live filter
  const searchInput = document.getElementById('user-search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim();
      if (clearSearchBtn) clearSearchBtn.style.display = currentSearch ? 'block' : 'none';
      renderUsersTable();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      currentSearch = '';
      clearSearchBtn.style.display = 'none';
      renderUsersTable();
    });
  }

  // Filter chips (All, Zero, Active)
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter') || 'all';
      renderUsersTable();
    });
  });
});
