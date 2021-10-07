/// Clean up some player-input string.
export function sanify(desc: string): string {
  const pruned = desc.trim().replace(/[^\w\s,.'";:()<>!?&$%#/+=~-]/g, '');
  return pruned.replace(/\s+/g, ' ').trim().slice(0, 300);
}
