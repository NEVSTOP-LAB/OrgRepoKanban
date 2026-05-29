export function toggleSelection(
  current: Set<string>,
  repoName: string,
  additive: boolean,
): Set<string> {
  if (!additive) {
    return new Set([repoName])
  }

  const next = new Set(current)
  if (next.has(repoName)) {
    next.delete(repoName)
  } else {
    next.add(repoName)
  }

  return next
}
