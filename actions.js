// ═══════════════════════════════════════════════════════════════
// actions.js — Admin action handlers
// All financial mutations go through fetchAdminAPI (Edge Function).
// High-risk actions require a confirmation modal (type "CONFIRM").
// Every successful action is appended to the in-session audit log.
// ═══════════════════════════════════════════════════════════════

// ── UI-level audit log (in-memory, session only) ────────────────
const _UIAuditLog = [];

function addAuditEntry(action, target, details) {
  const adminId = AdminAPI.getAdminId() || 'Admin';
  _UIAuditLog.unshift({
    time:    new Date().toISOString(),
    admin:   adminId,
    action,
    target:  target  || '—',
    details: details || '—',
  });
  _syncAuditTable();
}
window.addAuditEntry = addAuditEntry;
window.getUIAuditLog = () => _UIAuditLog;

function _syncAuditTable() {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  if (!_UIAuditLog.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">No admin actions this session</td></tr>';
    return;
  }
  tbody.innerHTML = _UIAuditLog.slice(0, 200).map(a => `
    <tr>
      <td style="font-size:12px;">${new Date(a.time).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
      <td><span class="badge-pill pill-purple">${_esc(a.admin)}</span></td>
      <td style="font-weight:600;">${_esc(a.action)}</td>
      <td style="font-size:12px;">${_esc(a.target)}</td>
      <td style="font-size:12px;color:var(--muted);">${_esc(a.details)}</td>
      <td style="font-size:11px;color:var(--muted);">Browser session</td>
    </tr>`).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Confirmation modal ──────────────────────────────────────────
let _pendingConfirmFn = null;

function showConfirmModal({ title, message, requireType, dangerLevel, confirmLabel }) {
  return new Promise(resolve => {
    const modal    = document.getElementById('modal-confirm-action');
    if (!modal) { resolve(true); return; }

    document.getElementById('confirm-modal-title').textContent = title   || 'Confirm Action';
    document.getElementById('confirm-modal-msg').innerHTML     = message || 'Are you sure?';

    const typeRow   = document.getElementById('confirm-type-row');
    const typeInp   = document.getElementById('confirm-type-input');
    const typeHint  = document.getElementById('confirm-type-hint');
    const confBtn   = document.getElementById('confirm-modal-btn');

    if (requireType) {
      typeRow.style.display = 'block';
      typeInp.value = '';
      typeHint.textContent = requireType;
      confBtn.disabled = true;
      typeInp.oninput = () => {
        confBtn.disabled = typeInp.value.trim().toUpperCase() !== requireType.toUpperCase();
      };
    } else {
      typeRow.style.display = 'none';
      confBtn.disabled = false;
    }

    const levelClass = { high: 'btn--red', medium: 'btn--orange', low: 'btn--green' };
    confBtn.className = 'btn ' + (levelClass[dangerLevel] || 'btn--primary');
    confBtn.textContent = confirmLabel || (dangerLevel === 'high' ? 'Confirm — Irreversible' : 'Confirm');

    _pendingConfirmFn = () => { resolve(true); };
    modal.classList.add('open');
    if (requireType) setTimeout(() => typeInp?.focus(), 120);
  });
}
window.showConfirmModal = showConfirmModal;

window.execConfirmedAction = function() {
  if (!_pendingConfirmFn) return;
  const fn = _pendingConfirmFn;
  _pendingConfirmFn = null;
  if (window.closeModal) closeModal('modal-confirm-action');
  fn();
};
window.cancelConfirmedAction = function() {
  _pendingConfirmFn = null;
  if (window.closeModal) closeModal('modal-confirm-action');
};

// ── Loading state helper ────────────────────────────────────────
function _setBtn(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '…' : label;
}

// ═══════════════════════════════════════════════════════════════
// APPROVE DEPOSIT
// ═══════════════════════════════════════════════════════════════
window.opsApproveDepositReq = async function(id, userName, amount) {
  const confirmed = await showConfirmModal({
    title:        'Approve Deposit',
    message:      `Approve deposit of <strong>$${amount}</strong> for <strong>${_esc(userName)}</strong>?<br><br>
                   Funds will be credited to their trading account.`,
    dangerLevel:  'low',
    confirmLabel: 'Approve Deposit',
  });
  if (!confirmed) return;
  try {
    await fetchAdminAPI('admin_approve_deposit', { deposit_id: id });
    showToast('Deposit approved successfully', 'success');
    addAuditEntry('APPROVE_DEPOSIT', userName, `ID: ${id.slice(0,8).toUpperCase()} · $${amount}`);
    window.renderDepositsLive?.();
    window.loadDashboardStats?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// REJECT DEPOSIT
// ═══════════════════════════════════════════════════════════════
window.opsRejectDepositReq = async function(id, userName, amount) {
  const confirmed = await showConfirmModal({
    title:        'Reject Deposit',
    message:      `Reject the deposit of <strong>$${amount}</strong> for <strong>${_esc(userName)}</strong>?<br><br>
                   The request will be marked as rejected.`,
    dangerLevel:  'medium',
    confirmLabel: 'Reject Deposit',
  });
  if (!confirmed) return;
  try {
    await fetchAdminAPI('admin_reject_deposit', { deposit_id: id });
    showToast('Deposit rejected', 'error');
    addAuditEntry('REJECT_DEPOSIT', userName, `ID: ${id.slice(0,8).toUpperCase()} · $${amount}`);
    window.renderDepositsLive?.();
    window.loadDashboardStats?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// APPROVE WITHDRAWAL
// ═══════════════════════════════════════════════════════════════
window.opsApproveWithdrawalReq = async function(id, userName, amount) {
  const confirmed = await showConfirmModal({
    title:        'Approve Withdrawal',
    message:      `Approve withdrawal of <strong>$${amount}</strong> for <strong>${_esc(userName)}</strong>?<br><br>
                   Funds will be deducted and the request fulfilled.`,
    requireType:  'CONFIRM',
    dangerLevel:  'high',
    confirmLabel: 'Approve Withdrawal',
  });
  if (!confirmed) return;
  try {
    await fetchAdminAPI('admin_approve_withdrawal', { withdrawal_id: id });
    showToast('Withdrawal approved', 'success');
    addAuditEntry('APPROVE_WITHDRAWAL', userName, `ID: ${id.slice(0,8).toUpperCase()} · $${amount}`);
    window.renderWithdrawalsLive?.();
    window.loadDashboardStats?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// REJECT WITHDRAWAL
// ═══════════════════════════════════════════════════════════════
window.opsRejectWithdrawalReq = async function(id, userName, amount) {
  const confirmed = await showConfirmModal({
    title:        'Reject Withdrawal',
    message:      `Reject withdrawal of <strong>$${amount}</strong> for <strong>${_esc(userName)}</strong>?<br><br>
                   The request will be marked as rejected and no funds moved.`,
    dangerLevel:  'medium',
    confirmLabel: 'Reject Withdrawal',
  });
  if (!confirmed) return;
  try {
    await fetchAdminAPI('admin_reject_withdrawal', { withdrawal_id: id });
    showToast('Withdrawal rejected', 'error');
    addAuditEntry('REJECT_WITHDRAWAL', userName, `ID: ${id.slice(0,8).toUpperCase()} · $${amount}`);
    window.renderWithdrawalsLive?.();
    window.loadDashboardStats?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// BALANCE ADJUSTMENT
// ═══════════════════════════════════════════════════════════════
window.applyAdjustment = async function() {
  const accId   = document.getElementById('adj-account')?.value;
  const adjType = document.getElementById('adj-type')?.value;
  const amount  = parseFloat(document.getElementById('adj-amount')?.value);
  const reason  = document.getElementById('adj-reason')?.value?.trim();

  if (!accId)        { showToast('Please select an account', 'error');  return; }
  if (!amount || isNaN(amount)) { showToast('Please enter a valid amount', 'error'); return; }
  if (!reason)       { showToast('A reason is required for audit trail', 'error'); return; }

  let type;
  if (adjType?.startsWith('Credit') || adjType?.startsWith('Bonus')) type = 'credit';
  else if (adjType?.startsWith('Debit'))  type = 'debit';
  else type = 'set';

  const userName = document.getElementById('adj-user-select')?.selectedOptions?.[0]?.text || 'User';

  const confirmed = await showConfirmModal({
    title:   'Balance Adjustment',
    message: `Apply <strong>${_esc(adjType)}</strong> of <strong>$${amount.toFixed(2)}</strong>?<br><br>
              Account: <code style="font-size:12px;">${accId.slice(0,8).toUpperCase()}</code><br>
              Reason: <em>${_esc(reason)}</em>`,
    requireType:  'CONFIRM',
    dangerLevel:  'high',
    confirmLabel: 'Apply Adjustment',
  });
  if (!confirmed) return;

  try {
    const result = await fetchAdminAPI('admin_adjust_balance', {
      account_id: accId,
      amount,
      type,
      reason,
    });
    const before = result?.balance_before ?? '—';
    const after  = result?.balance_after  ?? '—';
    showToast(`Balance updated: $${before} → $${after}`, 'success');
    addAuditEntry(
      'BALANCE_ADJUSTMENT',
      userName,
      `Account: ${accId.slice(0,8).toUpperCase()} · ${adjType} $${amount.toFixed(2)} · ${reason}`
    );
    document.getElementById('adj-amount').value = '';
    document.getElementById('adj-reason').value = '';
    window.loadUserAccounts?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// FORCE CLOSE POSITION
// ═══════════════════════════════════════════════════════════════
window.opsForceClose = async function(id, symbol, userName) {
  const confirmed = await showConfirmModal({
    title:   'Force Close Position',
    message: `Force close position <strong>${_esc(symbol)}</strong> for <strong>${_esc(userName)}</strong>?<br><br>
              This is an <strong>atomic operation</strong> — the trade will be settled at current market price
              and the account balance updated immediately. This cannot be undone.`,
    requireType:  'CONFIRM',
    dangerLevel:  'high',
    confirmLabel: 'Force Close Position',
  });
  if (!confirmed) return;
  try {
    await fetchAdminAPI('admin_complete_plan', { position_id: id });
    showToast('Position force closed', 'success');
    addAuditEntry('FORCE_CLOSE_POSITION', userName, `Position: ${id.slice(0,8).toUpperCase()} · ${symbol}`);
    window.renderPositionsLive?.();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};
