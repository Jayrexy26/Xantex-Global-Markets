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

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Accept either x-admin-secret header OR a valid admin user JWT
  const xSecret = req.headers.get("x-admin-secret");
  let authorized = xSecret === ADMIN_SECRET;

  if (!authorized) {
    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { count } = await db.from("admin_users").select("id", { count: "exact", head: true }).eq("id", user.id);
        authorized = (count ?? 0) > 0;
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const body = await req.json();
  const { action } = body;

  try {
    // â”€â”€ Deposits & Withdrawals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const { data: prof } = await db.from("profiles").select("balance,email,first_name,last_name,plan").eq("id", dep.user_id).single();
      const newBal = (prof?.balance ?? 0) + Number(dep.amount);
      await db.from("profiles").update({ balance: newBal }).eq("id", dep.user_id);
      await db.from("notifications").insert({ user_id: dep.user_id, title: "Deposit Approved", message: `Your deposit of $${dep.amount} has been approved and credited to your account.` });
      if (prof?.email) {
        const fmtA = Number(dep.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtB = Number(newBal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const n = [prof.first_name, prof.last_name].filter(Boolean).join(" ") || prof.email;
        await sendUserEmail(prof.email, n, "Your Deposit Has Been Approved", "deposit_approved", { amount: fmtA, balance: fmtB, plan: prof.plan || "Starter" });
      }
      return ok({ success: true });
    }

    if (action === "approve_withdrawal") {
      const { withdrawal_id } = body;
      const { data: w } = await db.from("withdrawal_requests").select("*").eq("id", withdrawal_id).single();
      if (!w) return err("Withdrawal not found");
      await db.from("withdrawal_requests").update({ status: "approved" }).eq("id", withdrawal_id);
      // Balance already deducted at submission — just log the transaction
      await db.from("transactions").insert({ user_id: w.user_id, type: "withdrawal", amount: -Math.abs(w.amount), status: "completed", notes: "Withdrawal approved" });
      const { data: prof } = await db.from("profiles").select("email,first_name,last_name,plan").eq("id", w.user_id).single();
      await db.from("notifications").insert({ user_id: w.user_id, title: "Withdrawal Approved", message: `Your withdrawal of $${w.amount} has been approved and is being processed.` });
      if (prof?.email) {
        const fmtA = Number(w.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const n = [prof.first_name, prof.last_name].filter(Boolean).join(" ") || prof.email;
        await sendUserEmail(prof.email, n, "Your Withdrawal Has Been Processed", "withdrawal_approved", { amount: fmtA, destType: w.destination_type || "—", plan: prof.plan || "Starter" });
      }
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
      // Balance refund handled by DB trigger (pending → rejected)
      await db.from("notifications").insert({ user_id: w.user_id, title: "Withdrawal Rejected", message: reason ?? "Your withdrawal request was not approved and the amount has been returned to your account balance. Please contact support." });
      return ok({ success: true });
    }

    // â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (action === "get_users") {
      const { data } = await db.from("profiles").select("id, email, first_name, last_name, balance, kyc_status, created_at").order("created_at", { ascending: false }).limit(200);
      return ok({ users: data ?? [] });
    }

    // â”€â”€ Profit Targets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      // Auto-notification — stored in history only (enabled:false skips the popup)
      const fmtAmt = Number(target_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await db.from("notifications").insert({
        user_id,
        title: "New Trade Cycle Started",
        message: `A new trade cycle has been initiated on your account. Your profit target has been set to $${fmtAmt}${label ? ` — ${label}` : ""}.`,
        type: "info",
        enabled: false,
      });
      const { data: ptProf } = await db.from("profiles").select("email,first_name,last_name,plan").eq("id", user_id).single();
      if (ptProf?.email) {
        const n = [ptProf.first_name, ptProf.last_name].filter(Boolean).join(" ") || ptProf.email;
        await sendUserEmail(ptProf.email, n, "New Trade Cycle Initiated on Your Account", "profit_target_set", { amount: fmtAmt, label: label || null, plan: ptProf.plan || "Starter" });
      }
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
      // Fetch user_id before deactivating so we can send the notification
      const { data: tgt } = await db.from("profit_targets").select("user_id").eq("id", target_id).single();
      await db.from("profit_targets").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", target_id);
      if (tgt?.user_id) {
        await db.from("notifications").insert({
          user_id: tgt.user_id,
          title: "Trade Cycle Complete",
          message: "Your trade cycle has been successfully completed. The profit target for your account has been reached and the cycle is now closed.",
          type: "success",
          enabled: false,
        });
      }
      return ok({ success: true });
    }

    // ── KYC & Plan notifications ──────────────────────────────────────────────
    if (action === “notify_kyc_approved”) {
      const { user_id } = body;
      if (!user_id) return err(“user_id required”);
      const { data: prof } = await db.from(“profiles”).select(“email,first_name,last_name,plan”).eq(“id”, user_id).single();
      if (!prof?.email) return err(“User not found”);
      const n = [prof.first_name, prof.last_name].filter(Boolean).join(“ “) || prof.email;
      await sendUserEmail(prof.email, n, “Your Identity Verification Is Complete”, “kyc_approved”, { plan: prof.plan || “Starter” });
      return ok({ sent: true });
    }

    if (action === “notify_plan_upgraded”) {
      const { user_id, plan } = body;
      if (!user_id || !plan) return err(“user_id and plan required”);
      const { data: prof } = await db.from(“profiles”).select(“email,first_name,last_name”).eq(“id”, user_id).single();
      if (!prof?.email) return err(“User not found”);
      const n = [prof.first_name, prof.last_name].filter(Boolean).join(“ “) || prof.email;
      await Promise.all([
        sendUserEmail(prof.email, n, `Your Account Has Been Upgraded to ${plan}`, “plan_upgraded”, { plan }),
        db.from(“notifications”).insert([
          {
            user_id,
            title: `Account Upgraded to ${plan}`,
            message: plan,
            type: “plan_upgrade_popup”,
            enabled: true,
          },
          {
            user_id,
            title: `Account Upgraded to ${plan}`,
            message: `Your account has been successfully upgraded to the ${plan} plan. Enjoy your new features and increased balance limit.`,
            type: “account”,
            enabled: true,
          },
        ]),
      ]);
      return ok({ sent: true });
    }

    // â”€â”€ Email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (action === “send_email”) {
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

async function sendUserEmail(to: string, toName: string, subject: string, tmpl: string, data: Record<string, any>) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  const html = buildPlanEmailHtml(subject, toName, tmpl, data);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Xantex Global Markets <noreply@xantexglobalmarkets.pro>", to: [to], subject, html }),
  }).catch(() => {});
}

