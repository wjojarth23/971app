// Centralized status display helpers for manufacturing/router UI
// Keep this file minimal: it maps DB status + router_meta into the
// canonical display labels used across the app.

export const DISPLAY_ORDER = ['Pending','In Progress','CAM Review Pending','CAM Reviewed','Postprocessed','Jprogged','Machined','Kitted'];

export const BUTTONS = {
  PENDING: 'Pending',
  AUTOCAMMED: 'Autocammed',  // Part has been auto-CAMmed, awaiting review (special button, not in dropdown)
  IN_PROGRESS: 'In Progress',
  CAM_REVIEW_PENDING: 'CAM Review Pending',
  CAM_REVIEWED: 'CAM Reviewed',
  POSTPROCESSED: 'Postprocessed',
  JPROGGED: 'Jprogged',
  MACHINED: 'Machined',
  KITTED: 'Kitted'
};

// Workflow-specific progress steps
// Each workflow has its own set of statuses that make sense for that process
export const WORKFLOW_STATUSES = {
  'router': [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'cam_review', label: 'CAM Review Pending' },
    { value: 'cammed', label: 'CAM Reviewed' },
    { value: 'postprocessed', label: 'Postprocessed' },
    { value: 'jprogged', label: 'Jprogged' },
    { value: 'machined', label: 'Machined' },
    { value: 'complete', label: 'Kitted' }
  ],
  '3d-print': [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'print-started', label: 'Print Started' },
    { value: 'complete', label: 'Complete' }
  ],
  'lathe': [
    { value: 'pending', label: 'Pending' },
    { value: 'drawing', label: 'Drawing In Progress' },
    { value: 'ready', label: 'Ready to Machine' },
    { value: 'machining', label: 'Machining' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'complete', label: 'Done' }
  ],
  'mill': [
    { value: 'pending', label: 'Pending' },
    { value: 'drawing', label: 'Drawing In Progress' },
    { value: 'machining', label: 'Machining' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'complete', label: 'Done' }
  ],
  'laser-cut': [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' }
  ]
};

// Unified status set shown for ALL part workflows.
export const ALL_STATUSES = WORKFLOW_STATUSES['router'];

// Get statuses for a part. We now use a single unified status set across every
// workflow so all parts share the same pipeline (Pending -> ... -> Kitted).
export function getWorkflowStatuses(_workflow) {
  return ALL_STATUSES;
}

// status: raw part.status from DB (e.g. 'pending','autocammed','in-progress','cammed','machined','kitted')
// meta: parsed file_url JSON (may contain router_meta.step and/or travis_progged flag)
export function getDisplayStatus(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  // If the router meta says cam_review, force the CAM Review Pending label
  if (step === 'cam_review') return BUTTONS.CAM_REVIEW_PENDING;

  // Status-only mapping
  if (status === 'pending') return BUTTONS.PENDING;
  if (status === 'autocammed') return BUTTONS.AUTOCAMMED;
  if (status === 'in-progress') return BUTTONS.IN_PROGRESS;
  if (status === 'cam_review') return BUTTONS.CAM_REVIEW_PENDING;
  if (status === 'cammed') return BUTTONS.CAM_REVIEWED;
  if (status === 'postprocessed') return BUTTONS.POSTPROCESSED;
  if (status === 'jprogged') return BUTTONS.JPROGGED;
  if (status === 'machined' || status === 'inspected') return BUTTONS.MACHINED;
  if (status === 'kitted' || status === 'complete') return BUTTONS.KITTED;
  if (typeof status === 'string') return status.charAt(0).toUpperCase() + status.slice(1);
  return '';
}

// Return a CSS class for the status badge based on status/meta
export function getBadgeClass(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  if (step === 'cam_review') return 'status-cammed';
  if (status === 'autocammed') return 'status-autocammed';
  if (status === 'cam_review' || status === 'cammed') return 'status-cammed';
  if (status === 'in-progress') return 'status-progress';
  if (status === 'postprocessed') return 'status-postprocessed';
  if (status === 'jprogged') return 'status-jprogged';
  if (status === 'machined' || status === 'inspected') return 'status-progress';
  if (status === 'complete' || status === 'kitted') return 'status-complete';
  return 'status-pending';
}

// Check if a part is eligible for autocam (sheet stock with router workflow)
export function isAutocamEligible(part, stockData) {
  if (!part || part.workflow !== 'router') return false;
  
  // Check if stock assignment is a sheet type
  const stockId = part.stock_assignment;
  if (!stockId) return false;
  
  // Check router stocks for sheet dimension
  const routerStocks = stockData?.router || [];
  const stock = routerStocks.find(s => s.id === stockId);
  return stock?.dimensions === 'Sheet';
}

export default {
  DISPLAY_ORDER,
  BUTTONS,
  WORKFLOW_STATUSES,
  getWorkflowStatuses,
  getDisplayStatus,
  getBadgeClass,
  isAutocamEligible
};
