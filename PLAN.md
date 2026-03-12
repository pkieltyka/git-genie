# git-genie

A CLI tool that uses LLM analysis on git commits to generate release notes and code reviews.

## What It Does

Run `gitgenie` inside any git repo to:
- **Generate release notes** from commit ranges — clean, public-facing markdown
- **Review code changes** — deep analysis of diffs to find bugs, suggest improvements

---

## CLI Overview

```
gitgenie <command> [options]

Commands:
  login <provider>                          OAuth login to an LLM provider
  logout [provider]                         Remove stored credentials
  auth-status                               Show which providers are authenticated
  list-providers                            List available LLM providers
  list-models [provider]                    List available models (optionally filter by provider)

  release-notes <from-ref> <to-ref>         Generate release notes between two refs
  review <commit> [end-commit]              Code review of one or more commits

Global Options:
  --model <model>       LLM model (default: claude-sonnet-4-20250514)
  --provider <name>     LLM provider (default: anthropic)
  --verbose             Show git data, token usage, and cost
  --help                Show help
```

---

## Subcommands

### `gitgenie release-notes`

Generate public-facing release notes between two git refs.

```bash
gitgenie release-notes <from-ref> <to-ref> [options]

Options:
  --deep              Also analyze source code diffs per commit (slower, more accurate)
  --save              Write output to ./notes/release-YYYY-MM-DD-<suffix>.md
  --output <path>     Write output to a specific file path
```

**Examples**:
```bash
# Release notes from tag to tag
gitgenie release-notes v1.0 v1.1

# With source code analysis
gitgenie release-notes v1.0 v1.1 --deep

# Save to file
gitgenie release-notes v1.0 v1.1 --deep --save

# Tag to branch
gitgenie release-notes v1.0 main --save

# Commit to commit
gitgenie release-notes abc123 def456
```

#### Two Modes of Analysis

**Standard (default)**: Collects commit messages/descriptions between the two refs and sends them to the LLM. Fast, cheap, works well when commit messages are descriptive.

**Deep (`--deep`)**: In addition to commit messages, retrieves the actual source code diff for each commit. Produces more accurate and detailed notes because the LLM can see what actually changed in the code. Uses more tokens.

#### Commit Range Semantics

Analyzes commits **after** `<from-ref>` up to and **including** `<to-ref>`. The `<from-ref>` commit itself is excluded — it's the boundary of the previous release. This matches `git log <from-ref>..<to-ref>` semantics.

For example, `gitgenie release-notes v1.0 v1.1` covers everything new since v1.0 was released, through v1.1.

### `gitgenie review`

Code review of source changes for one or more commits.

```bash
gitgenie review <commit> [end-commit] [options]

Options:
  --save              Write output to ./notes/review-YYYY-MM-DD-<suffix>.md
  --output <path>     Write output to a specific file path
```

**Examples**:
```bash
# Review a single commit
gitgenie review abc123

# Review a range of commits (inclusive of both endpoints)
gitgenie review abc123 def456

# Review and save
gitgenie review abc123 def456 --save

# Review from a tag to HEAD
gitgenie review v1.1 HEAD
```

#### How It Works

The `review` command always analyzes actual source code (there is no "shallow" mode — diffs are the whole point of a code review).

**Single commit**: Retrieves the diff for that one commit via `git show`.

**Range** (`<commit> <end-commit>`): Both endpoints are **inclusive**. This differs from `release-notes` because when reviewing code you typically want to see the starting commit too. Internally we use `git log <commit>^..<end-commit>` to include both.

The LLM performs a thorough code review covering:
- Bugs and logic errors
- Security concerns
- Performance issues
- Code style and readability
- Missing error handling
- Suggestions for improvement

### `gitgenie login`

```bash
gitgenie login anthropic        # Claude Pro/Max OAuth
gitgenie login openai-codex     # ChatGPT Plus/Pro OAuth
gitgenie login github-copilot   # GitHub Copilot OAuth
gitgenie login google-gemini-cli # Google Gemini CLI OAuth
gitgenie login google-antigravity # Antigravity (free)
```

### `gitgenie logout`

```bash
gitgenie logout anthropic       # Remove one provider
gitgenie logout                 # Remove all credentials
```

### `gitgenie auth-status`

Shows which providers have stored credentials and whether tokens are expired.

### `gitgenie list-providers`

