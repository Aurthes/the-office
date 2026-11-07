// Keep the split width identical to the existing CSS clamp and drag bounds.
export function sessionListWidth(total: number, preferred?: number, defaultWidth = 240) {
  return Math.max(96, Math.min(preferred ?? Math.min(defaultWidth, total * .4), 360, total / 2, total - 212));
}

export function sessionListNeedsOverlay(total: number, preferred: number | undefined, divider: number, defaultWidth = 240) {
  return total - sessionListWidth(total, preferred, defaultWidth) - divider < 440;
}
