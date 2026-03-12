#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { login, logout, authStatus, listProviders, listModelsCmd } from "./auth.js";
import { releaseNotesCommand } from "./commands/release-notes.js";
import { reviewCommand } from "./commands/review.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `git-genie v${VERSION} — LLM-powered release notes and code reviews from git history

Usage:
  gitgenie <command> [options]

Commands:
  release-notes <from-ref> <to-ref>    Generate release notes between two refs
  review <commit> [end-commit]          Code review of one or more commits
  login <provider>                      OAuth login to an LLM provider
  logout [provider]                     Remove stored credentials
  auth-status                           Show which providers are authenticated
  list-providers                        List available LLM providers
  list-models [provider]                List available models

Global Options:
  --provider <name>   LLM provider (default: anthropic)
  --model <model>     LLM model (default: claude-sonnet-4-20250514)
  --verbose           Show git data, token usage, and cost
  --help              Show this help
  --version           Show version

Release Notes Options:
  --deep              Analyze source code diffs per commit (slower, more accurate)
  --save              Write to ./notes/release-YYYY-MM-DD-<suffix>.md
  --output <path>     Write to a specific file path

Review Options:
  --save              Write to ./notes/review-YYYY-MM-DD-<suffix>.md
  --output <path>     Write to a specific file path

Examples:
  gitgenie login anthropic
  gitgenie release-notes v1.0 v1.1
  gitgenie release-notes v1.0 v1.1 --deep --save
  gitgenie review abc123
  gitgenie review abc123 def456 --save
  gitgenie list-models anthropic
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const subcommand = args[0];

  // Handle simple commands that don't need flag parsing
  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(HELP);
    process.exit(0);
  }

  if (subcommand === "--version" || subcommand === "-v") {
    console.log(`git-genie v${VERSION}`);
    process.exit(0);
  }

  switch (subcommand) {
    case "login":
      await handleLogin(args.slice(1));
      break;

    case "logout":
      handleLogout(args.slice(1));
      break;

    case "auth-status":
      authStatus();
      break;

    case "list-providers":
      listProviders();
      break;

    case "list-models":
      listModelsCmd(args[1]);
      break;

    case "release-notes":
      await handleReleaseNotes(args.slice(1));
      break;

    case "review":
      await handleReview(args.slice(1));
      break;

    default:
      console.error(`Unknown command: ${subcommand}`);
      console.error('Run "gitgenie --help" for usage.');
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleLogin(args: string[]): Promise<void> {
  const providerId = args[0];
  if (!providerId) {
    console.error("Usage: gitgenie login <provider>");
    console.error('Run "gitgenie list-providers" to see available providers.');
    process.exit(1);
  }
  await login(providerId);
}

function handleLogout(args: string[]): void {
  logout(args[0]);
}

async function handleReleaseNotes(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      deep: { type: "boolean", default: false },
      save: { type: "boolean", default: false },
      output: { type: "string" },
      provider: { type: "string", default: "anthropic" },
      model: { type: "string", default: "claude-sonnet-4-20250514" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length < 2) {
    console.error("Usage: gitgenie release-notes <from-ref> <to-ref> [options]");
    console.error("");
    console.error("Examples:");
    console.error("  gitgenie release-notes v1.0 v1.1");
    console.error("  gitgenie release-notes v1.0 v1.1 --deep --save");
    process.exit(1);
  }

  await releaseNotesCommand({
    fromRef: positionals[0],
    toRef: positionals[1],
    deep: values.deep,
    save: values.save,
    output: values.output,
    provider: values.provider!,
    model: values.model!,
    verbose: values.verbose,
  });
}

async function handleReview(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      save: { type: "boolean", default: false },
      output: { type: "string" },
      provider: { type: "string", default: "anthropic" },
      model: { type: "string", default: "claude-sonnet-4-20250514" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length < 1) {
    console.error("Usage: gitgenie review <commit> [end-commit] [options]");
    console.error("");
    console.error("Examples:");
    console.error("  gitgenie review abc123");
    console.error("  gitgenie review abc123 def456 --save");
    process.exit(1);
  }

  await reviewCommand({
    startRef: positionals[0],
    endRef: positionals[1],
    save: values.save,
    output: values.output,
    provider: values.provider!,
    model: values.model!,
    verbose: values.verbose,
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
