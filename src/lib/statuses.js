// Centralized status display helpers for manufacturing/router UI
// Keep this file minimal: it maps DB status + router_meta into the
// canonical display labels used across the app.

export const DISPLAY_ORDER = ['Pending','Autocammed','In Progress','CAM Review Ready','CAM Reviewed','TravisProgged','Machined','Kitted'];

export const BUTTONS = {
  PENDING: 'Pending',
  AUTOCAMMED: 'Autocammed',  // NEW: Part has been auto-CAMmed, awaiting review
  IN_PROGRESS: 'In Progress',
  CAM_REVIEW_READY: 'CAM Review Ready',
  CAM_REVIEWED: 'CAM Reviewed',
  TRAVIS: 'TravisProgged',
  MACHINED: 'Machined',
  KITTED: 'Kitted'
};

// Workflow-specific progress steps
// Each workflow has its own set of statuses that make sense for that process
export const WORKFLOW_STATUSES = {
  'router': [
    { value: 'pending', label: 'Pending' },
    { value: 'autocammed', label: 'Autocammed' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'cam_review', label: 'CAM Review Ready' },
    { value: 'cammed', label: 'CAM Reviewed' },
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

// Get statuses for a specific workflow (returns router statuses as default fallback)
export function getWorkflowStatuses(workflow) {
  return WORKFLOW_STATUSES[workflow] || WORKFLOW_STATUSES['router'];
}

// status: raw part.status from DB (e.g. 'pending','autocammed','in-progress','cammed','machined','kitted')
// meta: parsed file_url JSON (may contain router_meta.step and/or travis_progged flag)
export function getDisplayStatus(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  // If the router meta says cam_review, force the CAM Review Ready label
  if (step === 'cam_review') return BUTTONS.CAM_REVIEW_READY;

  // Status-only mapping
  if (status === 'pending') return BUTTONS.PENDING;
  if (status === 'autocammed') return BUTTONS.AUTOCAMMED;  // NEW: Autocammed status
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
  if (status === 'autocammed') return 'status-autocammed';  // NEW: Autocammed badge
  if (status === 'cam_review' || status === 'cammed') return 'status-cammed';
  if (status === 'in-progress') return 'status-progress';
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
