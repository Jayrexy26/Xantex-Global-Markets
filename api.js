// ═══════════════════════════════════════════════════════════════
// api.js — Admin API client
// Credentials are held in memory only — never written to storage.
// Every call attaches x-admin-id and x-admin-secret headers.
// A 401/403 from the Edge Function auto-triggers logout.
// ═══════════════════════════════════════════════════════════════

const AdminAPI = (() => {
  let _id     = null;
  let _secret = null;

  // ── URL resolution ──────────────────────────────────────────
  // Prefer an explicit override, then derive from the Supabase client.
  function _getEdgeUrl() {
    if (window.XANTEX_ADMIN_API_URL) return window.XANTEX_ADMIN_API_URL;
    const db = window.XANTEX_DB;
    if (!db) return '';
    // Supabase JS v2 exposes supabaseUrl on the client object
    const base = db.supabaseUrl || '';
    return base.replace(/\/$/, '') + '/functions/v1/admin-api';
  }

  // ── Credential management ───────────────────────────────────
  function setCredentials(id, secret) {
    _id     = id;
    _secret = secret;
  }

  function clearCredentials() {
    _id     = null;
    _secret = null;
  }

  function isAuthenticated() {
    return !!(_id && _secret);
  }

  function getAdminId() { return _id; }

  // ── Core fetch wrapper ──────────────────────────────────────
  async function call(action, payload = {}) {
    if (!isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const url = _getEdgeUrl();
    if (!url) {
      throw new Error(
        'Admin API URL not found. Set window.XANTEX_ADMIN_API_URL or ensure ' +
        'window.XANTEX_DB.supabaseUrl is available.'
      );
    }

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id':     _id,
          'x-admin-secret': _secret,
        },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (e) {
      throw new Error('Network error: ' + e.message);
    }

    // Unauthorized — read server message so we know exactly why
    if (res.status === 401 || res.status === 403) {
      let serverMsg = 'Unauthorized';
      try { const j = await res.json(); serverMsg = j?.error || serverMsg; } catch(_) {}
      clearCredentials();
      _forceLogout();
      throw new Error(serverMsg);
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('Invalid JSON response from server');
    }

    if (!res.ok) {
      throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
    }

    return json;
  }

  // ── Force logout helper ─────────────────────────────────────
  function _forceLogout() {
    const gate = document.getElementById('login-gate');
    const app  = document.getElementById('main-app');
    if (gate) gate.style.display = 'flex';
    if (app)  app.style.display  = 'none';
    if (window.showToast) showToast('Session expired — please sign in again.', 'error');
  }

  return { setCredentials, clearCredentials, isAuthenticated, getAdminId, call };
})();

// Global convenience reference and shorthand
window.AdminAPI       = AdminAPI;
window.fetchAdminAPI  = (action, payload) => AdminAPI.call(action, payload);