Lists all available LLM providers from pi-ai's registry. Shows which ones you're currently authenticated with.

```
$ gitgenie list-providers
  anthropic          ✓ logged in
  openai-codex       ✓ logged in
  github-copilot     ✗ not authenticated
  google-gemini-cli  ✗ not authenticated
  google-antigravity ✗ not authenticated
```

### `gitgenie list-models`

Lists available models, optionally filtered by provider.

```bash
gitgenie list-models                # All models from all providers
gitgenie list-models anthropic      # Only Anthropic models
```

---

## Output

### Stdout

By default, both `release-notes` and `review` stream markdown to stdout.

### Markdown Header

All generated markdown includes a header block identifying the source range. This header is **injected by `output.ts`**, not generated by the LLM — this keeps the metadata deterministic and correct (ref names, commit count, date) rather than relying on the LLM to reproduce them accurately.

**Release notes**:
```markdown
# Release Notes: v1.0 → v1.1

> Generated from commits after `v1.0` up to and including `v1.1` (42 commits)
> Generated by git-genie on 2025-03-12

(LLM-generated content follows)
```

**Code review**:
```markdown
# Code Review: abc123..def456

> Reviewing commits `abc123` through `def456` (inclusive, 7 commits)
> Generated by git-genie on 2025-03-12

(LLM-generated content follows)
```

This makes it clear what commit range the output is based on, especially when saved to files and read later. The LLM is explicitly told not to generate its own header (see Prompts section).

### `--save` File Naming

Files are written to `./notes/` with the pattern:

```
notes/<type>-YYYY-MM-DD-<suffix>.md
```

Where:
- `<type>` is `release` or `review`
- `YYYY-MM-DD` is today's date
- `<suffix>` describes the commit range

#### Suffix Rules

The suffix is derived from the **target ref** (second arg, or only arg for single-commit review):

| Ref type | Example ref | Suffix |
|----------|-------------|--------|
| Tag | `v1.1` | `v1.1` |
| Branch | `main` | `main` |
| Commit | `a1b2c3d4e5f6` | `a1b2c3` (first 6 chars) |

**Examples**:

| Command | Filename |
|---------|----------|
| `gitgenie release-notes v1.0 v1.1 --save` | `notes/release-2025-03-12-v1.1.md` |
| `gitgenie release-notes v1.0 main --save` | `notes/release-2025-03-12-main.md` |
| `gitgenie release-notes abc123 def456 --save` | `notes/release-2025-03-12-def456.md` |
| `gitgenie review abc123 --save` | `notes/review-2025-03-12-abc123.md` |
| `gitgenie review abc123 def456 --save` | `notes/review-2025-03-12-def456.md` |
| `gitgenie review v1.0 v1.1 --save` | `notes/review-2025-03-12-v1.1.md` |

---

## Tech Stack

