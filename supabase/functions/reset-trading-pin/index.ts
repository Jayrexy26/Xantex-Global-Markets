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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your New Trading PIN — Xantex Global Markets</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:48px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#060d1f;border-radius:14px 14px 0 0;padding:16px 40px;text-align:center;">
          <img src="https://xantexglobalmarkets.pro/images/logo.png" alt="Xantex Global Markets" height="100" style="display:block;margin:0 auto;height:100px;">
        </td>
      </tr>
      <tr>
        <td style="background:linear-gradient(90deg,#1a5cff 0%,#1244cc 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:44px 44px 32px;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#1a5cff;text-transform:uppercase;">Security Notice</p>
          <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#0d1117;line-height:1.3;">Your PIN Has Been Reset</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">Dear Valued Client,</p>
          <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">Your 4-digit trading PIN has been reset as requested. Use the temporary PIN below to sign in, then you will be prompted to create a new PIN immediately.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr>
              <td style="background:#f0f4ff;border:2px solid #1a5cff;border-radius:12px;padding:28px;text-align:center;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#1a5cff;text-transform:uppercase;">Temporary PIN</p>
                <p style="margin:0;font-size:48px;font-weight:700;letter-spacing:20px;color:#0d1117;line-height:1;">${pin}</p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.7;">&#x26A0;&#xFE0F; For your security, you will be required to create a new PIN immediately after signing in with this temporary PIN.</p>
          <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">If you did not request this reset, please contact our support team immediately at <a href="mailto:help.xantexglobalmarkets@gmail.com" style="color:#1a5cff;text-decoration:none;">help.xantexglobalmarkets@gmail.com</a>.</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;padding:24px 44px;">
          <p style="margin:0 0 12px;font-size:13px;color:#4b5563;line-height:1.7;">
            If you require any assistance, please contact our support team via live chat or at
            <a href="mailto:help.xantexglobalmarkets@gmail.com" style="color:#1a5cff;text-decoration:none;">help.xantexglobalmarkets@gmail.com</a>.
          </p>
          <p style="margin:0;font-size:13px;color:#4b5563;line-height:1.7;">
            Warm regards,<br>
            <strong style="color:#0d1117;">Xantex Global Markets</strong><br>
            Client Relations Team
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f0f4ff;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;padding:20px 44px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="text-align:center;border-right:1px solid #e2e6ee;padding:0 16px 0 0;">
                <p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">150+</p>
                <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Instruments</p>
              </td>
              <td style="text-align:center;border-right:1px solid #e2e6ee;padding:0 16px;">
                <p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">1:500</p>
                <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Max Leverage</p>
              </td>
              <td style="text-align:center;padding:0 0 0 16px;">
                <p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">24/7</p>
                <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Support</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:#060d1f;border-radius:0 0 14px 14px;padding:28px 44px;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;color:#8b9cb3;line-height:1.5;">Xantex Global Markets Ltd &bull; International Financial Services</p>
          <p style="margin:0 0 12px;font-size:12px;color:#4a5568;line-height:1.5;">
            <a href="https://xantexglobalmarkets.pro" style="color:#1a5cff;text-decoration:none;">xantexglobalmarkets.pro</a>
            &nbsp;&bull;&nbsp;
            <a href="https://xantexglobalmarkets.pro/contact.html" style="color:#4a5568;text-decoration:none;">Contact Support</a>
          </p>
          <p style="margin:0;font-size:11px;color:#374151;">&copy; 2026 Xantex Global Markets. All rights reserved.</p>
        </td>
      </tr>
    </table>
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
    user_metadata: { ...existingMeta, trading_pin: hash, trading_pin_reset: true }
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
