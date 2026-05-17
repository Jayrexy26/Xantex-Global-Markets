import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function emailTemplate(pin: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:Inter,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:40px auto">
    <tr><td style="background:#1a5cff;border-radius:12px 12px 0 0;padding:24px;text-align:center">
      <span style="color:#fff;font-size:18px;font-weight:700">Xantex Global Markets</span>
    </td></tr>
    <tr><td style="background:#181c27;border:1px solid rgba(255,255,255,0.08);border-top:none;border-radius:0 0 12px 12px;padding:32px">
      <h2 style="color:#e8eaf0;font-size:20px;margin:0 0 12px">Your PIN Has Been Reset</h2>
      <p style="color:rgba(232,234,240,0.6);font-size:14px;margin:0 0 24px">Your new 4-digit trading PIN is:</p>
      <div style="background:#0f1117;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:44px;font-weight:700;letter-spacing:16px;color:#ffffff">${pin}</span>
      </div>
      <p style="color:rgba(232,234,240,0.5);font-size:12px;margin:0 0 8px">For your security, log in and update this PIN immediately.</p>
      <p style="color:rgba(232,234,240,0.4);font-size:12px;margin:0">If you did not request this reset, contact support immediately.</p>
    </td></tr>
  </table>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') || ''
  const FROM_EMAIL   = Deno.env.get('FROM_EMAIL') || 'Xantex Global Markets <noreply@xantexglobalmarkets.pro>'

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  // Verify JWT and get user
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // Generate cryptographically random 4-digit PIN (1000–9999)
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  const pin = String(1000 + (arr[0] % 9000))

  const hash = await sha256hex(pin)

  // Fetch current user metadata to merge safely
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: adminData } = await adminClient.auth.admin.getUserById(user.id)
  const existingMeta = adminData?.user?.user_metadata || {}

  const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
    user_metadata: { ...existingMeta, trading_pin: hash }
  })
  if (updateErr) return json({ error: 'Failed to reset PIN. Please try again.' }, 500)

  // Send email via Resend (best-effort — PIN is already updated even if email fails)
  let emailSent = false
  if (RESEND_KEY && user.email) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [user.email],
          subject: 'Your New Trading PIN — Xantex Global Markets',
          html: emailTemplate(pin),
        }),
      })
      emailSent = res.ok
      if (!res.ok) console.error('Resend error:', await res.text())
    } catch (e) {
      console.error('Email send exception:', e)
    }
  }

  return json({ success: true, emailSent })
})
