// notification.js
// Checks the notifications table on every page load.
// Shows a popup if admin has enabled one for the current user.
// Keeps appearing on every page until admin sets enabled = false.
(async function () {
  // Wait for XANTEX_DB to initialise (supabase.js sets it synchronously,
  // but the script tag order can vary, so we poll briefly just in case)
  let tries = 0;
  while (!window.XANTEX_DB && tries < 30) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  const db = window.XANTEX_DB;
  if (!db) return;

  // Need an active session to know which user this is
  let userId;
  try {
    const { data } = await db.auth.getSession();
    userId = data?.session?.user?.id;
  } catch (_) { return; }
  if (!userId) return;

  // Fetch the notification for this user
  let notif;
  try {
    const { data } = await db
      .from('notifications')
      .select('title, message, enabled')
      .eq('user_id', userId)
      .eq('enabled', true)
      .maybeSingle();
    notif = data;
  } catch (_) { return; }

  if (!notif || !notif.message) return;

  _xantexShowNotif(notif.title || 'Notice', notif.message);
})();

function _xantexShowNotif(title, message) {
  // Remove any stale overlay from a previous call
  const old = document.getElementById('xn-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'xn-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
    'z-index:99999', 'display:flex', 'align-items:center',
    'justify-content:center', 'padding:20px',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes xnIn {
        from { opacity:0; transform:scale(0.94) translateY(16px) }
        to   { opacity:1; transform:scale(1)    translateY(0)    }
      }
      #xn-card {
        background:#ffffff;
        border-radius:16px;
        width:100%;
        max-width:480px;
        box-shadow:0 32px 80px rgba(0,0,0,0.3);
        overflow:hidden;
        animation:xnIn 0.28s cubic-bezier(.22,.68,0,1.2);
        font-family:'Inter',system-ui,sans-serif;
      }
      body.dark #xn-card { background:#1a1d27; }
      body.dark #xn-msg  { color:#d1d5db !important; }
      #xn-ok {
        height:42px; padding:0 28px;
        background:#1a5cff; color:#fff;
        border:none; border-radius:8px;
        font-size:14px; font-weight:700;
        cursor:pointer; transition:background .15s;
        font-family:inherit;
      }
      #xn-ok:hover { background:#1244cc; }
    </style>

    <div id="xn-card">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a5cff 0%,#1244cc 100%);
                  padding:22px 24px;display:flex;align-items:center;gap:14px;">
        <div style="width:46px;height:46px;border-radius:50%;
                    background:rgba(255,255,255,0.18);display:flex;
                    align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24"
               style="width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.65);
                      text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">
            Important Notice · Xantex Global Markets
          </div>
          <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.2;">
            ${_xnEsc(title)}
          </div>
        </div>
      </div>

      <!-- Body -->
      <div style="padding:24px;">
        <div id="xn-msg"
             style="font-size:14px;line-height:1.75;color:#374151;
                    white-space:pre-wrap;word-break:break-word;">
          ${_xnEsc(message)}
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:0 24px 22px;display:flex;
                  align-items:center;justify-content:space-between;">
        <div style="font-size:11px;color:#9ca3af;">
          This message will continue to appear until removed by admin.
        </div>
        <button id="xn-ok">Got it</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('xn-ok').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
  }, { once: true });
}

function _xnEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
