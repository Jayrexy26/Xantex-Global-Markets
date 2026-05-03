import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-id, x-admin-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Auth ────────────────────────────────────────────────────────────────────

class AuthError extends Error { isAuth = true; }

async function authenticate(req: Request, db: ReturnType<typeof createClient>): Promise<string> {
  const adminId     = req.headers.get('x-admin-id')     ?? '';
  const adminSecret = req.headers.get('x-admin-secret') ?? '';

  if (!adminId || !adminSecret) throw new AuthError('Missing admin credentials');

  const expectedSecret = Deno.env.get('ADMIN_SECRET') ?? '';
  if (!expectedSecret) throw new AuthError('Server misconfigured: ADMIN_SECRET not set');
  if (adminSecret !== expectedSecret) throw new AuthError('Invalid admin credentials');

  // admin_users.id references auth.users(id)
  const { data, error } = await db.from('admin_users').select('id').eq('id', adminId).maybeSingle();
  if (error || !data) throw new AuthError('Admin ID not authorised');

  return adminId;
}

// ─── Response helpers ────────────────────────────────────────────────────────

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

// ─── Audit helper ────────────────────────────────────────────────────────────

async function audit(db: ReturnType<typeof createClient>, adminId: string, action: string, target: string, details: string) {
  await db.from('audit_log').insert({ admin_id: adminId, action, target, details }).throwOnError();
}

// ─── Get primary live trading account for a user ─────────────────────────────

async function getPrimaryAccount(db: ReturnType<typeof createClient>, userId: string, accountId?: string) {
  if (accountId) {
    const { data } = await db.from('trading_accounts').select('id, balance').eq('id', accountId).single();
    if (data) return data;
  }
  const { data } = await db.from('trading_accounts')
    .select('id, balance')
    .eq('user_id', userId)
    .eq('type', 'live')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  return data ?? null;
}

// ─── Action handlers ─────────────────────────────────────────────────────────

async function listUsers(db: ReturnType<typeof createClient>) {
  const { data: profiles, error } = await db
    .from('profiles')
    .select('id, email, first_name, last_name, phone, country, kyc_status, status, updated_at, trades_active, trade_percent')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);

  const { data: accounts } = await db
    .from('trading_accounts')
    .select('user_id, balance, type, status')
    .eq('status', 'active');

  const balanceMap: Record<string, number> = {};
  for (const a of accounts ?? []) {
    if (a.type === 'live') balanceMap[a.user_id] = (balanceMap[a.user_id] ?? 0) + Number(a.balance ?? 0);
  }

  return ok({
    users: (profiles ?? []).map(p => ({
      id:           p.id,
      email:        p.email,
      name:         `${p.first_name} ${p.last_name}`.trim() || p.email,
      full_name:    `${p.first_name} ${p.last_name}`.trim(),
      phone:        p.phone,
      country:      p.country,
      balance:      balanceMap[p.id] ?? 0,
      kyc_status:   p.kyc_status,
      status:       p.status,
      trades_active: p.trades_active,
      trade_percent: p.trade_percent,
      created_at:   p.updated_at,
    })),
  });
}

async function listKYC(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('kyc_submissions')
    .select('id, user_id, document_type, front_url, back_url, selfie_url, status, rejection_reason, submitted_at, reviewed_at, profiles(email, first_name, last_name, country)')
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);

  return ok({
    kyc: (data ?? []).map(k => {
      const p = (k.profiles as Record<string, unknown>) ?? {};
      return {
        id:           k.id,
        user_id:      k.user_id,
        user_email:   p.email,
        user_name:    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        country:      p.country,
        document_type: k.document_type,
        front_url:    k.front_url,
        back_url:     k.back_url,
        selfie_url:   k.selfie_url,
        status:       k.status,
        rejection_reason: k.rejection_reason,
        submitted_at: k.submitted_at,
        reviewed_at:  k.reviewed_at,
      };
    }),
  });
}

