/**
 * Client-side gate for files headed to POST /api/detect and /api/scans. The server enforces the same limits
 * (ripple/server/app.py MAX_UPLOAD_BYTES / MAX_FILES); checking here gives an immediate, friendly message instead of a
 * failed upload. Files are never read by the page: they go straight into FormData, so nothing is parsed or rendered
 * client-side.
 */
export const MAX_FILES = 64
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024

export interface UploadCheck {
  accepted: File[]
  /** Human-readable reasons, safe to render (file names are truncated). */
  problems: string[]
}

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s)
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

export function checkUpload(files: File[]): UploadCheck {
  const accepted: File[] = []
  const problems: string[] = []
  let total = 0
  for (const f of files) {
    if (accepted.length >= MAX_FILES) { problems.push(`Only the first ${MAX_FILES} files were kept.`); break }
    if (f.size === 0) { problems.push(`${short(f.name)} is empty, so it was skipped.`); continue }
    if (total + f.size > MAX_TOTAL_BYTES) { problems.push(`${short(f.name)} was skipped: uploads are limited to ${mb(MAX_TOTAL_BYTES)} in total.`); continue }
    total += f.size
    accepted.push(f)
  }
  return { accepted, problems }
}

/** True when a drop contains a directory (browsers hand those over as bogus zero-byte "files"). */
export function dropHasDirectory(dt: DataTransfer | null): boolean {
  if (!dt || !dt.items) return false
  for (const it of Array.from(dt.items)) {
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.()
    if (entry?.isDirectory) return true
  }
  return false
}
