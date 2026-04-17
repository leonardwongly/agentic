export function getGoalShareSuccessMessage(title: string, copiedToClipboard: boolean): string {
  return copiedToClipboard
    ? `Copied a public share link for "${title}".`
    : `Created a public share link for "${title}".`;
}

export function getGoalShareRevocationMessage(title: string): string {
  return `Revoked the public share link for "${title}".`;
}
