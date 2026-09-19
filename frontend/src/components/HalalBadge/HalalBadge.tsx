import './HalalBadge.css'
import type { HalalStatus } from '../../api/types.ts'

interface HalalBadgeProps {
  status: HalalStatus
}

// Local to this component on purpose: HalalBadge is a leaf component and
// should not depend on StatusFilter's STATUS_OPTION_LABELS, even though the
// label text happens to match.
const LABELS: Record<HalalStatus, string> = {
  halal: 'Halal',
  not_halal: 'Not halal',
  unknown: 'Unknown',
}

const ICONS: Record<HalalStatus, string> = {
  halal: '✓',
  not_halal: '✕',
  unknown: '?',
}

export function HalalBadge({ status }: HalalBadgeProps) {
  return (
    <span className={`halal-badge halal-badge--${status}`}>
      <span className="halal-badge__icon" aria-hidden="true">
        {ICONS[status]}
      </span>
      <span className="halal-badge__label">{LABELS[status]}</span>
    </span>
  )
}
