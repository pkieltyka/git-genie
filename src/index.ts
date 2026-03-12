#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { login, logout, authStatus, listProviders, listModelsCmd } from "./auth.js";
import { releaseNotesCommand } from "./commands/release-notes.js";
import { reviewCommand, reviewGitHubPrCommand, parseGitHubPrRef } from "./commands/review.js";
import { getDefaultProvider, getDefaultModel, showConfig, setDefaultModel, setDefaultProvider } from "./config.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = "0.1.1";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function helpText(): string {
  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel(defaultProvider);

  return `git-genie v${VERSION} — LLM-powered release notes and code reviews from git history

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
  config                                Show current configuration
  config set-model <provider> <model>   Set default model for a provider
  config set-provider <provider>        Set default provider

Global Options:
  --provider <name>   LLM provider (default: ${defaultProvider})
  --model <model>     LLM model (default: ${defaultModel})
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
  gitgenie review 550
  gitgenie review https://github.com/owner/repo/pull/550
  gitgenie list-models anthropic
  gitgenie config set-model anthropic claude-opus-4-5
  gitgenie config set-provider anthropic
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(helpText());
    process.exit(0);
  }

  const subcommand = args[0];

  // Handle simple commands that don't need flag parsing
  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(helpText());
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

    case "config":
      handleConfig(args.slice(1));
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
  const defaultProvider = getDefaultProvider();

  const { values, positionals } = parseArgs({
    args,
    options: {
      deep: { type: "boolean", default: false },
      save: { type: "boolean", default: false },
      output: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
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

  const provider = values.provider ?? defaultProvider;
  const model = values.model ?? getDefaultModel(provider);

  await releaseNotesCommand({
    fromRef: positionals[0],
    toRef: positionals[1],
    deep: values.deep,
    save: values.save,
    output: values.output,
    provider,
    model,
    verbose: values.verbose,
  });
}

async function handleReview(args: string[]): Promise<void> {
  const defaultProvider = getDefaultProvider();

  const { values, positionals } = parseArgs({
    args,
    options: {
      save: { type: "boolean", default: false },
      output: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length < 1) {
    console.error("Usage: gitgenie review <commit|github-pr-url> [end-commit] [options]");
    console.error("");
    console.error("Examples:");
    console.error("  gitgenie review abc123");
    console.error("  gitgenie review abc123 def456 --save");
    console.error("  gitgenie review https://github.com/owner/repo/pull/123");
    process.exit(1);
  }

  const provider = values.provider ?? defaultProvider;
  const model = values.model ?? getDefaultModel(provider);

  // If the first positional is a GitHub PR URL or number, use the gh-cli path
  if (parseGitHubPrRef(positionals[0])) {
    await reviewGitHubPrCommand({
      prRef: parseGitHubPrRef(positionals[0])!,
      save: values.save,
      output: values.output,
      provider,
      model,
      verbose: values.verbose,
    });
    return;
  }

  await reviewCommand({
    startRef: positionals[0],
    endRef: positionals[1],
    save: values.save,
    output: values.output,
    provider,
    model,
    verbose: values.verbose,
  });
}

function handleConfig(args: string[]): void {
  if (args.length === 0) {
    showConfig();
    return;
  }

  const subcmd = args[0];

  if (subcmd === "set-model") {
    const provider = args[1];
    const model = args[2];
    if (!provider || !model) {
      console.error("Usage: gitgenie config set-model <provider> <model>");
      console.error("");
      console.error("Examples:");
      console.error("  gitgenie config set-model anthropic claude-opus-4-5");
      console.error("  gitgenie config set-model openai gpt-4o");
      process.exit(1);
    }
    setDefaultModel(provider, model);
    return;
  }

  if (subcmd === "set-provider") {
    const provider = args[1];
    if (!provider) {
      console.error("Usage: gitgenie config set-provider <provider>");
      console.error("");
      console.error("Examples:");
      console.error("  gitgenie config set-provider anthropic");
      process.exit(1);
    }
    setDefaultProvider(provider);
    return;
  }

  console.error(`Unknown config command: ${subcmd}`);
  console.error("Available: config, config set-model, config set-provider");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
