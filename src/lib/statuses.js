// Centralized status display helpers for manufacturing/router UI
// Keep this file minimal: it maps DB status + router_meta into the
// canonical display labels used across the app.

export const DISPLAY_ORDER = ['Pending','CAM Review Ready','CAM Reviewed','TravisProgged','Machined','Kitted'];

export const BUTTONS = {
  PENDING: 'Pending',
  CAM_REVIEW_READY: 'CAM Review Ready',
  CAM_REVIEWED: 'CAM Reviewed',
  TRAVIS: 'TravisProgged',
  MACHINED: 'Machined',
  KITTED: 'Kitted'
};

// status: raw part.status from DB (e.g. 'pending','in-progress','cammed','machined','kitted')
// meta: parsed file_url JSON (may contain router_meta.step and/or travis_progged flag)
export function getDisplayStatus(status, meta) {
  // Travis/queued overrides other cam states
  if (meta?.travis_progged || (meta?.router_meta && meta.router_meta.step === 'queued')) return BUTTONS.TRAVIS;

  // Pending
  if (status === 'pending') return BUTTONS.PENDING;

  // CAM stages
  // If in-process CAMing or explicitly awaiting review -> CAM Review Ready
  if ((status === 'in-progress' && meta?.router_meta && meta.router_meta.step === 'cam_ing') || (meta?.router_meta && meta.router_meta.step === 'cam_review')) {
    return BUTTONS.CAM_REVIEW_READY;
  }

  // Underlying cammed state without review-step set => treated as CAM Reviewed
  if (status === 'cammed') return BUTTONS.CAM_REVIEWED;

  // Machined / Cut
  if (status === 'machined' || (meta?.router_meta && meta.router_meta.step === 'cut')) return BUTTONS.MACHINED;

  // Kitted / complete
  if (status === 'kitted' || status === 'complete') return BUTTONS.KITTED;

  // Default: return a capitalized fallback of raw status
  if (typeof status === 'string') return status.charAt(0).toUpperCase() + status.slice(1);
  return '';
}

// Return a CSS class for the status badge based on status/meta
export function getBadgeClass(status, meta) {
  // Travis/queued
  if (meta?.travis_progged || (meta?.router_meta && meta.router_meta.step === 'queued')) return 'status-travis';

  if (status === 'in-progress') return 'status-progress';
  if (status === 'machined' || status === 'inspected' || (meta?.router_meta && meta.router_meta.step === 'cut')) return 'status-progress';
  if (status === 'cammed') return 'status-cammed';
  if (status === 'complete' || status === 'kitted') return 'status-complete';
  return 'status-pending';
}

export default {
  DISPLAY_ORDER,
  BUTTONS,
  getDisplayStatus
  , getBadgeClass
};
