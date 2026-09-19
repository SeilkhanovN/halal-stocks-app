import './Footer.css'

interface FooterProps {
  dataAsOf: string | null | undefined
}

// Exporting a plain string constant alongside the component doesn't trip
// react-refresh/only-export-components (unlike StatusFilter's exported
// STATUS_OPTION_LABELS object, which does need the disable comment) — the
// rule's allowConstantExport option permits primitive constant exports.
export const DISCLAIMER =
  'Automated screen based on AAOIFI financial ratios only — revenue from non-permissible business lines is not analysed. Not a fatwa or financial advice.'

// `undefined` (before the first successful fetch) is treated the same as
// `null`: there is no formatted value to show before data exists either.
// The PRD only names `null`; this is a deliberate small extension, not a
// conflict with it.
function formatDataAsOf(dataAsOf: string | null | undefined): string {
  if (dataAsOf == null) {
    return 'Data date unavailable'
  }
  const date = new Date(dataAsOf)
  if (Number.isNaN(date.getTime())) {
    return 'Data date unavailable'
  }
  return `Data as of ${new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)}`
}

export function Footer({ dataAsOf }: FooterProps) {
  return (
    <footer className="app-footer">
      <p>{DISCLAIMER}</p>
      <p>{formatDataAsOf(dataAsOf)}</p>
    </footer>
  )
}
