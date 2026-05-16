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
