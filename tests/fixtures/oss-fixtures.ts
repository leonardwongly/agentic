export const TEST_REPOSITORY_FULL_NAME = "octo-org/demo-agentic";
export const TEST_REPOSITORY_HTML_URL = `https://github.com/${TEST_REPOSITORY_FULL_NAME}`;

export function testRepositoryIssueUrl(issueNumber: number): string {
  return `${TEST_REPOSITORY_HTML_URL}/issues/${issueNumber}`;
}
