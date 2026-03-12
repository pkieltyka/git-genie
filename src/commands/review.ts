import {
  ensureGitRepo,
  resolveRef,
  getCommits,
  getCommitsInclusive,
  getFullCommitDiffs,
  estimateDiffTokens,
  type CommitInfo,
} from "../git.js";
import {
  CODE_REVIEW_SYSTEM_PROMPT,
  buildCodeReviewUserMessage,
} from "../prompt.js";
import { callLlm, getModelContextWindow, type LlmOptions } from "../llm.js";
import {
  buildReviewHeader,
  resolveOutputPath,
  writeOutputFile,
} from "../output.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewOptions extends LlmOptions {
  startRef: string;
  endRef?: string;
  save?: boolean;
  output?: string;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  ensureGitRepo();

  // Resolve refs
  const startRefInfo = resolveRef(options.startRef);
  const endRefInfo = options.endRef
    ? resolveRef(options.endRef)
    : null;

  // Get commits
  let commits: CommitInfo[];

  if (endRefInfo) {
    // Range: inclusive of both endpoints
    commits = getCommitsInclusive(options.startRef, options.endRef!);
  } else {
    // Single commit
    commits = [
      {
        hash: startRefInfo.hash,
        shortHash: startRefInfo.hash.substring(0, 6),
        author: "", // Will be filled from git show
        date: "",
        subject: "",
        body: "",
      },
    ];

    // Get the actual commit info
    const { execSync } = await import("child_process");
    try {
      const info = execSync(
        `git log -1 --format="%an%n%ad%n%s%n%b" "${startRefInfo.hash}"`,
        { encoding: "utf-8" }
      ).trim();
      const lines = info.split("\n");
      commits[0].author = lines[0] || "";
      commits[0].date = lines[1] || "";
      commits[0].subject = lines[2] || "";
      commits[0].body = lines.slice(3).join("\n").trim();
    } catch {
      // Continue with empty metadata — the diff is what matters
    }
  }

  if (commits.length === 0) {
    console.error("No commits found in the specified range.");
    process.exit(1);
  }

  if (options.verbose) {
    const rangeDesc = endRefInfo
      ? `${startRefInfo.displayName}..${endRefInfo.displayName}`
      : startRefInfo.displayName;
    console.error(`Reviewing ${commits.length} commit(s): ${rangeDesc}`);
    console.error("Collecting diffs...");
    console.error("");
  }

  // Check if total diff size fits in context window
  const estimatedTokens = estimateDiffTokens(commits);
  const contextWindow = getModelContextWindow(options.provider, options.model);
  // Reserve ~20% for system prompt + response
  const availableTokens = Math.floor(contextWindow * 0.8);

  if (estimatedTokens > availableTokens) {
    console.error(
      `Error: diff too large (estimated ~${Math.round(estimatedTokens / 1000)}k tokens, model limit ~${Math.round(availableTokens / 1000)}k available).`
    );
    console.error(
      "Try reviewing fewer commits. For example:"
    );
    if (endRefInfo) {
      console.error(
        `  gitgenie review ${startRefInfo.displayName} <a-closer-commit>`
      );
    } else {
      console.error(
        "  The single commit's diff exceeds the context window."
      );
    }
    process.exit(1);
  }

  if (options.verbose) {
    console.error(
      `Estimated diff size: ~${Math.round(estimatedTokens / 1000)}k tokens (${Math.round(availableTokens / 1000)}k available)`
    );
    console.error("");
  }

  // Get full diffs (no truncation for review)
  const commitDiffs = getFullCommitDiffs(commits);

  // Build header
  const header = buildReviewHeader(
    startRefInfo,
    endRefInfo,
    commits.length
  );

  // Determine output path
  const targetRef = endRefInfo || startRefInfo;
  const outputPath = resolveOutputPath(
    { save: options.save, output: options.output },
    "review",
    targetRef
  );

  // Print header
  process.stdout.write(header);

  // Build user message and call LLM
  const userMessage = buildCodeReviewUserMessage(commitDiffs);

  const result = await callLlm(
    CODE_REVIEW_SYSTEM_PROMPT,
    userMessage,
    options
  );

  // Save if requested
  if (outputPath) {
    const fullContent = header + result.content;
    writeOutputFile(outputPath, fullContent);
  }
}