async function listAccounts(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('trading_accounts')
    .select('id, user_id, account_number, platform, type, account_type, currency, balance, equity, leverage, status, created_at, profiles(email, first_name, last_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return ok({
    accounts: (data ?? []).map(a => {
      const p = (a.profiles as Record<string, unknown>) ?? {};
      return {
        id:           a.id,
        user_id:      a.user_id,
        user_email:   p.email,
        user_name:    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        account_number: a.account_number,
        platform:     a.platform,
        type:         a.type,
        account_type: a.account_type,
        currency:     a.currency,
        balance:      a.balance,
        equity:       a.equity,
        leverage:     a.leverage,
        status:       a.status,
        created_at:   a.created_at,
      };
    }),
  });
}

async function listDeposits(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('deposit_requests')
    .select('id, user_id, account_id, amount, currency, payment_method, proof_url, reference, notes, status, created_at, updated_at, profiles(email, first_name, last_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return ok({
    deposits: (data ?? []).map(d => {
      const p = (d.profiles as Record<string, unknown>) ?? {};
      return {
        id:             d.id,
        user_id:        d.user_id,
        user_email:     p.email,
        user_name:      `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        amount:         d.amount,
        currency:       d.currency,
        payment_method: d.payment_method,
        proof_url:      d.proof_url,
        reference:      d.reference,
        notes:          d.notes,
        status:         d.status,
        created_at:     d.created_at,
        type:           'deposit',
      };
    }),
  });
}

async function listWithdrawals(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('withdrawal_requests')
    .select('id, user_id, account_id, amount, currency, destination_type, destination_name, destination_ref, notes, status, created_at, updated_at, profiles(email, first_name, last_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return ok({
    withdrawals: (data ?? []).map(w => {
      const p = (w.profiles as Record<string, unknown>) ?? {};
      return {
        id:               w.id,
        user_id:          w.user_id,
        user_email:       p.email,
        user_name:        `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        amount:           w.amount,
        currency:         w.currency,
        destination_type: w.destination_type,
        destination_name: w.destination_name,
        destination_ref:  w.destination_ref,
        notes:            w.notes,
        status:           w.status,
        created_at:       w.created_at,
        updated_at:       w.updated_at,
      };
    }),
  });
}

