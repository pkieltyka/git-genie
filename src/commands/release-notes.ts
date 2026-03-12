import {
  ensureGitRepo,
  resolveRef,
  getCommits,
  getCommitDiffs,
} from "../git.js";
import {
  RELEASE_NOTES_SYSTEM_PROMPT,
  buildReleaseNotesUserMessage,
  buildDeepReleaseNotesUserMessage,
} from "../prompt.js";
import { callLlm, type LlmOptions } from "../llm.js";
import {
  buildReleaseNotesHeader,
  resolveOutputPath,
  writeOutputFile,
} from "../output.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReleaseNotesOptions extends LlmOptions {
  fromRef: string;
  toRef: string;
  deep?: boolean;
  save?: boolean;
  output?: string;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function releaseNotesCommand(
  options: ReleaseNotesOptions
): Promise<void> {
  ensureGitRepo();

  // Resolve refs
  const fromRefInfo = resolveRef(options.fromRef);
  const toRefInfo = resolveRef(options.toRef);

  // Get commits
  const commits = getCommits(options.fromRef, options.toRef);

  if (commits.length === 0) {
    console.error(
      `No commits found between ${fromRefInfo.displayName} and ${toRefInfo.displayName}.`
    );
    process.exit(1);
  }

  if (options.verbose) {
    console.error(
      `Found ${commits.length} commits between ${fromRefInfo.displayName} and ${toRefInfo.displayName}`
    );
    if (options.deep) {
      console.error("Deep mode: collecting per-commit diffs...");
    }
    console.error("");
  }

  // Build the header (injected by us, not the LLM)
  const header = buildReleaseNotesHeader(
    fromRefInfo,
    toRefInfo,
    commits.length
  );

  // Build the user message
  let userMessage: string;

  if (options.deep) {
    const commitDiffs = getCommitDiffs(commits);
    const truncatedCount = commitDiffs.filter((c) => c.truncated).length;

    if (options.verbose && truncatedCount > 0) {
      console.error(
        `Note: ${truncatedCount} commit diff(s) were truncated due to size limits.`
      );
      console.error("");
    }

    userMessage = buildDeepReleaseNotesUserMessage(
      fromRefInfo.displayName,
      toRefInfo.displayName,
      commitDiffs
    );
  } else {
    userMessage = buildReleaseNotesUserMessage(
      fromRefInfo.displayName,
      toRefInfo.displayName,
      commits
    );
  }

  // Determine output path before calling LLM
  const outputPath = resolveOutputPath(
    { save: options.save, output: options.output },
    "release",
    toRefInfo
  );

  // Print the header to stdout
  process.stdout.write(header);

  // Call LLM — streams content to stdout
  const result = await callLlm(
    RELEASE_NOTES_SYSTEM_PROMPT,
    userMessage,
    options
  );

  // Save to file if requested
  if (outputPath) {
    const fullContent = header + result.content;
    writeOutputFile(outputPath, fullContent);
  }
}
