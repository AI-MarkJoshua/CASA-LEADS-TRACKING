import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Not authenticated.' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const publishableKey = publishableKeys.default || Deno.env.get('SUPABASE_ANON_KEY')!
    const secretKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authClient = createClient(url, publishableKey)
    const adminClient = createClient(url, secretKey, { auth: { persistSession: false } })
    const token = authorization.replace('Bearer ', '')
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401)

    const { data: caller } = await adminClient.from('profiles').select('role, is_active').eq('id', authData.user.id).single()
    if (!caller?.is_active || caller.role !== 'supervisor') return json({ error: 'Supervisor access is required.' }, 403)

    const { fullName, email, password, role } = await request.json()
    if (!fullName || !email || !password || !['supervisor', 'sales'].includes(role)) {
      return json({ error: 'Full name, email, password, and a valid role are required.' }, 400)
    }
    if (password.length < 8) return json({ error: 'Password must contain at least 8 characters.' }, 400)

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    })
    if (createError) return json({ error: createError.message }, 400)

    const { error: profileError } = await adminClient.from('profiles').upsert({
      id: created.user.id,
      full_name: fullName,
      role,
      is_active: true,
    })
    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id)
      return json({ error: 'The profile could not be created.' }, 500)
    }

    return json({ user: { id: created.user.id, email: created.user.email, fullName, role } }, 201)
  } catch {
    return json({ error: 'Unexpected server error.' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