async function listTransactions(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('transactions')
    .select('id, user_id, account_id, type, amount, status, description, reference, created_at, profiles(email, first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  return ok({
    transactions: (data ?? []).map(t => {
      const p = (t.profiles as Record<string, unknown>) ?? {};
      return {
        id:          t.id,
        user_id:     t.user_id,
        user_email:  p.email,
        user_name:   `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        type:        t.type,
        amount:      t.amount,
        status:      t.status,
        description: t.description,
        reference:   t.reference,
        created_at:  t.created_at,
      };
    }),
  });
}

async function listPositions(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from('positions')
    .select('id, user_id, account_id, symbol, direction, lots, open_price, current_price, floating_pnl, status, opened_at, profiles(email, first_name, last_name)')
    .eq('status', 'open')
    .order('opened_at', { ascending: false });
  if (error) throw new Error(error.message);

  return ok({
    positions: (data ?? []).map(pos => {
      const p = (pos.profiles as Record<string, unknown>) ?? {};
      return {
        id:           pos.id,
        user_id:      pos.user_id,
        user_email:   p.email,
        user_name:    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
        symbol:       pos.symbol,
        direction:    pos.direction,
        lots:         pos.lots,
        open_price:   pos.open_price,
        current_price: pos.current_price,
        floating_pnl: pos.floating_pnl,
        status:       pos.status,
        opened_at:    pos.opened_at,
      };
    }),
  });
}

async function adminApproveDeposit(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const depositId = payload.deposit_id as string;
  if (!depositId) throw new Error('deposit_id required');

  const { data: dep, error: depErr } = await db.from('deposit_requests').select('*').eq('id', depositId).single();
  if (depErr || !dep) throw new Error('Deposit not found');
  if (dep.status !== 'pending') throw new Error(`Deposit is already ${dep.status}`);

  const account = await getPrimaryAccount(db, dep.user_id, dep.account_id);
  if (!account) throw new Error('No active trading account found for this user');

  const oldBalance = Number(account.balance ?? 0);
  const amount     = Number(dep.amount);
  const newBalance = oldBalance + amount;

  await db.from('deposit_requests').update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', depositId);
  await db.from('trading_accounts').update({ balance: newBalance }).eq('id', account.id);
  await db.from('transactions').insert({ user_id: dep.user_id, account_id: account.id, type: 'deposit', amount: dep.amount, status: 'completed', description: 'Deposit approved by admin', reference: depositId });
  await audit(db, adminId, 'approve_deposit', dep.user_id, `$${dep.amount} deposit approved — account ${account.id}`);

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminRejectDeposit(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const depositId = payload.deposit_id as string;
  if (!depositId) throw new Error('deposit_id required');

  const { data: dep, error: depErr } = await db.from('deposit_requests').select('user_id, amount, status').eq('id', depositId).single();
  if (depErr || !dep) throw new Error('Deposit not found');
  if (dep.status !== 'pending') throw new Error(`Deposit is already ${dep.status}`);

  await db.from('deposit_requests').update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', depositId);
  await audit(db, adminId, 'reject_deposit', dep.user_id, `$${dep.amount} deposit rejected`);

  return ok({ success: true });
}

async function adminApproveWithdrawal(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const withdrawalId = payload.withdrawal_id as string;
  if (!withdrawalId) throw new Error('withdrawal_id required');

  const { data: wd, error: wdErr } = await db.from('withdrawal_requests').select('*').eq('id', withdrawalId).single();
  if (wdErr || !wd) throw new Error('Withdrawal not found');
  if (wd.status !== 'pending') throw new Error(`Withdrawal is already ${wd.status}`);

  const account = await getPrimaryAccount(db, wd.user_id, wd.account_id);
  if (!account) throw new Error('No active trading account found for this user');

  const oldBalance = Number(account.balance ?? 0);
  const amount     = Number(wd.amount);
  if (oldBalance < amount) throw new Error(`Insufficient balance: $${oldBalance.toFixed(2)} available`);
  const newBalance = oldBalance - amount;

  await db.from('withdrawal_requests').update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', withdrawalId);
  await db.from('trading_accounts').update({ balance: newBalance }).eq('id', account.id);
  await db.from('transactions').insert({ user_id: wd.user_id, account_id: account.id, type: 'withdrawal', amount: wd.amount, status: 'completed', description: 'Withdrawal approved by admin', reference: withdrawalId });
  await audit(db, adminId, 'approve_withdrawal', wd.user_id, `$${wd.amount} withdrawal approved — account ${account.id}`);

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminRejectWithdrawal(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const withdrawalId = payload.withdrawal_id as string;
  if (!withdrawalId) throw new Error('withdrawal_id required');

  const { data: wd, error: wdErr } = await db.from('withdrawal_requests').select('user_id, amount, status').eq('id', withdrawalId).single();
  if (wdErr || !wd) throw new Error('Withdrawal not found');
  if (wd.status !== 'pending') throw new Error(`Withdrawal is already ${wd.status}`);

  await db.from('withdrawal_requests').update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', withdrawalId);
  await audit(db, adminId, 'reject_withdrawal', wd.user_id, `$${wd.amount} withdrawal rejected`);

  return ok({ success: true });
}

async function adminAdjustBalance(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const accountId = payload.account_id as string; // trading_accounts.id
  const amount    = Number(payload.amount);
  const type      = payload.type as string;        // 'credit' | 'debit' | 'set'
  const reason    = (payload.reason as string) ?? '';

  if (!accountId) throw new Error('account_id required');
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
  if (!['credit', 'debit', 'set'].includes(type)) throw new Error('type must be credit, debit, or set');

  const { data: account, error: accErr } = await db.from('trading_accounts').select('id, user_id, balance').eq('id', accountId).single();
  if (accErr || !account) throw new Error('Trading account not found');

  const oldBalance = Number(account.balance ?? 0);
  let newBalance: number;
  if (type === 'credit')     newBalance = oldBalance + amount;
  else if (type === 'debit') newBalance = oldBalance - amount;
  else                       newBalance = amount;

  if (newBalance < 0) throw new Error('Balance cannot go negative');

  await db.from('trading_accounts').update({ balance: newBalance }).eq('id', accountId);
  await db.from('transactions').insert({ user_id: account.user_id, account_id: accountId, type: 'adjustment', amount, status: 'completed', description: reason });
  await audit(db, adminId, `balance_${type}`, account.user_id, `$${amount} ${type} — reason: ${reason}`);

  return ok({ success: true, balance_before: oldBalance, balance_after: newBalance });
}

async function adminCompletePlan(db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) {
  const positionId = payload.position_id as string;
  if (!positionId) throw new Error('position_id required');

  const { data: pos, error: posErr } = await db.from('positions').select('*').eq('id', positionId).single();
  if (posErr || !pos) throw new Error('Position not found');
  if (pos.status !== 'open') throw new Error('Position is not open');

  const pnl = Number(pos.floating_pnl ?? 0);
  await db.from('positions').update({ status: 'closed', closed_at: new Date().toISOString(), realised_pnl: pnl }).eq('id', positionId);

  // Credit/debit PnL to trading account
  if (pos.account_id && pnl !== 0) {
    const { data: account } = await db.from('trading_accounts').select('id, balance').eq('id', pos.account_id).single();
    if (account) {
      const newBalance = Number(account.balance ?? 0) + pnl;
      await db.from('trading_accounts').update({ balance: newBalance }).eq('id', account.id);
      await db.from('transactions').insert({ user_id: pos.user_id, account_id: pos.account_id, type: 'trade_pnl', amount: Math.abs(pnl), status: 'completed', description: `Force closed ${pos.symbol} — PnL: ${pnl >= 0 ? '+' : ''}$${pnl}` });
    }
  }

  await audit(db, adminId, 'force_close_position', pos.user_id ?? '', `Position ${positionId} (${pos.symbol}) force closed — PnL: $${pnl}`);

  return ok({ success: true, realised_pnl: pnl });
}

// ─── Router ───────────────────────────────────────────────────────────────────

type Handler = (db: ReturnType<typeof createClient>, payload: Record<string, unknown>, adminId: string) => Promise<Response>;

const HANDLERS: Record<string, Handler> = {
  list_users:               (db)         => listUsers(db),
  list_kyc:                 (db)         => listKYC(db),
  list_accounts:            (db)         => listAccounts(db),
  list_deposits:            (db)         => listDeposits(db),
  list_withdrawals:         (db)         => listWithdrawals(db),
  list_transactions:        (db)         => listTransactions(db),
  list_positions:           (db)         => listPositions(db),
  admin_approve_deposit:    (db, p, id)  => adminApproveDeposit(db, p, id),
  admin_reject_deposit:     (db, p, id)  => adminRejectDeposit(db, p, id),
  admin_approve_withdrawal: (db, p, id)  => adminApproveWithdrawal(db, p, id),
  admin_reject_withdrawal:  (db, p, id)  => adminRejectWithdrawal(db, p, id),
  admin_adjust_balance:     (db, p, id)  => adminAdjustBalance(db, p, id),
  admin_complete_plan:      (db, p, id)  => adminCompletePlan(db, p, id),
};

// ─── Entry point ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl        = Deno.env.get('SUPABASE_URL')              ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

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
