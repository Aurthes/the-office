// Keep the split width identical to the existing CSS clamp and drag bounds.
export function sessionListWidth(total: number, preferred = Math.min(240, total * .4)) {
  return Math.max(96, Math.min(preferred, 360, total / 2, total - 212));
}

export function sessionListNeedsOverlay(total: number, preferred: number | undefined, divider: number) {
  return total - sessionListWidth(total, preferred) - divider < 440;
}
