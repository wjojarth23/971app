// Default header tabs shown to a user before they customize their navigation.
//
// Single source of truth shared by:
//   - src/routes/+layout.svelte  (fallback nav when header_tabs is null/empty)
//   - src/routes/profile/+page.svelte (seed list when a user first customizes)
//
// Home is rendered separately and always present; Admin is appended for admins
// by the layout. All other tabs (Planner, Tasks, scouting, etc.) are opt-in via
// the "Add tab" UI in the profile page.
import navigation from '$lib/navigation.json';

export function defaultHeaderTabs(navConfig = navigation) {
  const tabs = [];
  if (navConfig?.tabs?.manufacture !== false) tabs.push({ type: 'tab', key: 'manufacture', label: 'Manufacture' });
  if (navConfig?.tabs?.kitting !== false) tabs.push({ type: 'tab', key: 'kitting', label: 'Kitting' });
  tabs.push({ type: 'tab', key: 'cad', label: 'CAD' });
  if (navConfig?.tabs?.build !== false) tabs.push({ type: 'tab', key: 'build', label: 'Build' });
  tabs.push({ type: 'tab', key: 'purchasing', label: 'Purchasing' });
  if (navConfig?.tabs?.['cots-stocking'] !== false) tabs.push({ type: 'tab', key: 'cots-stocking', label: 'COTS Stocking' });
  return tabs;
}
