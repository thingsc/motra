/** @deprecated STEP 1.5 uses the full SettingsPage. Kept as a compatibility marker for STEP 1 specs. */
export function SettingsPopover({ onClose }: { onClose: () => void }): JSX.Element {
  return <button onClick={onClose}>Settings moved to page</button>
}
