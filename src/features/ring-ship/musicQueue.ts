export function shuffledSongs<T extends { id: string }>(songs: readonly T[], previousId?: string): T[] {
  const shuffled = [...songs];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return [...shuffled.filter(song => song.id !== previousId), ...shuffled.filter(song => song.id === previousId)];
}
