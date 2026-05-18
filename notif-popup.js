// notif-popup.js — Active notification popup for user-facing pages
// Included in every user page. Call initNotifPopup(db, userId) after auth.

(function() {
  const STYLE = `
    #xnp-overlay {
      position:fixed;inset:0;background:rgba(0,0,0,0.55);
      z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;
      animation:xnpFadeIn 0.2s ease;
    }
    @keyframes xnpFadeIn { from{opacity:0} to{opacity:1} }
    @keyframes xnpSlideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
    #xnp-box {
      background:#fff;border-radius:14px;width:100%;max-width:480px;
      box-shadow:0 24px 64px rgba(0,0,0,0.3);
      animation:xnpSlideUp 0.25s ease;overflow:hidden;
    }
    #xnp-header {
      display:flex;align-items:center;gap:12px;
      padding:18px 22px;border-bottom:1px solid #e0e3e8;
    }
    #xnp-dot { width:10px;height:10px;border-radius:50%;flex-shrink:0; }
    #xnp-title { font-size:16px;font-weight:700;flex:1;font-family:inherit; }
    #xnp-close {
      background:none;border:none;font-size:22px;color:#999;
      cursor:pointer;padding:0 2px;line-height:1;
    }
    #xnp-close:hover { color:#333; }
    #xnp-body { padding:20px 22px;font-size:14px;line-height:1.65;color:#333;word-break:break-word; }
    #xnp-footer { padding:12px 22px 20px;display:flex;justify-content:flex-end;gap:10px; }
    #xnp-btn {
      height:40px;padding:0 22px;background:#1a5cff;color:#fff;
      border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;
    }
    #xnp-btn:hover { background:#1244cc; }
    /* Dark mode support */
    body.dark #xnp-box   { background:#1a1d27;color:#e8eaf0; }
    body.dark #xnp-header { border-color:#2a2d3a; }
    body.dark #xnp-title { color:#e8eaf0; }
    body.dark #xnp-close { color:#666; }
    body.dark #xnp-close:hover { color:#e8eaf0; }
    body.dark #xnp-body  { color:#c0c4d0; }
    body.dark #xnp-footer { border-color:#2a2d3a; }
  `;

  const TYPE_COLORS = {
    info:    '#1a5cff',
    warning: '#f5a623',
    success: '#22a06b',
    urgent:  '#e60023',
    account: '#1a5cff',
  };

  function _injectStyles() {
    if (document.getElementById('xnp-styles')) return;
    const s = document.createElement('style');
    s.id = 'xnp-styles';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function _removePopup() {
    const el = document.getElementById('xnp-overlay');
    if (el) el.remove();
  }

  function _showPopup(notif, db) {
    _removePopup();
    _injectStyles();

    // Mark as seen (enabled = false) so it never pops up again, but stays in panel
    if (db && notif.id) {
      db.from('notifications').update({ enabled: false }).eq('id', notif.id).then(() => {}).catch(() => {});
    }

    const color = TYPE_COLORS[notif.type] || TYPE_COLORS['info'];
    const overlay = document.createElement('div');
    overlay.id = 'xnp-overlay';
    overlay.innerHTML = `
      <div id="xnp-box">
        <div id="xnp-header">
          <div id="xnp-dot" style="background:${color};"></div>
          <div id="xnp-title">${String(notif.title || 'Notice').replace(/</g,'&lt;')}</div>
          <button id="xnp-close" onclick="document.getElementById('xnp-overlay').remove()" title="Dismiss">&#x2715;</button>
        </div>
        <div id="xnp-body">${String(notif.message || '').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
        <div id="xnp-footer">
          <button id="xnp-btn" onclick="document.getElementById('xnp-overlay').remove()">Got it</button>
        </div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  window.initNotifPopup = async function(db, userId) {
    if (!db || !userId) return;
    try {
      const { data, error } = await db
        .from('notifications')
        .select('id, title, message, type, enabled, created_at')
        .eq('user_id', userId)
        .eq('enabled', true)
        .neq('type', 'plan_upgrade_popup')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) console.warn('[notif-popup] query error:', error.message);
      if (data?.length) _showPopup(data[0], db);
    } catch (_) {}
  };
})();
