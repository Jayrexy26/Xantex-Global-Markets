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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  // Verify the caller's JWT
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // Verify the caller is an admin
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: adminRow } = await adminClient
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()
  if (!adminRow) return json({ error: 'Forbidden' }, 403)

  // Get target user ID from request body
  let targetUserId: string
  try {
    const body = await req.json()
    targetUserId = body?.userId
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!targetUserId) return json({ error: 'userId is required' }, 400)

  // Prevent self-deletion
  if (targetUserId === user.id) return json({ error: 'Cannot delete your own account' }, 400)

  // Delete the user from auth (cascades to profiles and related tables)
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
  if (deleteErr) return json({ error: deleteErr.message }, 500)

  return json({ success: true })
})
