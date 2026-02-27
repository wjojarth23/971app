export async function fetchActiveScoutingEventKey(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('/api/scouting-config');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) return null;
    return String(data?.data?.event_key || '').trim() || null;
  } catch {
    return null;
  }
}
