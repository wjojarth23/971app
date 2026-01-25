// Centralized status display helpers for manufacturing/router UI
// Keep this file minimal: it maps DB status + router_meta into the
// canonical display labels used across the app.

export const DISPLAY_ORDER = ['Pending','In Progress','CAM Review Ready','CAM Reviewed','TravisProgged','Machined','Kitted'];

export const BUTTONS = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  CAM_REVIEW_READY: 'CAM Review Ready',
  CAM_REVIEWED: 'CAM Reviewed',
  TRAVIS: 'TravisProgged',
  MACHINED: 'Machined',
  KITTED: 'Kitted'
};

// status: raw part.status from DB (e.g. 'pending','in-progress','cammed','machined','kitted')
// meta: parsed file_url JSON (may contain router_meta.step and/or travis_progged flag)
export function getDisplayStatus(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  // If the router meta says cam_review, force the CAM Review Ready label
  if (step === 'cam_review') return BUTTONS.CAM_REVIEW_READY;

  // Status-only mapping
  if (status === 'pending') return BUTTONS.PENDING;
  if (status === 'in-progress') return BUTTONS.IN_PROGRESS;
  if (status === 'cam_review') return BUTTONS.CAM_REVIEW_READY;
  if (status === 'cammed') return BUTTONS.CAM_REVIEWED;
  if (status === 'machined' || status === 'inspected') return BUTTONS.MACHINED;
  if (status === 'kitted' || status === 'complete') return BUTTONS.KITTED;
  if (typeof status === 'string') return status.charAt(0).toUpperCase() + status.slice(1);
  return '';
}

// Return a CSS class for the status badge based on status/meta
export function getBadgeClass(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  if (step === 'cam_review') return 'status-cammed';
  if (status === 'cam_review' || status === 'cammed') return 'status-cammed';
  if (status === 'in-progress') return 'status-progress';
  if (status === 'machined' || status === 'inspected') return 'status-progress';
  if (status === 'complete' || status === 'kitted') return 'status-complete';
  return 'status-pending';
}

export default {
  DISPLAY_ORDER,
  BUTTONS,
  getDisplayStatus
  , getBadgeClass
};
