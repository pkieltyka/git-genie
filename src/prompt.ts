import type { CommitInfo, CommitWithDiff } from "./git.js";

// ---------------------------------------------------------------------------
// Release Notes prompts
// ---------------------------------------------------------------------------

export const RELEASE_NOTES_SYSTEM_PROMPT = `You are a technical writer producing public-facing release notes.
Write clean, concise markdown release notes that describe what changed
from the user's perspective.

Guidelines:
- Do NOT include a title or header — one will be added automatically
- Focus on user-visible changes: features, fixes, improvements, breaking changes
- Group changes into logical sections using ## headings (e.g. ## Features, ## Fixes, ## Improvements, ## Breaking Changes)
- Only include sections that have content — omit empty sections
- Omit internal refactors, CI changes, and dependency bumps unless they affect users
- Be specific but concise — one line per change
- Use present tense ("Add", "Fix", "Remove", not "Added", "Fixed", "Removed")
- Do not invent changes that aren't evidenced in the data provided
- Start directly with the first section heading`;

export function buildReleaseNotesUserMessage(
  fromRef: string,
  toRef: string,
  commits: CommitInfo[]
): string {
  const commitLog = commits
    .map((c) => {
      const body = c.body ? `\n${c.body}` : "";
      return `- ${c.shortHash} ${c.subject} (${c.author}, ${c.date})${body}`;
    })
    .join("\n");

  return `Here are the git commits from ${fromRef} to ${toRef} (${commits.length} commits):

${commitLog}

Write release notes summarizing these changes.`;
}

export function buildDeepReleaseNotesUserMessage(
  fromRef: string,
  toRef: string,
  commits: CommitWithDiff[]
): string {
  const sections = commits
    .map((c) => {
      const body = c.body ? `\n${c.body}` : "";
      const truncationNote = c.truncated
        ? "\n\n> Note: This diff was truncated due to size limits."
        : "";

      return `## Commit ${c.shortHash}: ${c.subject}
Author: ${c.author}
Date: ${c.date}
${body}
### Changes:
\`\`\`
${c.stat}
\`\`\`

\`\`\`diff
${c.patch}
\`\`\`
${truncationNote}`;
    })
    .join("\n\n---\n\n");

  return `Here are the git commits from ${fromRef} to ${toRef}, with source diffs (${commits.length} commits):

${sections}

Write release notes based on the commit messages and the actual code changes.
Prioritize what you can see in the source diffs over what commit messages claim.`;
}

// ---------------------------------------------------------------------------
// Code Review prompts
// ---------------------------------------------------------------------------

export const CODE_REVIEW_SYSTEM_PROMPT = `You are a senior software engineer performing a thorough code review.
Analyze the provided git diffs and produce a detailed review in markdown.

Review criteria:
- Bugs and logic errors
- Security vulnerabilities (injection, auth issues, data exposure, etc.)
- Performance concerns (unnecessary allocations, N+1 queries, blocking calls, etc.)
- Error handling gaps (uncaught exceptions, missing validation, etc.)
- Code clarity and maintainability
- Suggestions for improvement

Format:
- Do NOT include a title or header — one will be added automatically
- Start with a brief summary of what the changes do overall
- Group findings by severity using ## headings: ## Critical, ## Warnings, ## Suggestions
- Only include severity sections that have findings — omit empty sections
- For each finding, reference the specific file and code involved
- Be constructive — explain why something is an issue and how to fix it
- If the code looks good, say so. Don't invent problems.`;

export function buildCodeReviewUserMessage(
  commits: CommitWithDiff[]
): string {
  const sections = commits
    .map((c) => {
      const body = c.body ? `\n${c.body}` : "";

      return `## Commit ${c.shortHash}: ${c.subject}
Author: ${c.author}
Date: ${c.date}
${body}
### Diff:
\`\`\`
${c.stat}
\`\`\`

\`\`\`diff
${c.patch}
\`\`\``;
    })
    .join("\n\n---\n\n");

  return `Review the following commit(s) (${commits.length} total):

${sections}

Provide a thorough code review.`;
}
