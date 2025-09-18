import { redirect } from '@sveltejs/kit';

export async function load() {
  // Legacy path; kitting is now a standalone route
  throw redirect(307, '/kitting');
}