- **Language**: TypeScript
- **Runtime**: [Bun](https://bun.sh)
- **LLM**: [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) from pi-mono — unified multi-provider LLM API supporting OpenAI, Anthropic, Google, and many others
- **Git**: Shell out to `git` CLI (the tool must be run inside a git repo)

### Why `@mariozechner/pi-ai`?

It gives us a single API across all major LLM providers with streaming, token/cost tracking, and automatic model discovery. The user can configure which provider and model to use. No need to write provider-specific code.

Critically, `pi-ai` also provides a complete OAuth subsystem (`@mariozechner/pi-ai/oauth`) with login flows, token refresh, and provider interfaces for Anthropic, OpenAI Codex, GitHub Copilot, Google Gemini CLI, and Antigravity — so we don't need to implement any OAuth flows ourselves.

We do **not** need `@mariozechner/pi-agent-core` — these are single-pass LLM tasks, not multi-turn agent loops with tool calling.

---

## Architecture

```
src/
  index.ts              # CLI entry point, subcommand dispatch
  auth.ts               # OAuth login, token refresh, credential storage
  git.ts                # Git operations (log, diff, ref resolution)
  commands/
    release-notes.ts    # release-notes subcommand logic
    review.ts           # review subcommand logic
  prompt.ts             # LLM prompt construction (release-notes + review)
  llm.ts                # LLM call via pi-ai (stream response)
  output.ts             # Markdown formatting and file writing
```

---

## Detailed Design

### 1. CLI (`src/index.ts`)

Dispatch based on the first positional arg:

```typescript
const subcommand = args[0];

switch (subcommand) {
  case "login":         // → auth flow
  case "logout":        // → remove credentials
  case "auth-status":   // → show credential status
  case "list-providers":// → list pi-ai providers + auth status
  case "list-models":  // → list models, optionally filtered by provider
  case "release-notes": // → commands/release-notes.ts
  case "review":        // → commands/review.ts
  default:              // → show help
}
```

Use `parseArgs` from `node:util` (supported by Bun).

### 2. Authentication (`src/auth.ts`)

We use OAuth exclusively (no raw API keys) via `@mariozechner/pi-ai/oauth`. Credentials are stored in our own config directory at `~/.gitgenie/auth.json`, independent of any other tool.

#### Credential Storage

**Location**: `~/.gitgenie/auth.json` (file permissions `0o600`)

**Format**:
```json
{
  "anthropic": {
    "refresh": "rt-abc123...",
    "access": "sk-ant-xyz789...",
    "expires": 1710000000000
  },
  "openai-codex": {
    "refresh": "rt-def456...",
    "access": "eyJhbG...",
    "expires": 1710000000000,
    "accountId": "acct_abc123"
  }
}
```

Keys are OAuth provider IDs from pi-ai. Values are `OAuthCredentials` objects (refresh token, access token, expiry timestamp, plus any provider-specific extras like `accountId` for OpenAI).

#### Supported OAuth Providers

| Provider ID | Service | What you need |
|---|---|---|
| `anthropic` | Claude (Anthropic) | Claude Pro or Max subscription |
| `openai-codex` | ChatGPT / Codex (OpenAI) | ChatGPT Plus or Pro subscription |
| `github-copilot` | GitHub Copilot | Copilot subscription |
| `google-gemini-cli` | Google Gemini | Free tier or paid Cloud Code Assist |
| `google-antigravity` | Antigravity | Free (Gemini 3, Claude, GPT-OSS via Google Cloud) |

These are all built into `@mariozechner/pi-ai/oauth` — we just call the login/refresh functions.

#### Login Flow

```
gitgenie login anthropic
```

1. Call `getOAuthProvider("anthropic")` from pi-ai to get the provider interface
2. Call `provider.login(callbacks)` with our CLI callbacks:
   - `onAuth`: print the URL and open the browser (via `open` or `xdg-open`)
   - `onPrompt`: read from stdin (e.g. "Paste the authorization code:")
   - `onManualCodeInput`: for providers like OpenAI Codex that race a local callback server against manual paste
3. Receive `OAuthCredentials` back
4. Write to `~/.gitgenie/auth.json`
5. Print success message

#### Token Refresh

On every command that calls an LLM, before making the request:

1. Read `~/.gitgenie/auth.json`
2. Look up credentials for the selected provider
3. If `Date.now() >= credentials.expires`, call `provider.refreshToken(credentials)`
4. Write updated credentials back to `auth.json`
5. Pass `provider.getApiKey(credentials)` as the `apiKey` option to `stream()`

This is essentially what pi-ai's `getOAuthApiKey()` does — we can call it directly:

```typescript
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";

const result = await getOAuthApiKey(providerId, credentials);
// result.apiKey — ready to use
// result.newCredentials — write back to auth.json if changed
```

#### Provider Identification (User-Agent / Headers)

The OAuth client IDs embedded in pi-ai's login flows are already set up correctly (Anthropic uses the same client ID as Claude Code / pi, OpenAI Codex uses the same client ID as Codex CLI). The access tokens returned by these flows are legitimate API tokens tied to the user's subscription. No custom User-Agent spoofing is needed.

### 3. Git Operations (`src/git.ts`)

All git operations shell out to `git` via `Bun.spawn` or `child_process`.

#### Ref Resolution

Determine what type each ref is (for file naming with `--save`):
- `git tag -l <ref>` — is it a tag?
- `git branch --list <ref>` — is it a local branch?
- `git rev-parse --verify <ref>` — is it a valid commit?

Validate refs exist before proceeding:
```bash
git rev-parse --verify <ref>^{commit}
```

#### Commit Log (for release-notes standard mode)

```bash
git log --format="%H%n%an%n%ad%n%s%n%b%n---" --no-merges <from-ref>..<to-ref>
```

This gives us hash, author, date, subject, and body for each commit. The `<from>..<to>` range excludes the `<from>` commit itself.

#### Per-Commit Diffs (for release-notes --deep and review)

```bash
# List commits in range
git log --format="%H" --no-merges <from-ref>..<to-ref>

# For each commit hash:
git show --stat --patch --no-binary <hash>
```

For `review` with a single commit:
```bash
git show --stat --patch --no-binary <hash>
```

For `review` with a range (inclusive of both endpoints):
```bash
# Use <commit>^..<end-commit> to include the first commit
git log --format="%H" --no-merges <commit>^..<end-commit>
```

#### Diff Size Management

Large repos can produce enormous diffs. The strategy differs between commands because their requirements differ.

**Release notes** (standard and deep): Truncation is acceptable because the LLM is summarizing, not auditing line-by-line.
- Include `--stat` for every commit (always cheap)
- Include full patch per commit, but truncate individual commits that exceed ~10k tokens of diff
- If total content across all commits exceeds the token budget (~100k tokens), summarize older/smaller commits and keep full diffs for the most recent ones
- Note in the prompt when content has been truncated so the LLM knows

**Code review**: Truncation is **not** acceptable — you can't review code you can't see. Instead:
- Calculate total diff size before sending to the LLM
- If the total exceeds the model's context window (minus room for the system prompt and response), **error with a clear message** suggesting the user narrow the commit range
- Example: `Error: diff too large (estimated ~180k tokens, model limit ~128k). Try reviewing fewer commits, e.g.: gitgenie review abc123 def456`

**Both commands**:
- Skip binary files (`--no-binary`)
- Exclude common generated files (lockfiles, `.min.js`, etc.) via a default ignore list

### 4. LLM Prompts (`src/prompt.ts`)

Construct system prompt + user message for the LLM. Different prompts for each command.

#### Release Notes — System Prompt

```
You are a technical writer producing public-facing release notes.
Write clean, concise markdown release notes that describe what changed
from the user's perspective.

Guidelines:
- Do NOT include a title or header — one will be added automatically
- Focus on user-visible changes: features, fixes, improvements, breaking changes
- Group changes into logical sections (e.g. ## Features, ## Fixes, ## Improvements, ## Breaking Changes)
- Omit internal refactors, CI changes, and dependency bumps unless they affect users
- Be specific but concise — one line per change
- Use present tense ("Add", "Fix", "Remove", not "Added", "Fixed", "Removed")
- Do not invent changes that aren't evidenced in the data provided
- Start directly with the first section heading
```

#### Release Notes — User Message (Standard)

```
Here are the git commits from <from-ref> to <to-ref> (<N> commits):

<commit log with messages>

Write release notes summarizing these changes.
```

#### Release Notes — User Message (Deep)

```
Here are the git commits from <from-ref> to <to-ref>, with source diffs:

## Commit <short-hash>: <subject>
Author: <author>
Date: <date>

<commit body>

### Changes:
<diff stat>
<patch (possibly truncated)>

---

(repeat for each commit)

Write release notes based on the commit messages and the actual code changes.
Prioritize what you can see in the source diffs over what commit messages claim.
```

#### Code Review — System Prompt

```
You are a senior software engineer performing a thorough code review.
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
- Group findings by severity: Critical, Warning, Suggestion
- For each finding, reference the specific file and code involved
- Be constructive — explain why something is an issue and how to fix it
- If the code looks good, say so. Don't invent problems.
```

#### Code Review — User Message

```
Review the following commit(s):

## Commit <short-hash>: <subject>
Author: <author>
Date: <date>

<commit body>

### Diff:
<diff stat>
<patch>

---

(repeat for each commit)

Provide a thorough code review.
```

### 5. LLM Call (`src/llm.ts`)

Use `@mariozechner/pi-ai` with OAuth credentials from `auth.ts`:

```typescript
import { getModel, stream } from "@mariozechner/pi-ai";
import { getApiKeyForProvider } from "./auth.js";

// Resolve API key from OAuth credentials (auto-refreshes if expired)
const apiKey = await getApiKeyForProvider(provider);

const model = getModel(provider, modelId);
const s = stream(model, {
  systemPrompt,
  messages: [{ role: "user", content: userMessage }],
}, {
  apiKey,
});

for await (const event of s) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

const result = await s.result();
```

The API key comes from our `~/.gitgenie/auth.json` OAuth credentials, not from environment variables. The `getApiKeyForProvider()` function handles token refresh transparently.

### 6. Output (`src/output.ts`)

**stdout**: Stream the markdown as it arrives from the LLM.

**--save**: After the full response is collected:
1. Determine the type prefix (`release` or `review`)
2. Determine the suffix from the target ref type
3. Create `./notes/` directory if it doesn't exist
4. Write `./notes/<type>-YYYY-MM-DD-<suffix>.md`
5. Print the file path to stderr so it doesn't mix with the markdown output on stdout

**--output \<path\>**: Write to a specific file path instead of the auto-generated `./notes/` path. Creates parent directories if needed. Useful for CI pipelines, piping into release PRs, or custom directory structures. Mutually exclusive with `--save` (if both provided, `--output` wins).

---

## Project Setup

```
git-genie/
  PLAN.md
  package.json
  tsconfig.json
  src/
    index.ts              # CLI entry, subcommand dispatch
    auth.ts               # OAuth credential management
    git.ts                # Git operations
    commands/
      release-notes.ts    # release-notes orchestration
      review.ts           # review orchestration
    prompt.ts             # LLM prompt construction
    llm.ts                # LLM streaming call
    output.ts             # Markdown formatting, file writing
```

**Config directory**: `~/.gitgenie/`
```
~/.gitgenie/
  auth.json               # OAuth credentials (chmod 600)
```

**package.json** (key fields):
```json
{
  "name": "git-genie",
  "type": "module",
  "bin": {
    "gitgenie": "./src/index.ts"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "latest"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

Bun can run TypeScript directly, so the `bin` entry points straight at the `.ts` source file. For distribution, we'd compile with `bun build`.

---

## Implementation Plan

### Phase 1: Scaffolding + Auth
1. Project scaffolding (package.json, tsconfig, directory structure)
2. CLI subcommand dispatch
3. Auth module — `login`, `logout`, `auth-status`, `list-providers`, `list-models`

### Phase 2: Release Notes (MVP)
4. Git operations — ref resolution, commit log
5. Release notes prompt construction (standard mode)
6. LLM call with streaming output
7. Markdown header with commit range metadata
8. `--save` file output with `release-` prefix

### Phase 3: Deep Release Notes
9. Per-commit diff collection (`git show` per commit)
10. Deep mode prompt construction (messages + diffs)
11. Diff truncation / token budget management
12. `--deep` flag wiring

### Phase 4: Code Review
13. `review` subcommand — single commit diff collection
14. `review` subcommand — commit range (inclusive) diff collection
15. Code review prompt construction
16. `--save` file output with `review-` prefix

### Phase 5: Polish
17. Better error messages (not in a git repo, invalid refs, not logged in)
18. `--verbose` flag (raw git data, token usage, cost)
19. Handle edge cases (no commits in range, binary files, empty diffs)
20. Graceful token refresh errors (prompt to re-login)

### Phase 6: Nice-to-haves
21. `--format` option for output style variants
22. Config file support (`.gitgenie.json` for default model, provider, style)
23. Support for monorepos (group notes by package/directory)
24. `bun build` compilation for standalone binary distribution

---

## Resolved Decisions

- **Merge commits**: Excluded by default via `--no-merges`. Squash merges (single-parent) are still included since git doesn't consider them merge commits. No flag needed.
- **Markdown header**: Injected by `output.ts`, not generated by the LLM. Keeps metadata deterministic.
- **Diff size for review**: Error and suggest narrowing the range rather than silently truncating. Code review with missing context is worse than no review.

## Open Questions

- **Default model**: Claude Sonnet 4 is a good default (fast, capable, good at summarization and code review). The user can override with `--model` and `--provider`.
- **Provider-to-model mapping**: When the user logs in with `openai-codex`, the OAuth provider ID is `openai-codex` but the pi-ai model provider is `openai`. Need a clean mapping between OAuth provider IDs and pi-ai provider/model IDs.
- **Review inclusive range**: Using `<commit>^..<end-commit>` to include both endpoints. Need to handle the edge case where `<commit>` is the root commit (no parent).
- **Generated file ignore list**: Need to decide the default set of patterns to exclude from diffs (lockfiles, `.min.js`, `dist/`, etc.). Should be configurable via `.gitgenie.json`.
