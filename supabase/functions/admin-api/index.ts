import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") ?? "Driver112#";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json();
  const { action } = body;

  try {
    // ── Deposits & Withdrawals ──────────────────────────────────────────────
    if (action === "get_data") {
      const [deps, withs] = await Promise.all([
        db.from("deposit_requests").select("*, profiles(email)").order("created_at", { ascending: false }).limit(100),
        db.from("withdrawal_requests").select("*, profiles(email)").order("created_at", { ascending: false }).limit(100),
      ]);
      return ok({ deposits: deps.data ?? [], withdrawals: withs.data ?? [] });
    }

    if (action === "approve_deposit") {
      const { deposit_id } = body;
      const { data: dep } = await db.from("deposit_requests").select("*").eq("id", deposit_id).single();
      if (!dep) return err("Deposit not found");
      await db.from("deposit_requests").update({ status: "approved" }).eq("id", deposit_id);
      await db.from("transactions").insert({ user_id: dep.user_id, type: "deposit", amount: dep.amount, status: "completed", notes: "Deposit approved" });
      await db.from("profiles").update({ balance: db.rpc("increment_balance", { uid: dep.user_id, amt: dep.amount }) }).eq("id", dep.user_id);
      const { data: prof } = await db.from("profiles").select("balance").eq("id", dep.user_id).single();
      const newBal = (prof?.balance ?? 0) + Number(dep.amount);
      await db.from("profiles").update({ balance: newBal }).eq("id", dep.user_id);
      await db.from("notifications").insert({ user_id: dep.user_id, title: "Deposit Approved", message: `Your deposit of $${dep.amount} has been approved and credited to your account.` });
      return ok({ success: true });
    }

    if (action === "approve_withdrawal") {
      const { withdrawal_id } = body;
      const { data: w } = await db.from("withdrawal_requests").select("*").eq("id", withdrawal_id).single();
      if (!w) return err("Withdrawal not found");
      await db.from("withdrawal_requests").update({ status: "approved" }).eq("id", withdrawal_id);
      await db.from("transactions").insert({ user_id: w.user_id, type: "withdrawal", amount: -Math.abs(w.amount), status: "completed", notes: "Withdrawal approved" });
      const { data: prof } = await db.from("profiles").select("balance").eq("id", w.user_id).single();
      const newBal = (prof?.balance ?? 0) - Math.abs(Number(w.amount));
      await db.from("profiles").update({ balance: newBal }).eq("id", w.user_id);
      await db.from("notifications").insert({ user_id: w.user_id, title: "Withdrawal Approved", message: `Your withdrawal of $${w.amount} has been approved and is being processed.` });
      return ok({ success: true });
    }

    if (action === "reject_deposit") {
      const { deposit_id, reason } = body;
      const { data: dep } = await db.from("deposit_requests").select("*").eq("id", deposit_id).single();
      if (!dep) return err("Deposit not found");
      await db.from("deposit_requests").update({ status: "rejected", notes: reason ?? "Rejected by admin" }).eq("id", deposit_id);
      await db.from("notifications").insert({ user_id: dep.user_id, title: "Deposit Rejected", message: reason ?? "Your deposit request was not approved. Please contact support." });
      return ok({ success: true });
    }

    if (action === "reject_withdrawal") {
      const { withdrawal_id, reason } = body;
      const { data: w } = await db.from("withdrawal_requests").select("*").eq("id", withdrawal_id).single();
      if (!w) return err("Withdrawal not found");
      await db.from("withdrawal_requests").update({ status: "rejected" }).eq("id", withdrawal_id);
      await db.from("notifications").insert({ user_id: w.user_id, title: "Withdrawal Rejected", message: reason ?? "Your withdrawal request was not approved. Please contact support." });
      return ok({ success: true });
    }

    // ── Users ───────────────────────────────────────────────────────────────
    if (action === "get_users") {
      const { data } = await db.from("profiles").select("id, email, first_name, last_name, balance, kyc_status, created_at").order("created_at", { ascending: false }).limit(200);
      return ok({ users: data ?? [] });
    }

    // ── Profit Targets ──────────────────────────────────────────────────────
    if (action === "get_profit_targets") {
      const { data: targets } = await db
        .from("profit_targets")
        .select("*, profiles(email, full_name), profit_target_trades(percentage_delta)")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      const result = (targets ?? []).map((t: any) => {
        const pct = (t.profit_target_trades ?? []).reduce((sum: number, tr: any) => sum + Number(tr.percentage_delta), 0);
        return { ...t, current_percentage: Math.round(pct * 100) / 100, profit_target_trades: undefined };
      });
      return ok({ targets: result });
    }

    if (action === "get_target_trades") {
      const { target_id } = body;
      const { data } = await db.from("profit_target_trades").select("*").eq("target_id", target_id).order("created_at", { ascending: false });
      return ok({ trades: data ?? [] });
    }

    if (action === "set_profit_target") {
      const { user_id, target_amount, label } = body;
      if (!user_id || !target_amount) return err("user_id and target_amount required");
      // Deactivate existing
      await db.from("profit_targets").update({ is_active: false, updated_at: new Date().toISOString() }).eq("user_id", user_id).eq("is_active", true);
      // Create new
      const { data, error } = await db.from("profit_targets").insert({ user_id, target_amount: Number(target_amount), label: label ?? null, is_active: true }).select().single();
      if (error) return err(error.message);
      return ok({ target: data });
    }

    if (action === "add_profit_trade") {
      const { target_id, user_id, amount, percentage_delta, note } = body;
      if (!target_id || !user_id) return err("target_id and user_id required");
      // Must supply either amount or percentage_delta
      if (amount == null && percentage_delta == null) return err("Provide amount or percentage_delta");

      // Fetch target to compute percentage from dollar amount if needed
      let pctDelta = percentage_delta != null ? Number(percentage_delta) : null;
      if (pctDelta == null) {
        const { data: t } = await db.from("profit_targets").select("target_amount").eq("id", target_id).single();
        if (!t) return err("Target not found");
        pctDelta = (Number(amount) / Number(t.target_amount)) * 100;
      }

      const { data, error } = await db.from("profit_target_trades").insert({
        target_id, user_id,
        amount: amount != null ? Number(amount) : null,
        percentage_delta: pctDelta,
        note: note ?? null,
      }).select().single();
      if (error) return err(error.message);

      // Update updated_at on target
      await db.from("profit_targets").update({ updated_at: new Date().toISOString() }).eq("id", target_id);
      return ok({ trade: data });
    }

    if (action === "delete_profit_trade") {
      const { trade_id } = body;
      const { error } = await db.from("profit_target_trades").delete().eq("id", trade_id);
      if (error) return err(error.message);
      return ok({ success: true });
    }

    if (action === "deactivate_profit_target") {
      const { target_id } = body;
      await db.from("profit_targets").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", target_id);
      return ok({ success: true });
    }

    // ── Email ──────────────────────────────────────────────────────────────────
    if (action === "send_email") {
      const { recipient_email, recipient_name, recipient_user_id, subject, body_text } = body;
      if (!recipient_email || !subject || !body_text) return err("Missing fields");

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return err("RESEND_API_KEY not configured");

      const html = buildEmailHtml(subject, recipient_name ?? "", body_text);

      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Xantex Global Markets <noreply@xantexglobalmarkets.pro>",
          to: [recipient_email],
          subject,
          html,
        }),
      });

      if (!sendRes.ok) {
        const e = await sendRes.json();
        return err(e.message ?? "Resend API error");
      }

      await db.from("admin_sent_emails").insert({
        recipient_email,
        recipient_name: recipient_name ?? null,
        recipient_user_id: recipient_user_id ?? null,
        subject,
        body_text,
        body_html: html,
      });

      return ok({ sent: true });
    }

    if (action === "get_email_history") {
      const { data } = await db.from("admin_sent_emails")
        .select("id,recipient_email,recipient_name,subject,body_html,sent_at")
        .order("sent_at", { ascending: false })
        .limit(200);
      return ok({ emails: data ?? [] });
    }

    return err("Unknown action: " + action);

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});

function ok(data: object) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}
function err(msg: string) {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
}

function buildEmailHtml(subject: string, recipientName: string, bodyText: string): string {
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = recipientName ? `Dear ${safe(recipientName)},` : "Dear Valued Client,";
  const bodyHtml = safe(bodyText).replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safe(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:48px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:#060d1f;border-radius:14px 14px 0 0;padding:32px 40px;text-align:center;">
          <img src="https://xantexglobalmarkets.pro/images/logo.png" alt="Xantex Global Markets" height="100" style="display:block;margin:0 auto;height:100px;">
        </td>
      </tr>
      <tr>
        <td style="background:linear-gradient(90deg,#1a5cff 0%,#1244cc 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:44px 44px 32px;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#1a5cff;text-transform:uppercase;">Message from Xantex</p>
          <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#0d1117;line-height:1.3;">${safe(subject)}</h1>
          <p style="margin:0 0 8px;font-size:15px;color:#4b5563;line-height:1.7;">${greeting}</p>
          <p style="margin:0 0 0;font-size:15px;color:#4b5563;line-height:1.7;">${bodyHtml}</p>
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
</html>`;
}
