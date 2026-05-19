/** Visual sub-header rendered above the first row of each `group` inside a
 *  collapsible Section. Used by the Animations panel to break its rows into
 *  Series / X axis / Y axis / Other blocks while keeping them within a single
 *  collapsible section. */
export function GroupHeader({ label }: { label: string }) {
  return <div className="sec-group">— {label} —</div>;
}
