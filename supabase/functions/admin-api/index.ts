import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Auth ────────────────────────────────────────────────────────────────────

async function authenticate(req: Request, db: ReturnType<typeof createClient>): Promise<string> {
  const adminId     = req.headers.get('x-admin-id')     ?? '';
  const adminSecret = req.headers.get('x-admin-secret') ?? '';

  if (!adminId || !adminSecret) throw new AuthError('Missing admin credentials');

  const expectedSecret = Deno.env.get('ADMIN_SECRET') ?? '';
  if (!expectedSecret) throw new AuthError('Server misconfigured: ADMIN_SECRET not set');
  if (adminSecret !== expectedSecret) throw new AuthError('Invalid admin credentials');

  // Verify admin ID exists in admin_users table
  const { data, error } = await db.from('admin_users').select('user_id').eq('user_id', adminId).maybeSingle();
  if (error || !data) throw new AuthError('Admin ID not authorised');

  return adminId;
}

class AuthError extends Error { isAuth = true; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fmtUser(u: Record<string, unknown>) {
  return {
    id:           u.id,
    email:        u.email,
    name:         u.full_name ?? u.email,
    full_name:    u.full_name,
    phone:        u.phone,
    country:      u.country,
    balance:      u.balance ?? 0,
    notes:        u.notes,
    avatar_url:   u.avatar_url,
    trades_active: u.trades_active ?? 0,
    trade_percent: u.trade_percent ?? 0,
    status:       'active',
    kyc_status:   'pending',
    created_at:   u.updated_at,
  };
}

function fmtDeposit(d: Record<string, unknown>) {
  return {
    id:         d.id,
    user_name:  d.user_email,
    user_email: d.user_email,
    amount:     d.amount,
    asset:      d.asset,
    network:    d.network,
    tx_hash:    d.tx_hash,
    proof_url:  d.proof_url,
    status:     d.status,
    admin_note: d.admin_note,
    created_at: d.created_at,
    type:       'deposit',
  };
}

function fmtWithdrawal(w: Record<string, unknown>) {
  return {
    id:             w.id,
    user_name:      w.user_email,
    user_email:     w.user_email,
    amount:         w.amount,
    asset:          w.asset,
    network:        w.network,
    wallet_address: w.wallet_address,
    method:         w.method,
    status:         w.status,
    admin_note:     w.admin_note,
    created_at:     w.created_at,
    updated_at:     w.updated_at,
    refunded:       w.refunded,
  };
}

function fmtTransaction(t: Record<string, unknown>) {
  return {
    id:          t.id,
    user_name:   t.target_user_email,
    user_email:  t.target_user_email,
    type:        t.action_type,
    amount:      t.amount,
    balance_before: t.old_balance,
    balance_after:  t.new_balance,
    note:        t.note,
    admin:       t.admin_identifier,
    created_at:  t.created_at,
    status:      'completed',
  };
}

// ─── Action handlers ─────────────────────────────────────────────────────────

async function listUsers(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  const { data, error } = await db.from('users').select('*').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ok({ users: (data ?? []).map(fmtUser) });
}

async function listKYC(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  // No dedicated kyc_submissions table; derive from users with notes or trade data
  const { data, error } = await db.from('users').select('id, email, full_name, country, updated_at, notes').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const kyc = (data ?? []).map(u => ({
    id:          u.id,
    user_id:     u.id,
    user_email:  u.email,
    user_name:   u.full_name ?? u.email,
    country:     u.country,
    status:      'pending',
    submitted_at: u.updated_at,
    notes:       u.notes,
  }));
  return ok({ kyc });
}

async function listAccounts(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  const { data, error } = await db.from('users').select('id, email, full_name, balance, trades_active, trade_percent, updated_at').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const accounts = (data ?? []).map(u => ({
    id:           u.id,
    user_id:      u.id,
    user_email:   u.email,
    user_name:    u.full_name ?? u.email,
    balance:      u.balance ?? 0,
    trades_active: u.trades_active ?? 0,
    trade_percent: u.trade_percent ?? 0,
    account_type: 'live',
    status:       'active',
    created_at:   u.updated_at,
  }));
  return ok({ accounts });
}

async function listDeposits(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  const { data, error } = await db.from('deposits').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ok({ deposits: (data ?? []).map(fmtDeposit) });
}

async function listWithdrawals(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  const { data, error } = await db.from('withdrawals').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ok({ withdrawals: (data ?? []).map(fmtWithdrawal) });
}

async function listTransactions(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  const { data, error } = await db.from('admin_actions_log').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ok({ transactions: (data ?? []).map(fmtTransaction) });
}

async function listPositions(db: ReturnType<typeof createClient>, _payload: Record<string, unknown>) {
  // Return empty — no positions/trades table in live DB
  return ok({ positions: [] });
}

async function adminApproveDeposit(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const depositId = payload.deposit_id as string;
  if (!depositId) throw new Error('deposit_id required');

  // Fetch deposit
  const { data: dep, error: depErr } = await db.from('deposits').select('*').eq('id', depositId).single();
  if (depErr || !dep) throw new Error('Deposit not found');
  if (dep.status !== 'pending') throw new Error(`Deposit is already ${dep.status}`);

  // Fetch user balance
  const { data: user, error: userErr } = await db.from('users').select('id, balance').eq('email', dep.user_email).single();
  if (userErr || !user) throw new Error('User not found for deposit');

  const oldBalance = Number(user.balance ?? 0);
  const amount     = Number(dep.amount);
  const newBalance = oldBalance + amount;

  // Update deposit status
  const { error: updErr } = await db.from('deposits').update({ status: 'approved' }).eq('id', depositId);
  if (updErr) throw new Error(updErr.message);

  // Credit user balance
  const { error: balErr } = await db.from('users').update({ balance: newBalance }).eq('id', user.id);
  if (balErr) { await db.from('deposits').update({ status: 'pending' }).eq('id', depositId); throw new Error(balErr.message); }

  // Audit log
  await db.from('admin_actions_log').insert({
    action_type:       'approve_deposit',
    target_user_email: dep.user_email,
    amount,
    old_balance:       oldBalance,
    new_balance:       newBalance,
    note:              `Deposit ID: ${depositId}`,
    admin_identifier:  adminId,
  });

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminRejectDeposit(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const depositId = payload.deposit_id as string;
  if (!depositId) throw new Error('deposit_id required');

  const { data: dep, error: depErr } = await db.from('deposits').select('*').eq('id', depositId).single();
  if (depErr || !dep) throw new Error('Deposit not found');
  if (dep.status !== 'pending') throw new Error(`Deposit is already ${dep.status}`);

  const { error } = await db.from('deposits').update({ status: 'rejected' }).eq('id', depositId);
  if (error) throw new Error(error.message);

  await db.from('admin_actions_log').insert({
    action_type:       'reject_deposit',
    target_user_email: dep.user_email,
    amount:            dep.amount,
    note:              `Deposit ID: ${depositId}`,
    admin_identifier:  adminId,
  });

  return ok({ success: true });
}

async function adminApproveWithdrawal(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const withdrawalId = payload.withdrawal_id as string;
  if (!withdrawalId) throw new Error('withdrawal_id required');

  const { data: wd, error: wdErr } = await db.from('withdrawals').select('*').eq('id', withdrawalId).single();
  if (wdErr || !wd) throw new Error('Withdrawal not found');
  if (wd.status !== 'pending') throw new Error(`Withdrawal is already ${wd.status}`);

  const { data: user, error: userErr } = await db.from('users').select('id, balance').eq('email', wd.user_email).single();
  if (userErr || !user) throw new Error('User not found for withdrawal');

  const oldBalance = Number(user.balance ?? 0);
  const amount     = Number(wd.amount);

  if (oldBalance < amount) throw new Error(`Insufficient balance: $${oldBalance.toFixed(2)} available`);

  const newBalance = oldBalance - amount;

  const { error: updErr } = await db.from('withdrawals').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', withdrawalId);
  if (updErr) throw new Error(updErr.message);

  const { error: balErr } = await db.from('users').update({ balance: newBalance }).eq('id', user.id);
  if (balErr) { await db.from('withdrawals').update({ status: 'pending' }).eq('id', withdrawalId); throw new Error(balErr.message); }

  await db.from('admin_actions_log').insert({
    action_type:       'approve_withdrawal',
    target_user_email: wd.user_email,
    amount,
    old_balance:       oldBalance,
    new_balance:       newBalance,
    note:              `Withdrawal ID: ${withdrawalId}`,
    admin_identifier:  adminId,
  });

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminRejectWithdrawal(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const withdrawalId = payload.withdrawal_id as string;
  if (!withdrawalId) throw new Error('withdrawal_id required');

  const { data: wd, error: wdErr } = await db.from('withdrawals').select('*').eq('id', withdrawalId).single();
  if (wdErr || !wd) throw new Error('Withdrawal not found');
  if (wd.status !== 'pending') throw new Error(`Withdrawal is already ${wd.status}`);

  const { error } = await db.from('withdrawals').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', withdrawalId);
  if (error) throw new Error(error.message);

  await db.from('admin_actions_log').insert({
    action_type:       'reject_withdrawal',
    target_user_email: wd.user_email,
    amount:            wd.amount,
    note:              `Withdrawal ID: ${withdrawalId}`,
    admin_identifier:  adminId,
  });

  return ok({ success: true });
}

async function adminAdjustBalance(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const accountId = payload.account_id as string;
  const amount    = Number(payload.amount);
  const type      = payload.type as string; // 'credit' | 'debit' | 'set'
  const reason    = (payload.reason as string) ?? '';

  if (!accountId) throw new Error('account_id required');
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
  if (!['credit', 'debit', 'set'].includes(type)) throw new Error('type must be credit, debit, or set');

  // account_id = user id
  const { data: user, error: userErr } = await db.from('users').select('id, email, balance').eq('id', accountId).single();
  if (userErr || !user) throw new Error('User account not found');

  const oldBalance = Number(user.balance ?? 0);
  let newBalance: number;

  if (type === 'credit')     newBalance = oldBalance + amount;
  else if (type === 'debit') newBalance = oldBalance - amount;
  else                       newBalance = amount;

  if (newBalance < 0) throw new Error('Balance cannot go negative');

  const { error: balErr } = await db.from('users').update({ balance: newBalance }).eq('id', accountId);
  if (balErr) throw new Error(balErr.message);

  await db.from('admin_actions_log').insert({
    action_type:       `balance_${type}`,
    target_user_email: user.email,
    amount,
    old_balance:       oldBalance,
    new_balance:       newBalance,
    note:              reason,
    admin_identifier:  adminId,
  });

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminCompletePlan(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  // No positions table — this is a no-op that returns success
  // If a positions/trades table is added later, implement here
  const positionId = payload.position_id as string;
  if (!positionId) throw new Error('position_id required');

  await db.from('admin_actions_log').insert({
    action_type:      'force_close_position',
    note:             `Position ID: ${positionId}`,
    admin_identifier: adminId,
  });

  return ok({ success: true });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const HANDLERS: Record<string, (db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) => Promise<Response>> = {
  list_users:               (db, p)         => listUsers(db, p),
  list_kyc:                 (db, p)         => listKYC(db, p),
  list_accounts:            (db, p)         => listAccounts(db, p),
  list_deposits:            (db, p)         => listDeposits(db, p),
  list_withdrawals:         (db, p)         => listWithdrawals(db, p),
  list_transactions:        (db, p)         => listTransactions(db, p),
  list_positions:           (db, p)         => listPositions(db, p),
  admin_approve_deposit:    (db, p, id)     => adminApproveDeposit(db, p, id),
  admin_reject_deposit:     (db, p, id)     => adminRejectDeposit(db, p, id),
  admin_approve_withdrawal: (db, p, id)     => adminApproveWithdrawal(db, p, id),
  admin_reject_withdrawal:  (db, p, id)     => adminRejectWithdrawal(db, p, id),
  admin_adjust_balance:     (db, p, id)     => adminAdjustBalance(db, p, id),
  admin_complete_plan:      (db, p, id)     => adminCompletePlan(db, p, id),
};

// ─── Entry point ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl        = Deno.env.get('SUPABASE_URL')         ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    const adminId = await authenticate(req, db);
    const body    = await req.json() as Record<string, unknown>;
    const action  = body.action as string;

    if (!action) return err('action is required');

    const handler = HANDLERS[action];
    if (!handler) return err(`Unknown action: ${action}`, 404);

    return await handler(db, body, adminId);

  } catch (e: unknown) {
    const error = e as { isAuth?: boolean; message?: string };
    if (error.isAuth) return err(error.message ?? 'Unauthorized', 401);
    console.error('[admin-api]', error);
    return err(error.message ?? 'Internal error', 500);
  }
});
