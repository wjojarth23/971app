import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

export async function getAuthHeader() {
	const { data } = await supabase.auth.getSession();
	let session = data?.session;
	// getSession() reads whatever is in local storage without forcing a
	// freshness check — if this tab sat backgrounded long enough for the
	// browser to throttle Supabase's proactive refresh timer, the stored
	// token can already be expired. Sending it as-is gets a hard 401
	// ("Unauthorized") from every API route even though the user is very
	// much still logged in. Force a refresh whenever the token is expired
	// or about to expire.
	if (session?.expires_at && session.expires_at * 1000 < Date.now() + 10000) {
		const { data: refreshed } = await supabase.auth.refreshSession();
		session = refreshed?.session || session;
	}
	const token = session?.access_token;
	return token ? { Authorization: `Bearer ${token}` } : {};
}
