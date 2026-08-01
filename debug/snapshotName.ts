/** Snapshot files are plain JSON dumps named `<label>-<timestamp>.json`. */
export const SNAPSHOT_EXTENSION = ".json";

/** Guards RPC-supplied file names so they can only ever address the debug directory. */
const SNAPSHOT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*\.json$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats a capture time as `20260101T14:37:01`, in local time so snapshot names
 * line up with the wall clock of whoever is debugging.
 */
export function formatSnapshotTimestamp(date: Date = new Date()): string {
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${datePart}T${timePart}`;
}

/** Replaces anything that would be awkward in a file name, so ids stay recognizable. */
export function sanitizeSnapshotLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

/** True when `name` is a bare snapshot file name that cannot escape the debug directory. */
export function isValidSnapshotName(name: string): boolean {
  return SNAPSHOT_FILE_PATTERN.test(name) && !name.includes("..");
}
