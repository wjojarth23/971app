// Which match recordings are safe to delete. Kept pure and separate from the
// endpoint because this decides what gets permanently destroyed, and that
// judgement deserves to be readable and directly testable.
//
// Deliberately conservative on every axis:
//   * Opt-in only. With no retention window configured nothing is ever
//     deleted - there is no sensible default number of days to guess on
//     someone else's behalf.
//   * A recording is only eligible once its run has been RELEASED. Video is
//     the evidence behind a reviewer's decision; deleting it before that
//     decision has been made and pushed into scouting data would destroy the
//     only way to check the model's work.
//   * Only the video file goes. Tracks, observations, discrepancies and the
//     audit trail all stay - what is reclaimed is bulk storage, not the
//     analysis or its provenance.

export function retentionDaysFrom(envLike = {}) {
  const raw = Number(envLike?.VISION_RECORDING_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * @param views rows of vision_views joined to their match and its runs
 * @returns the subset whose video file may be deleted now
 */
export function selectExpiredRecordings(views, { retentionDays, now = Date.now() } = {}) {
  if (!retentionDays) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return (views || []).filter((view) => {
    if (!view?.storage_path || view.recording_deleted_at) return false;
    const runs = view.vision_matches?.vision_runs || [];
    const released = runs.filter((run) => run.released_at);
    // No released run means the reviewer's work either isn't done or was
    // never acted on - either way the evidence still matters.
    if (!released.length) return false;
    // Measure from the most recent release, not the first: a re-release means
    // someone was still working with this match.
    const newestRelease = Math.max(...released.map((run) => new Date(run.released_at).getTime()));
    return Number.isFinite(newestRelease) && newestRelease < cutoff;
  });
}