function planAccent(plan: string): string {
  const p = (plan || "").toUpperCase().trim();
  if (p === "MASTER") return "#d97706";
  if (p === "ELITE")  return "#7c3aed";
  if (p.startsWith("RAW")) return "#0070f3";
  return "#1a5cff";
}

function buildPlanEmailHtml(subject: string, recipientName: string, tmpl: string, data: Record<string, any>): string {
  const s = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const accent = planAccent(data.plan || "Starter");
  const greeting = recipientName ? `Dear ${s(recipientName)},` : "Dear Valued Client,";

  let badge = "", content = "";

  if (tmpl === "deposit_approved") {
    badge = `<div style="display:inline-block;background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:6px 16px;margin-bottom:20px;"><span style="font-size:13px;font-weight:700;color:#166534;">DEPOSIT APPROVED</span></div>`;
    content = `
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">Your deposit has been confirmed and credited to your trading account. Your funds are now available for trading.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="background:#f8fafc;"><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;width:45%;">Deposit Amount</td><td style="padding:14px 18px;font-size:16px;font-weight:700;color:#166534;border:1px solid #e5e7eb;">$${s(data.amount)}</td></tr>
        <tr><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Updated Balance</td><td style="padding:14px 18px;font-size:16px;font-weight:700;color:#0d1117;border:1px solid #e5e7eb;">$${s(data.balance)}</td></tr>
      </table>
      <p style="margin:0;font-size:14px;color:#6b7280;">Log in to your <a href="https://xantexglobalmarkets.pro/dashboard.html" style="color:${accent};">dashboard</a> to start trading.</p>`;
  } else if (tmpl === "withdrawal_approved") {
    badge = `<div style="display:inline-block;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:6px 16px;margin-bottom:20px;"><span style="font-size:13px;font-weight:700;color:#991b1b;">WITHDRAWAL PROCESSED</span></div>`;
    content = `
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">Your withdrawal request has been approved and is being processed. Please allow 1–5 business days for funds to arrive.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="background:#f8fafc;"><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;width:45%;">Withdrawal Amount</td><td style="padding:14px 18px;font-size:16px;font-weight:700;color:#991b1b;border:1px solid #e5e7eb;">$${s(data.amount)}</td></tr>
        <tr><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Method</td><td style="padding:14px 18px;font-size:14px;color:#4b5563;border:1px solid #e5e7eb;">${s(data.destType)}</td></tr>
      </table>
      <p style="margin:0;font-size:14px;color:#6b7280;">Questions? Contact us at <a href="mailto:help.xantexglobalmarkets@gmail.com" style="color:${accent};">help.xantexglobalmarkets@gmail.com</a>.</p>`;
  } else if (tmpl === "kyc_approved") {
    badge = `<div style="display:inline-block;background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:6px 16px;margin-bottom:20px;"><span style="font-size:13px;font-weight:700;color:#166534;">IDENTITY VERIFIED</span></div>`;
    content = `
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">Congratulations! Your identity has been successfully verified. You now have full access to all Xantex Global Markets features and services.</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#166534;">What this means for you:</p>
        <ul style="margin:0;padding-left:20px;font-size:14px;color:#4b5563;line-height:2.2;">
          <li>Full withdrawal privileges unlocked</li>
          <li>Higher deposit limits available</li>
          <li>Access to all account tiers and features</li>
          <li>Enhanced account security status</li>
        </ul>
      </div>
      <p style="margin:0;font-size:14px;color:#6b7280;">Log in to your <a href="https://xantexglobalmarkets.pro/dashboard.html" style="color:${accent};">dashboard</a> to explore all features.</p>`;
  } else if (tmpl === "profit_target_set") {
    badge = `<div style="display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:6px 16px;margin-bottom:20px;"><span style="font-size:13px;font-weight:700;color:#1e40af;">NEW TRADE CYCLE</span></div>`;
    content = `
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">A new trade cycle has been initiated on your account. Our trading team will actively work to achieve your profit target.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="background:#f8fafc;"><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;width:45%;">Profit Target</td><td style="padding:14px 18px;font-size:16px;font-weight:700;color:${accent};border:1px solid #e5e7eb;">$${s(data.amount)}</td></tr>
        ${data.label ? `<tr><td style="padding:14px 18px;font-size:13px;font-weight:600;color:#374151;border:1px solid #e5e7eb;">Cycle Label</td><td style="padding:14px 18px;font-size:14px;color:#4b5563;border:1px solid #e5e7eb;">${s(data.label)}</td></tr>` : ""}
      </table>
      <p style="margin:0;font-size:14px;color:#6b7280;">Monitor your trade cycle progress in your <a href="https://xantexglobalmarkets.pro/dashboard.html" style="color:${accent};">dashboard</a>.</p>`;
  } else if (tmpl === "plan_upgraded") {
    const planName = s(data.plan || "Premium");
    const planKey  = (data.plan || "").toUpperCase().trim();
    type PlanInfo = { fee: string; limit: string; gradient: string; features: string[] };
    const PLANS: Record<string, PlanInfo> = {
      "MASTER": { fee: "$5,000", limit: "$1,000,000", gradient: "linear-gradient(135deg,#f59e0b,#d97706)", features: ["24/7 Priority Support","Professional Charts & Analytics","SMS & Email Trade Alerts","Copy Trading Access","Advanced AI Integration & UI"] },
      "ELITE":  { fee: "$1,000", limit: "$100,000",   gradient: "linear-gradient(135deg,#7c3aed,#c084fc)", features: ["24/7 Priority Support","Professional Charts & Analytics","SMS & Email Trade Alerts","Copy Trading Access"] },
      "RAW+":   { fee: "$500",   limit: "$50,000",     gradient: "linear-gradient(135deg,#1a5cff,#00c6ff)", features: ["24/7 Priority Support","Professional Charts & Analytics"] },
    };
    const info: PlanInfo | undefined = PLANS[planKey];
    const featuresHtml = info ? info.features.map(f =>
      `<li style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;font-size:14px;color:#374151;"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${accent};flex-shrink:0;margin-top:1px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span><span>${s(f)}</span></li>`
    ).join("") : "";
    const limitBadge = info ? `<div style="display:flex;align-items:center;gap:10px;background:${accent}18;border:1px solid ${accent}44;border-radius:8px;padding:12px 16px;margin-top:20px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${accent}" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg><span style="font-size:13px;font-weight:700;color:${accent};">Balance Limit: ${s(info.limit)}</span></div>` : "";
    badge = `<div style="display:inline-block;background:${accent}18;border:1px solid ${accent}55;border-radius:6px;padding:6px 16px;margin-bottom:20px;"><span style="font-size:13px;font-weight:700;color:${accent};">ACCOUNT UPGRADED</span></div>`;
    content = `
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">Your Xantex Global Markets account has been upgraded to the <strong style="color:${accent};">${planName}</strong> tier. Welcome to an enhanced trading experience.</p>
      <div style="background:${info?.gradient ?? `linear-gradient(135deg,#060d1f,#0d1b3e)`};border-radius:12px;padding:28px;margin-bottom:24px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.12em;color:rgba(255,255,255,0.65);text-transform:uppercase;">Your New Plan</p>
        <p style="margin:0;font-size:36px;font-weight:800;color:#fff;letter-spacing:-0.5px;">${planName}</p>
      </div>
      ${featuresHtml ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;"><p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#0d1117;">What's included in your plan:</p><ul style="margin:0;padding:0;list-style:none;">${featuresHtml}</ul>${limitBadge}</div>` : ""}
      <p style="margin:0;font-size:14px;color:#6b7280;">Log in to your <a href="https://xantexglobalmarkets.pro/dashboard.html" style="color:${accent};">dashboard</a> to explore your new benefits.</p>`;
  }

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${s(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:48px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#060d1f;border-radius:14px 14px 0 0;padding:16px 40px;text-align:center;">
        <img src="https://xantexglobalmarkets.pro/images/logo.png" alt="Xantex Global Markets" height="100" style="display:block;margin:0 auto;height:100px;">
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,${accent} 0%,${accent}bb 100%);height:4px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="background:#ffffff;padding:44px 44px 32px;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;color:${accent};text-transform:uppercase;">Xantex Global Markets</p>
        <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#0d1117;line-height:1.3;">${s(subject)}</h1>
        <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">${greeting}</p>
        ${badge}
        ${content}
      </td></tr>
      <tr><td style="background:#f8fafc;border-left:1px solid #e2e6ee;border-right:1px solid #e2e6ee;padding:24px 44px;">
        <p style="margin:0 0 12px;font-size:13px;color:#4b5563;line-height:1.7;">If you require assistance, contact our support team at <a href="mailto:help.xantexglobalmarkets@gmail.com" style="color:${accent};text-decoration:none;">help.xantexglobalmarkets@gmail.com</a>.</p>
        <p style="margin:0;font-size:13px;color:#4b5563;line-height:1.7;">Warm regards,<br><strong style="color:#0d1117;">Xantex Global Markets</strong><br>Client Relations Team</p>
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

function buildEmailHtml(subject: string, recipientName: string, bodyText: string): string {
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = recipientName ? `Dear ${safe(recipientName)},` : "Dear Valued Client,";
  const bodyHtml = safe(bodyText)
    .replace(/\*([^*\n]+)\*/g, (_m, t) => `<strong style="color:#1a5cff;text-transform:uppercase;">${t}</strong>`)
    .replace(/#([^#\n]+)#/g, (_m, t) => `<strong>${t}</strong>`)
    .replace(/\n/g, "<br>");

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
        <td style="background:#060d1f;border-radius:14px 14px 0 0;padding:16px 40px;text-align:center;">
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
