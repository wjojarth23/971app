import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

export async function getAuthHeader() {
	const { data } = await supabase.auth.getSession();
	const token = data?.session?.access_token;
	return token ? { Authorization: `Bearer ${token}` } : {};
}
