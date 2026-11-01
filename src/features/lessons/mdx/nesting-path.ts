export function validNestingPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length === 3 && parts.every((part) => part.length > 0 && part === part.trim());
}
