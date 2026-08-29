// Default header tabs shown to a user before they customize their navigation.
//
// Single source of truth shared by:
//   - src/routes/+layout.svelte  (fallback nav when header_tabs is null/empty)
//   - src/routes/profile/+page.svelte (seed list when a user first customizes)
//
// Grouped into three real sections (folders - a fully-supported existing nav
// concept, see buildNavItems/toLinkItem in +layout.svelte, not new UI) per
// direct feedback that a flat list of ~10 top-level tabs read as clutter for
// anyone not touching most of them day to day. Order (Home, Purchasing,
// Manufacturing, CAD, Competition, Docs, Admin) is also per direct feedback:
//   - Manufacturing: the shop-floor tools (manufacture tracking, AutoCAM,
//     Kitting, COTS Stocking) - "whatever else we add" here later just needs
//     a new entry in manufacturingChildren below.
//   - CAD: CAD and Build combined into one group, since Build is really a
//     CAD sub-concern (already lives at /cad/build).
//   - Competition: the active scouting surfaces. Legacy scouting routes stay
//     in the codebase for a future restoration but are deliberately not
//     included in the default menu.
//   - Purchasing and Docs: stand alone.
//
// Home is rendered separately and always first; Admin is appended for
// admins by the layout, always last. Planner/Tasks/etc. remain opt-in via
// the "Add tab" UI on the profile page - not part of this reorg, unmentioned
// in the feedback that prompted it.
//
// Note: this only changes what a user with NO saved header_tabs sees.
// Anyone who has already customized their nav keeps their own saved layout
// - same limitation already hit once before (see the Docs tab's git
// history) - there's no automatic re-migration of existing customizations.
import navigation from '$lib/navigation.json';

export function defaultHeaderTabs(navConfig = navigation) {
  const tabs = [];

  tabs.push({ type: 'tab', key: 'purchasing', label: 'Purchasing' });

  const manufacturingChildren = [];
  if (navConfig?.tabs?.manufacture !== false) manufacturingChildren.push({ key: 'manufacture', label: 'Manufacture' });
  if (navConfig?.tabs?.autocam !== false) manufacturingChildren.push({ key: 'autocam', label: 'AutoCAM' });
  if (navConfig?.tabs?.kitting !== false) manufacturingChildren.push({ key: 'kitting', label: 'Kitting' });
  if (navConfig?.tabs?.['cots-stocking'] !== false) manufacturingChildren.push({ key: 'cots-stocking', label: 'COTS Stocking' });
  if (manufacturingChildren.length) {
    tabs.push({ type: 'folder', label: 'Manufacturing', children: manufacturingChildren });
  }

  const cadChildren = [{ key: 'cad', label: 'CAD' }];
  if (navConfig?.tabs?.build !== false) cadChildren.push({ key: 'build', label: 'Build' });
  tabs.push({ type: 'folder', label: 'CAD', children: cadChildren });

  tabs.push({
    type: 'folder',
    label: 'Competition',
    children: [
      { key: 'scouting', label: 'Data Scouting' },
      { key: 'pitscout', label: 'Pit Scouting' },
      { key: 'matchscout', label: 'Match Scouting' },
      { key: 'vision', label: 'Vision Scouting' }
    ]
  });

  tabs.push({ type: 'tab', key: 'docs', label: 'Docs' });

  return tabs;
}
