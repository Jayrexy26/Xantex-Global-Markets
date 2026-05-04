// ═══════════════════════════════════════════════════════════════
// ui.js — Rendering layer
// Fetches from the Edge Function (fetchAdminAPI) for the main
// financial pages. Supabase-direct calls remain for ops features
// (support, notifications, trades, announcements) in ops.html.
// ═══════════════════════════════════════════════════════════════

// ── Helpers ─────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
window.fmtDate = fmtDate;

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const _COLORS = ['#1a5cff','#22a06b','#7c3aed','#f5a623','#e60023','#0891b2','#059669'];
function _color(i) { return _COLORS[i % _COLORS.length]; }

function _initials(name) {
  return String(name || '?').split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

// ── Loading / empty states ──────────────────────────────────────
function skeletonRows(cols, count = 6) {
  return Array(count).fill(0).map(() =>
    `<tr>${Array(cols).fill(0).map(() =>
      `<td><div class="skeleton-cell" style="height:14px;border-radius:4px;"></div></td>`
    ).join('')}</tr>`
  ).join('');
}
window.skeletonRows = skeletonRows;

function emptyState(cols, msg, type = 'empty') {
  const color = type === 'error' ? 'var(--red)' : 'var(--muted)';
  return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:${color};font-size:13px;">${_esc(msg)}</td></tr>`;
}
window.emptyState = emptyState;

// ═══════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════
async function renderUsersLive() {
  const tbody       = document.getElementById('users-tbody');
  const recentTbody = document.getElementById('recent-users-tbody');
  if (tbody)       tbody.innerHTML       = skeletonRows(9);
  if (recentTbody) recentTbody.innerHTML = skeletonRows(6, 5);

  let users;
  try {
    const res = await fetchAdminAPI('list_users');
    users = res.data || res.users || [];
  } catch (e) {
    if (tbody)       tbody.innerHTML       = emptyState(9, 'Failed to load users: ' + e.message, 'error');
    if (recentTbody) recentTbody.innerHTML = emptyState(6, e.message, 'error');
    return;
  }

  // Update sidebar badge
  const badge = document.getElementById('badge-users');
  if (badge) badge.textContent = users.length > 0 ? users.length : '';

  if (!users.length) {
    if (tbody)       tbody.innerHTML       = emptyState(9, 'No users registered yet');
    if (recentTbody) recentTbody.innerHTML = emptyState(6, 'No users yet');
    return;
  }

  // Recent 5 for dashboard
  if (recentTbody) {
    recentTbody.innerHTML = users.slice(0, 5).map(u => {
      const name = _esc(u.name || u.full_name || `${u.first_name||''} ${u.last_name||''}`.trim() || u.email);
      const status = u.status || 'active';
      const kyc    = u.kyc_status || 'pending';
      return `<tr>
        <td><div class="user-cell">
          <div class="user-avatar" style="background:${_esc(u.color||_color(0))};">${_initials(name)}</div>
          <div><div class="user-name">${name}</div><div class="user-email">${_esc(u.email||'—')}</div></div>
        </div></td>
        <td>${_esc(u.country||'—')}</td>
        <td>${_esc(u.joined || fmtDate(u.created_at))}</td>
        <td><span class="badge-pill ${status==='active'?'pill-green':'pill-red'}">${status}</span></td>
        <td><span class="badge-pill ${kyc==='verified'?'pill-blue':kyc==='pending'?'pill-orange':'pill-red'}">${kyc}</span></td>
        <td><button class="btn btn--sm btn--outline" onclick="editUser('${_esc(u.id)}')">Edit</button></td>
      </tr>`;
    }).join('');
  }

  // Full users table
  if (tbody) {
    tbody.innerHTML = users.map((u, i) => {
      const name   = _esc(u.name || u.full_name || `${u.first_name||''} ${u.last_name||''}`.trim() || u.email);
      const email  = _esc(u.email || '—');
      const status = u.status || 'active';
      const kyc    = u.kyc_status || 'pending';
      const type   = u.account_type || (u.has_live ? 'Live' : 'Demo');
      const bal    = u.balance != null ? '$' + parseFloat(u.balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—';
      const col    = u.color || _color(i);
      return `<tr>
        <td><input type="checkbox"></td>
        <td><div class="user-cell">
          <div class="user-avatar" style="background:${col};">${_initials(name)}</div>
          <div><div class="user-name">${name}</div><div class="user-email">${email}</div></div>
        </div></td>
        <td>${_esc(u.country||'—')}</td>
        <td><span class="badge-pill ${type==='Live'?'pill-green':'pill-blue'}">${type}</span></td>
        <td style="font-weight:600;">${bal}</td>
        <td style="font-size:12px;">${_esc(u.joined || fmtDate(u.created_at))}</td>
        <td><span class="badge-pill ${status==='active'?'pill-green':'pill-red'}">${status}</span></td>
        <td><span class="badge-pill ${kyc==='verified'?'pill-blue':kyc==='pending'?'pill-orange':'pill-red'}">${kyc}</span></td>
        <td><div class="row-actions">
          <button class="btn btn--sm btn--outline" onclick="editUser('${_esc(u.id)}')">Edit</button>
          <button class="btn btn--sm btn--${status==='active'?'orange':'green'}" onclick="toggleUserStatus('${_esc(u.id)}')">${status==='active'?'Suspend':'Activate'}</button>
          <button class="btn btn--sm btn--outline" onclick="resetUserPassword('${email}')">Reset PWD</button>
          <button class="btn btn--sm btn--red" onclick="confirmDeleteUser('${_esc(u.id)}','${name.replace(/'/g,"\\'")}','${email}')">Delete</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  // Sync to USERS array for compatibility with inline delete functions
  if (window.USERS) {
    USERS.splice(0, USERS.length, ...users.map((u, i) => ({
      id:      u.id,
      name:    u.name || u.full_name || `${u.first_name||''} ${u.last_name||''}`.trim() || u.email,
      email:   u.email,
      country: u.country || '—',
      type:    u.account_type || (u.has_live ? 'Live' : 'Demo'),
      balance: u.balance != null ? '$' + parseFloat(u.balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—',
      joined:  u.joined || fmtDate(u.created_at),
      status:  u.status || 'active',
      kyc:     u.kyc_status || 'pending',
      color:   u.color || _color(i),
    })));
  }
}
window.renderUsersLive = renderUsersLive;

// ═══════════════════════════════════════════════════════════════
// KYC
// ═══════════════════════════════════════════════════════════════
async function renderKYCLive() {
  const tbody = document.getElementById('kyc-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(6);

  let records;
  try {
    const res = await fetchAdminAPI('list_kyc');
    records = res.data || res.kyc || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(6, 'Failed to load KYC: ' + e.message, 'error');
    return;
  }

  const badge = document.getElementById('badge-kyc');
  const pending = records.filter(k => k.status === 'pending').length;
  if (badge) badge.textContent = pending > 0 ? pending : '';

  if (!records.length) {
    if (tbody) tbody.innerHTML = emptyState(6, 'No KYC submissions found');
    return;
  }

  if (tbody) tbody.innerHTML = records.map((k, i) => {
    const name = _esc(k.name || k.full_name || `${k.first_name||''} ${k.last_name||''}`.trim() || '—');
    // Encode doc info for the viewer modal (keep same pattern as original)
    const docsJson = JSON.stringify({
      front: k.front_url, back: k.back_url, selfie: k.selfie_url,
      addr: k.proof_address_url, name, docType: k.document_type,
      status: k.status, id: k.id,
    }).replace(/'/g, "&#39;");
    const avatarHtml = k.selfie_url
      ? `<img src="${_esc(k.selfie_url)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="user-avatar" style="background:${_color(i)};display:none;">${_initials(name)}</div>`
      : `<div class="user-avatar" style="background:${_color(i)};">${_initials(name)}</div>`;
    return `<tr>
      <td><div class="user-cell">${avatarHtml}<div><div class="user-name">${name}</div><div class="user-email">${_esc(k.email||'—')}</div></div></div></td>
      <td>${_esc(k.country||'—')}</td>
      <td>${_esc(k.document_type||'—')}</td>
      <td style="font-size:12px;">${fmtDate(k.submitted_at||k.created_at)}</td>
      <td><span class="badge-pill ${k.status==='pending'?'pill-orange':k.status==='verified'?'pill-green':'pill-red'}">${k.status}</span></td>
      <td><div class="row-actions">
        <button class="btn btn--sm btn--outline" onclick="viewKYCDocs('${encodeURIComponent(docsJson)}')">View Docs</button>
        <button class="btn btn--sm btn--green" onclick="opsApproveKYC('${_esc(k.id)}')">Approve</button>
        <button class="btn btn--sm btn--red"   onclick="opsRejectKYC('${_esc(k.id)}')">Reject</button>
      </div></td>
    </tr>`;
  }).join('');
}
window.renderKYCLive = renderKYCLive;

// ═══════════════════════════════════════════════════════════════
// TRADING ACCOUNTS
// ═══════════════════════════════════════════════════════════════
async function renderAccountsLive() {
  const tbody = document.getElementById('accounts-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(9);

  let accounts;
  try {
    const res = await fetchAdminAPI('list_accounts');
    accounts = res.data || res.accounts || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(9, 'Failed to load accounts: ' + e.message, 'error');
    return;
  }

  if (!accounts.length) {
    if (tbody) tbody.innerHTML = emptyState(9, 'No trading accounts found');
    return;
  }

  if (tbody) tbody.innerHTML = accounts.map(a => {
    const bal  = parseFloat(a.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const live = (a.type || '').toLowerCase().includes('live');
    const name = _esc(a.user_name || a.name || '—');
    return `<tr>
      <td style="font-weight:600;">#${_esc(a.account_number || a.id?.slice(0,8) || '—')}</td>
      <td>${name}</td>
      <td><span class="badge-pill pill-blue">${_esc(a.platform||'—')}</span></td>
      <td><span class="badge-pill ${live?'pill-green':'pill-blue'}">${live?'Live':'Demo'}</span></td>
      <td style="font-weight:600;">$${bal}</td>
      <td>$${bal}</td>
      <td>${_esc(a.leverage||'1:200')}</td>
      <td><span class="badge-pill ${(a.status||'active')==='active'?'pill-green':'pill-red'}">${a.status||'active'}</span></td>
      <td><div class="row-actions">
        <button class="btn btn--sm btn--outline" onclick="showPage('balances',null)">Adjust</button>
        <button class="btn btn--sm btn--red" onclick="opsSuspendAccount('${_esc(a.id)}')">Suspend</button>
      </div></td>
    </tr>`;
  }).join('');
}
window.renderAccountsLive = renderAccountsLive;

// ═══════════════════════════════════════════════════════════════
// DEPOSITS
// ═══════════════════════════════════════════════════════════════
async function renderDepositsLive() {
  const tbody = document.getElementById('deposits-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  let deposits;
  try {
    const res = await fetchAdminAPI('list_deposits');
    deposits = res.data || res.deposits || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(7, 'Failed to load deposits: ' + e.message, 'error');
    return;
  }

  const pending = deposits.filter(d => d.status === 'pending').length;
  const badge   = document.getElementById('badge-deposits');
  if (badge) badge.textContent = pending > 0 ? pending : '';

  if (!deposits.length) {
    if (tbody) tbody.innerHTML = emptyState(7, 'No deposit records found');
    return;
  }

  if (tbody) tbody.innerHTML = deposits.map(d => {
    const name = _esc(d.user_name || d.name || `${d.first_name||''} ${d.last_name||''}`.trim() || '—');
    const amt  = parseFloat(d.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const isPending = d.status === 'pending';
    return `<tr>
      <td style="font-weight:600;">${d.id?.slice(0,8).toUpperCase()||'—'}</td>
      <td>${name}</td>
      <td style="font-weight:700;">$${amt}</td>
      <td>${_esc(d.payment_method || d.method || '—')}</td>
      <td style="font-size:12px;">${fmtDate(d.created_at)}</td>
      <td><span class="badge-pill ${d.status==='approved'?'pill-green':isPending?'pill-orange':'pill-red'}">${d.status}</span></td>
      <td><div class="row-actions">
        ${isPending
          ? `<button class="btn btn--sm btn--green" onclick="opsApproveDepositReq('${_esc(d.id)}','${name}','${amt}')">Approve</button>
             <button class="btn btn--sm btn--red"   onclick="opsRejectDepositReq('${_esc(d.id)}','${name}','${amt}')">Reject</button>`
          : `<button class="btn btn--sm btn--outline">View</button>`}
      </div></td>
    </tr>`;
  }).join('');
}
window.renderDepositsLive = renderDepositsLive;

// ═══════════════════════════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════════════════════════
async function renderWithdrawalsLive() {
  const tbody = document.getElementById('withdrawals-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  let withdrawals;
  try {
    const res = await fetchAdminAPI('list_withdrawals');
    withdrawals = res.data || res.withdrawals || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(7, 'Failed to load withdrawals: ' + e.message, 'error');
    return;
  }

  const pending = withdrawals.filter(w => w.status === 'pending').length;
  const badge   = document.getElementById('badge-withdrawals');
  if (badge) badge.textContent = pending > 0 ? pending : '';

  if (!withdrawals.length) {
    if (tbody) tbody.innerHTML = emptyState(7, 'No withdrawal requests found');
    return;
  }

  if (tbody) tbody.innerHTML = withdrawals.map(w => {
    const name = _esc(w.user_name || w.name || `${w.first_name||''} ${w.last_name||''}`.trim() || '—');
    const amt  = parseFloat(w.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const isPending = w.status === 'pending';
    const dest = _esc([w.destination_type, w.destination_name].filter(Boolean).join(' · ') || w.destination || '—');
    return `<tr>
      <td style="font-weight:600;">${w.id?.slice(0,8).toUpperCase()||'—'}</td>
      <td>${name}</td>
      <td style="font-weight:700;">$${amt}</td>
      <td style="font-size:12px;">${dest}</td>
      <td style="font-size:12px;">${fmtDate(w.created_at)}</td>
      <td><span class="badge-pill ${w.status==='approved'||w.status==='completed'?'pill-green':isPending?'pill-orange':'pill-red'}">${w.status}</span></td>
      <td><div class="row-actions">
        ${isPending
          ? `<button class="btn btn--sm btn--green" onclick="opsApproveWithdrawalReq('${_esc(w.id)}','${name}','${amt}')">Approve</button>
             <button class="btn btn--sm btn--red"   onclick="opsRejectWithdrawalReq('${_esc(w.id)}','${name}','${amt}')">Reject</button>`
          : `<button class="btn btn--sm btn--outline">View</button>`}
      </div></td>
    </tr>`;
  }).join('');
}
window.renderWithdrawalsLive = renderWithdrawalsLive;

// ═══════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════
async function renderTransactionsLive() {
  const tbody = document.getElementById('txn-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  let txns;
  try {
    const res = await fetchAdminAPI('list_transactions');
    txns = res.data || res.transactions || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(7, 'Failed to load transactions: ' + e.message, 'error');
    return;
  }

  if (!txns.length) {
    if (tbody) tbody.innerHTML = emptyState(7, 'No transactions found');
    return;
  }

  if (tbody) tbody.innerHTML = txns.map(t => {
    const name = _esc(t.user_name || t.name || `${t.first_name||''} ${t.last_name||''}`.trim() || '—');
    const amt  = parseFloat(t.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const dep  = (t.type || '').toLowerCase() === 'deposit';
    return `<tr>
      <td style="font-weight:600;">${t.id?.slice(0,8).toUpperCase()||'—'}</td>
      <td>${name}</td>
      <td><span class="badge-pill ${dep?'pill-green':'pill-orange'}">${t.type||'—'}</span></td>
      <td style="font-weight:700;">$${amt}</td>
      <td style="font-size:12px;">${_esc(t.account_id ? t.account_id.slice(0,8) : (t.account_number||'—'))}</td>
      <td style="font-size:12px;">${fmtDate(t.created_at)}</td>
      <td><span class="badge-pill ${t.status==='approved'||t.status==='completed'?'pill-green':t.status==='pending'?'pill-orange':'pill-red'}">${t.status||'—'}</span></td>
    </tr>`;
  }).join('');
}
window.renderTransactionsLive = renderTransactionsLive;

// ═══════════════════════════════════════════════════════════════
// POSITIONS
// ═══════════════════════════════════════════════════════════════
async function renderPositionsLive() {
  const tbody = document.getElementById('positions-tbody');
  if (tbody) tbody.innerHTML = skeletonRows(12);

  let positions;
  try {
    const res = await fetchAdminAPI('list_positions');
    positions = res.data || res.positions || [];
  } catch (e) {
    if (tbody) tbody.innerHTML = emptyState(12, 'Failed to load positions: ' + e.message, 'error');
    return;
  }

  if (!positions.length) {
    if (tbody) tbody.innerHTML = emptyState(12, 'No open positions');
    return;
  }

  if (tbody) tbody.innerHTML = positions.map(p => {
    const pnl    = parseFloat(p.floating_pnl || p.pnl || 0);
    const up     = pnl >= 0;
    const name   = _esc(p.user_name || p.name || `${p.first_name||''} ${p.last_name||''}`.trim() || '—');
    const symbol = _esc(p.symbol || p.pair || '—');
    const dir    = (p.direction || p.type || 'buy').toLowerCase();
    return `<tr>
      <td style="font-weight:600;">#${p.id?.slice(0,8)||'—'}</td>
      <td>${name}</td>
      <td style="font-size:12px;">${_esc(p.account_number || '—')}</td>
      <td style="font-weight:700;">${symbol}</td>
      <td><span class="badge-pill ${dir==='buy'?'pill-green':'pill-red'}">${dir.toUpperCase()}</span></td>
      <td>${p.lots || p.size || '—'}</td>
      <td>${p.open_price || '—'}</td>
      <td>${p.current_price || p.open_price || '—'}</td>
      <td style="color:var(--red);">${p.stop_loss || '—'}</td>
      <td style="color:var(--green);">${p.take_profit || '—'}</td>
      <td style="font-weight:700;color:${up?'var(--green)':'var(--red)'};">${up?'+':''}$${Math.abs(pnl).toFixed(2)}</td>
      <td><button class="btn btn--sm btn--red" onclick="opsForceClose('${_esc(p.id)}','${symbol}','${name}')">Force Close</button></td>
    </tr>`;
  }).join('');
}
window.renderPositionsLive = renderPositionsLive;

// ═══════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════
async function loadDashboardStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setBadge = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val > 0 ? val : ''; };

  const safe = async (action, key) => {
    try { const r = await fetchAdminAPI(action); return r[key] || []; } catch(_) { return []; }
  };

  const [users, accounts, deposits, withdrawals, positions, kyc, txns] = await Promise.all([
    safe('list_users',        'users'),
    safe('list_accounts',     'accounts'),
    safe('list_deposits',     'deposits'),
    safe('list_withdrawals',  'withdrawals'),
    safe('list_positions',    'positions'),
    safe('list_kyc',          'kyc'),
    safe('list_transactions', 'transactions'),
  ]);

  const pendingDep  = deposits.filter(d => d.status === 'pending').length;
  const pendingWith = withdrawals.filter(w => w.status === 'pending').length;
  const kycPending  = kyc.filter(k => k.status === 'pending').length;
  const liveAccounts = accounts.filter(a => a.type === 'live').length;
  const totalAUM = accounts.filter(a => a.type === 'live').reduce((s, a) => s + Number(a.balance || 0), 0);
  const openPositions = positions.filter(p => p.status === 'open').length;

  set('stat-total-users',        users.length.toLocaleString());
  set('stat-live-accounts',      liveAccounts.toLocaleString());
  set('stat-total-aum',          '$' + (totalAUM >= 1e6 ? (totalAUM/1e6).toFixed(2)+'M' : totalAUM.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})));
  set('stat-open-positions',     openPositions.toLocaleString());
  set('stat-pending-deposits',   pendingDep);
  set('stat-pending-withdrawals',pendingWith);
  set('stat-kyc-pending',        kycPending);
  set('stat-total-txns',         txns.length.toLocaleString());

  setBadge('badge-deposits',    pendingDep);
  setBadge('badge-withdrawals', pendingWith);
  setBadge('badge-kyc',         kycPending);
}
window.loadDashboardStats = loadDashboardStats;

// ═══════════════════════════════════════════════════════════════
// BALANCE PAGE — load users dropdown
// (Uses admin-api list_users, falls back to Supabase)
// ═══════════════════════════════════════════════════════════════
window.loadBalanceUsers = async function() {
  const sel = document.getElementById('adj-user-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— loading users… —</option>';

  let users = [];
  try {
    const res = await fetchAdminAPI('list_users');
    users = res.data || res.users || [];
  } catch (_) {
    // Fallback to Supabase direct
    try {
      const { data } = await window.XANTEX_DB.from('profiles').select('id,first_name,last_name,email').order('email');
      users = (data || []).map(u => ({ id: u.id, email: u.email, name: `${u.first_name||''} ${u.last_name||''}`.trim() }));
    } catch (e2) {
      sel.innerHTML = '<option value="">— error loading users —</option>';
      showToast('Could not load users: ' + e2.message, 'error');
      return;
    }
  }

  if (!users.length) {
    sel.innerHTML = '<option value="">— no users found —</option>';
    return;
  }

  sel.innerHTML = '<option value="">— choose a user —</option>';
  users.forEach(u => {
    const opt  = document.createElement('option');
    opt.value  = u.id;
    const name = u.name || u.full_name || `${u.first_name||''} ${u.last_name||''}`.trim();
    opt.textContent = name ? `${name} (${u.email})` : (u.email || u.id?.slice(0,8));
    sel.appendChild(opt);
  });
};
