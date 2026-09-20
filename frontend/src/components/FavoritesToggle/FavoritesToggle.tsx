import './FavoritesToggle.css'

interface FavoritesToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
}

// A native checkbox inside a <label> gets its role and accessible name for
// free — no custom ARIA needed, unlike StatusFilter's radiogroup which needs
// an explicit legend/fieldset for its multi-option shape.
export function FavoritesToggle({ checked, onChange }: FavoritesToggleProps) {
  return (
    <label className="favorites-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Favorites only
    </label>
  )
}
