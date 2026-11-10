const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const secret = Deno.env.get('UT_SECOND_SURVEY_SECRET');
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!secret || !url || !serviceKey) return new Response(null, { status: 503 });
  if (request.headers.get('Authorization') !== `Bearer ${secret}`) return new Response(null, { status: 401 });
  const input = await request.json().catch(() => null);
  if (typeof input?.code !== 'string' || !uuid.test(input.code)) return new Response(null, { status: 400 });

  try {
    const result = await fetch(`${url}/rest/v1/rpc/complete_ut_second_survey`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: input.code }),
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(null, { status: result.ok ? 204 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
});
