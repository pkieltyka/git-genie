import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefType = "tag" | "branch" | "commit";

export interface RefInfo {
  ref: string;
  type: RefType;
  hash: string;
  /** Display name: tag name, branch name, or truncated hash (6 chars) */
  displayName: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export interface CommitWithDiff extends CommitInfo {
  stat: string;
  patch: string;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB for large diffs
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString().trim() || err.message;
    throw new Error(`git ${args.split(" ")[0]} failed: ${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isGitRepo(): boolean {
  try {
    git("rev-parse --is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
}

export function ensureGitRepo(): void {
  if (!isGitRepo()) {
    console.error("Error: not a git repository (or any parent up to mount point).");
    console.error("Run gitgenie from within a git repository.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

export function resolveRef(ref: string): RefInfo {
  // Validate the ref exists and resolve to a commit hash
  let hash: string;
  try {
    hash = git(`rev-parse --verify "${ref}^{commit}"`);
  } catch {
    // Try without ^{commit} for branches/tags that may need different resolution
    try {
      hash = git(`rev-parse --verify "${ref}"`);
    } catch {
      console.error(`Error: cannot resolve ref '${ref}'.`);
      console.error("Make sure it is a valid tag, branch, or commit hash.");
      process.exit(1);
    }
  }

  const shortHash = hash.substring(0, 6);

  // Determine ref type
  const type = getRefType(ref);

  const displayName =
    type === "commit" ? shortHash : ref;

  return { ref, type, hash, displayName };
}

function getRefType(ref: string): RefType {
  // Check if it's a tag
  try {
    const result = git(`tag -l "${ref}"`);
    if (result === ref) return "tag";
  } catch {
    // not a tag
  }

  // Check if it's a branch
  try {
    const result = git(`branch --list "${ref}"`);
    // branch --list returns with possible leading whitespace and * for current
    const cleaned = result.replace(/^[\s*]+/, "").trim();
    if (cleaned === ref) return "branch";
  } catch {
    // not a branch
  }

  // Also check remote branches for things like HEAD, main, etc.
  if (ref === "HEAD") return "branch";

  return "commit";
}

// ---------------------------------------------------------------------------
// Commit log
// ---------------------------------------------------------------------------

const LOG_SEPARATOR = "---GIT-GENIE-SEP---";

/**
 * Get commits in range (from-ref..to-ref), exclusive of from-ref.
 */
export function getCommits(fromRef: string, toRef: string): CommitInfo[] {
  const format = `%H%n%an%n%ad%n%s%n%b${LOG_SEPARATOR}`;
  let output: string;

  try {
    output = git(
      `log --format="${format}" --no-merges "${fromRef}..${toRef}"`
    );
  } catch (err: any) {
    // Could be no commits in range
    if (err.message.includes("unknown revision")) {
      console.error(`Error: invalid commit range '${fromRef}..${toRef}'.`);
      process.exit(1);
    }
    return [];
  }

  if (!output) return [];

  return parseCommitLog(output);
}

/**
 * Get commits in range, inclusive of both endpoints.
 * Used by `review` command.
 */
export function getCommitsInclusive(
  startRef: string,
  endRef: string
): CommitInfo[] {
  const format = `%H%n%an%n%ad%n%s%n%b${LOG_SEPARATOR}`;
  let output: string;

  try {
    // Use startRef^..endRef to include the startRef commit
    output = git(
      `log --format="${format}" --no-merges "${startRef}^..${endRef}"`
    );
  } catch {
    // If startRef^ fails (root commit), try listing startRef..endRef + startRef itself
    try {
      const rangeOutput = git(
        `log --format="${format}" --no-merges "${startRef}..${endRef}"`
      );
      const startOutput = git(`log -1 --format="${format}" "${startRef}"`);
      output = rangeOutput ? `${rangeOutput}\n${startOutput}` : startOutput;
    } catch (err: any) {
      console.error(`Error: invalid commit range.`);
      process.exit(1);
    }
  }

  if (!output) return [];

  return parseCommitLog(output);
}

function parseCommitLog(output: string): CommitInfo[] {
  const entries = output
    .split(LOG_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);

  return entries.map((entry) => {
    const lines = entry.split("\n");
    const hash = lines[0] || "";
    const author = lines[1] || "";
    const date = lines[2] || "";
    const subject = lines[3] || "";
    const body = lines.slice(4).join("\n").trim();

    return {
      hash,
      shortHash: hash.substring(0, 6),
      author,
      date,
      subject,
      body,
    };
  });
}

// ---------------------------------------------------------------------------
// Per-commit diffs
// ---------------------------------------------------------------------------

/** ~4 chars per token is a rough estimate */
const CHARS_PER_TOKEN = 4;

/**
 * Get diff for a single commit.
 */
export function getCommitDiff(hash: string): { stat: string; patch: string } {
  const stat = git(`show --stat --format="" "${hash}"`);
  const patch = git(`show --patch --format="" "${hash}"`);
  return { stat, patch };
}

/**
 * Get diffs for all commits, with per-commit and total token budget enforcement.
 *
 * For release-notes --deep: truncates oversized commits, keeps going.
 * Returns commits with their diffs (possibly truncated).
 */
export function getCommitDiffs(
  commits: CommitInfo[],
  options: {
    perCommitTokenBudget?: number;
    totalTokenBudget?: number;
  } = {}
): CommitWithDiff[] {
  const perCommitBudget = options.perCommitTokenBudget ?? 10_000;
  const totalBudget = options.totalTokenBudget ?? 100_000;
  const perCommitCharBudget = perCommitBudget * CHARS_PER_TOKEN;
  const totalCharBudget = totalBudget * CHARS_PER_TOKEN;

  let totalChars = 0;
  const results: CommitWithDiff[] = [];

  for (const commit of commits) {
    const { stat, patch } = getCommitDiff(commit.hash);
    let truncated = false;
    let finalPatch = patch;

    // Per-commit truncation
    if (finalPatch.length > perCommitCharBudget) {
      finalPatch =
        finalPatch.substring(0, perCommitCharBudget) +
        "\n\n... [diff truncated — exceeded per-commit size limit]";
      truncated = true;
    }

    // Total budget check
    if (totalChars + stat.length + finalPatch.length > totalCharBudget) {
      finalPatch =
        finalPatch.substring(
          0,
          Math.max(0, totalCharBudget - totalChars - stat.length)
        ) + "\n\n... [diff truncated — exceeded total size budget]";
      truncated = true;
    }

    totalChars += stat.length + finalPatch.length;

    results.push({
      ...commit,
      stat,
      patch: finalPatch,
      truncated,
    });

    // If we've blown the budget, include stat-only for remaining commits
    if (totalChars >= totalCharBudget) {
      for (
        let i = results.length;
        i < commits.length;
        i++
      ) {
        const c = commits[i];
        const s = git(`show --stat --format="" "${c.hash}"`);
        results.push({
          ...c,
          stat: s,
          patch: "[diff omitted — total size budget exceeded]",
          truncated: true,
        });
      }
      break;
    }
  }

  return results;
}

/**
 * Estimate total token count of diffs for a list of commits.
 * Used by review command to check if diffs fit in context window.
 */
export function estimateDiffTokens(commits: CommitInfo[]): number {
  let totalChars = 0;
  for (const commit of commits) {
    const { stat, patch } = getCommitDiff(commit.hash);
    totalChars += stat.length + patch.length;
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * Get full (untruncated) diffs for review.
 * Review command should have already checked that the total fits in context.
 */
export function getFullCommitDiffs(commits: CommitInfo[]): CommitWithDiff[] {
  return commits.map((commit) => {
    const { stat, patch } = getCommitDiff(commit.hash);
    return {
      ...commit,
      stat,
      patch,
      truncated: false,
    };
  });
}

/**
 * Count commits in a range (exclusive of fromRef).
 */
export function countCommits(fromRef: string, toRef: string): number {
  try {
    const output = git(
      `rev-list --count --no-merges "${fromRef}..${toRef}"`
    );
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}
