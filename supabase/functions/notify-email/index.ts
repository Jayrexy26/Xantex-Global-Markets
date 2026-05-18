import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_KEY   = Deno.env.get("NOTIFY_SECRET") || "xantex-notify-2026";
const ADMIN_EMAIL  = "help.xantexglobalmarkets@gmail.com";
const FROM_ADDR    = "Xantex Global Markets <noreply@xantexglobalmarkets.pro>";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db   = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json();
  const { type } = body;

  // Auth: Bearer JWT (authenticated user events) OR x-notify-key (lightweight)
  let userId: string | null = null;
  let userEmail: string | null = null;
  let profile: any = null;

  const notifyKey  = req.headers.get("x-notify-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const hasKey     = notifyKey === NOTIFY_KEY;

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }).auth.getUser();
    if (user) { userId = user.id; userEmail = user.email ?? null; }
  }

  if (!userId && !hasKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (userId) {
    const { data } = await db.from("profiles")
      .select("first_name,last_name,email,plan,country")
      .eq("id", userId).single();
    profile = data;
    if (!userEmail && data?.email) userEmail = data.email;
  }

  const firstName = profile?.first_name || body.first_name || "";
  const lastName  = profile?.last_name  || body.last_name  || "";
  const userName  = [firstName, lastName].filter(Boolean).join(" ") || userEmail || body.email || "Valued Client";
  const email     = userEmail || body.email || "";
  const plan      = profile?.plan || "Starter";

  try {
    // ── Login notification (to user) ──────────────────────────
    if (type === "login") {
      if (!userId) return new Response(JSON.stringify({ error: "JWT required" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const ua = body.user_agent || "";
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
               || req.headers.get("cf-connecting-ip")
               || "Unknown";
      const time = new Date().toUTCString();
      let location = "Unknown";
      try {
        const geo = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`).then(r => r.json());
        if (geo.city && geo.country_name) location = `${geo.city}, ${geo.country_name}`;
        else if (geo.country_name) location = geo.country_name;
        else if (geo.error) location = "Unknown";
      } catch (_) {}
      const { browser, device } = parseDevice(ua);
      await sendEmail(email, userName, "New Sign-In to Your Xantex Account", loginEmailHtml(userName, plan, { time, ip, location, browser, device }));
      return ok({ sent: true });
    }

    // ── New registration (admin notification) ─────────────────
    if (type === "register") {
      const country = profile?.country || body.country || "—";
      const subject = `New Client Registration — ${userName}`;
      await sendEmail(ADMIN_EMAIL, "Admin", subject, adminEmailHtml(subject, `
        <p style="margin:0 0 16px;font-size:15px;color:#374151;">A new client has registered on Xantex Global Markets.</p>
        ${adminTable([["Name", esc(userName)], ["Email", esc(email)], ["Country", esc(country)], ["Registered At", new Date().toUTCString()]])}
        ${opsLink()}
      `));
      return ok({ sent: true });
    }

    // ── Deposit request (admin notification) ──────────────────
    if (type === "deposit_requested") {
      const fmt = fmtAmt(body.amount);
      const subject = `New Deposit Request — $${fmt}`;
      await sendEmail(ADMIN_EMAIL, "Admin", subject, adminEmailHtml(subject, `
        <p style="margin:0 0 16px;font-size:15px;color:#374151;">A new deposit request requires review.</p>
        ${adminTable([
          ["Client", `${esc(userName)} (${esc(email)})`],
          ["Amount", `<span style="color:#059669;font-weight:700;">$${fmt}</span>`],
          ["Method", esc(body.method || "—")],
          ["Submitted At", new Date().toUTCString()],
        ])}
        ${opsLink()}
      `));
      return ok({ sent: true });
    }

    // ── Withdrawal request (admin notification) ───────────────
    if (type === "withdrawal_requested") {
      const fmt = fmtAmt(body.amount);
      const subject = `New Withdrawal Request — $${fmt}`;
      await sendEmail(ADMIN_EMAIL, "Admin", subject, adminEmailHtml(subject, `
        <p style="margin:0 0 16px;font-size:15px;color:#374151;">A new withdrawal request requires review.</p>
        ${adminTable([
          ["Client", `${esc(userName)} (${esc(email)})`],
          ["Amount", `<span style="color:#dc2626;font-weight:700;">$${fmt}</span>`],
          ["Method", esc(body.destType || "—")],
          ["Destination", esc(body.destRef || "—")],
          ["Submitted At", new Date().toUTCString()],
        ])}
        ${opsLink()}
      `));
      return ok({ sent: true });
    }

    // ── Password reset (admin notification) ───────────────────
    if (type === "password_reset") {
      const resetEmail = email || body.email || "Unknown";
      const subject = `Password Reset Requested — ${resetEmail}`;
      await sendEmail(ADMIN_EMAIL, "Admin", subject, adminEmailHtml(subject, `
        <p style="margin:0 0 16px;font-size:15px;color:#374151;">A password reset was requested for the following account.</p>
        ${adminTable([["Email", esc(resetEmail)], ["Requested At", new Date().toUTCString()]])}
      `));
      return ok({ sent: true });
    }

    return new Response(JSON.stringify({ error: "Unknown type: " + type }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(data: object) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}

async function sendEmail(to: string, _name: string, subject: string, html: string) {
  if (!to) throw new Error("No recipient email");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDR, to: [to], subject, html }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message ?? `Resend HTTP ${res.status}`);
  }
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtAmt(v: unknown): string {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function planAccent(plan: string): string {
  const p = (plan || "").toLowerCase();
  if (p.includes("diamond"))  return "#60d4f0";
  if (p.includes("platinum")) return "#94a3b8";
  if (p.includes("gold"))     return "#f59e0b";
  if (p.includes("silver"))   return "#9ca3af";
  if (p.includes("bronze"))   return "#cd7f32";
  return "#1a5cff";
}

function parseDevice(ua: string): { browser: string; device: string } {
  let browser = "Unknown Browser", device = "Unknown Device";
  if (/Edg\//i.test(ua))          browser = "Microsoft Edge";
  else if (/OPR\//i.test(ua))     browser = "Opera";
  else if (/Chrome\//i.test(ua))  browser = "Google Chrome";
  else if (/Safari\//i.test(ua))  browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  if (/iPhone/i.test(ua))         device = "iPhone";
  else if (/iPad/i.test(ua))      device = "iPad";
  else if (/Android/i.test(ua))   device = "Android Device";
  else if (/Windows/i.test(ua))   device = "Windows PC";
  else if (/Mac OS X/i.test(ua))  device = "Mac";
  else if (/Linux/i.test(ua))     device = "Linux";
  return { browser, device };
}

function adminTable(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px;">
    ${rows.map(([label, value], i) => `
    <tr style="${i % 2 === 0 ? "background:#f9fafb;" : ""}">
      <td style="padding:10px 12px;color:#6b7280;border:1px solid #e5e7eb;width:38%;font-weight:600;">${label}</td>
      <td style="padding:10px 12px;color:#111827;border:1px solid #e5e7eb;">${value}</td>
    </tr>`).join("")}
  </table>`;
}

function opsLink(): string {
  return `<p style="margin:4px 0 0;"><a href="https://xantexglobalmarkets.pro/ops.html" style="display:inline-block;background:#1a5cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Ops Panel</a></p>`;
}

function adminEmailHtml(subject: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#060d1f;padding:20px 32px;text-align:center;">
  <p style="margin:0;font-size:16px;font-weight:700;color:#fff;letter-spacing:.05em;">XANTEX GLOBAL MARKETS — OPS</p>
</td></tr>
<tr><td style="background:#1a5cff;height:3px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111827;">${esc(subject)}</h2>
  ${contentHtml}
</td></tr>
<tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
  <p style="margin:0;font-size:12px;color:#9ca3af;">Automated notification from Xantex Global Markets &copy; 2026</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function loginEmailHtml(name: string, plan: string, info: { time: string; ip: string; location: string; browser: string; device: string }): string {
  const accent = planAccent(plan);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>New Sign-In Detected</title></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:48px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr><td style="background:#060d1f;border-radius:14px 14px 0 0;padding:16px 40px;text-align:center;">
  <img src="https://xantexglobalmarkets.pro/images/logo.png" alt="Xantex Global Markets" height="100" style="display:block;margin:0 auto;">
</td></tr>
<tr><td style="background:linear-gradient(90deg,${accent} 0%,${accent}bb 100%);height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="background:#fff;padding:44px 44px 32px;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;">
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;color:${accent};text-transform:uppercase;">Security Alert</p>
  <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#0d1117;">New Sign-In Detected</h1>
  <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.7;">Dear ${esc(name)},</p>
  <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">A new sign-in to your Xantex Global Markets account was detected. Here are the details:</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
    <tr style="background:#f8fafc;"><td style="padding:12px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;width:40%;">Date &amp; Time</td><td style="padding:12px 16px;font-size:13px;color:#4b5563;border:1px solid #e5e7eb;">${esc(info.time)}</td></tr>
    <tr><td style="padding:12px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Location</td><td style="padding:12px 16px;font-size:13px;color:#4b5563;border:1px solid #e5e7eb;">${esc(info.location)}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:12px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Browser</td><td style="padding:12px 16px;font-size:13px;color:#4b5563;border:1px solid #e5e7eb;">${esc(info.browser)}</td></tr>
    <tr><td style="padding:12px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Device</td><td style="padding:12px 16px;font-size:13px;color:#4b5563;border:1px solid #e5e7eb;">${esc(info.device)}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:12px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">IP Address</td><td style="padding:12px 16px;font-size:13px;color:#4b5563;border:1px solid #e5e7eb;">${esc(info.ip)}</td></tr>
  </table>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;"><strong>Not you?</strong> If you did not sign in, please contact support immediately at <a href="mailto:help.xantexglobalmarkets@gmail.com" style="color:${accent};">help.xantexglobalmarkets@gmail.com</a>.</p>
  </div>
</td></tr>
<tr><td style="background:#f0f4ff;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;padding:20px 44px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="text-align:center;border-right:1px solid #e2e6ee;padding:0 16px 0 0;"><p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">150+</p><p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Instruments</p></td>
    <td style="text-align:center;border-right:1px solid #e2e6ee;padding:0 16px;"><p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">1:500</p><p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Max Leverage</p></td>
    <td style="text-align:center;padding:0 0 0 16px;"><p style="margin:0;font-size:18px;font-weight:700;color:#0d1117;">24/7</p><p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Support</p></td>
  </tr></table>
</td></tr>
<tr><td style="background:#060d1f;border-radius:0 0 14px 14px;padding:28px 44px;text-align:center;">
  <p style="margin:0 0 8px;font-size:13px;color:#8b9cb3;">Xantex Global Markets Ltd &bull; International Financial Services</p>
  <p style="margin:0 0 12px;font-size:12px;"><a href="https://xantexglobalmarkets.pro" style="color:${accent};text-decoration:none;">xantexglobalmarkets.pro</a> &nbsp;&bull;&nbsp; <a href="https://xantexglobalmarkets.pro/contact.html" style="color:#4a5568;text-decoration:none;">Contact Support</a></p>
  <p style="margin:0;font-size:11px;color:#374151;">&copy; 2026 Xantex Global Markets. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
