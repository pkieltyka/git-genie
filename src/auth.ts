import { homedir } from "os";
import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import {
  getOAuthProviders,
  getOAuthProvider,
  getOAuthApiKey,
  type OAuthCredentials,
} from "@mariozechner/pi-ai/oauth";
import { getProviders, getModels, type KnownProvider } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".gitgenie");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

export type AuthData = Record<string, OAuthCredentials>;

export function loadAuth(): AuthData {
  if (!existsSync(AUTH_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as AuthData;
  } catch {
    return {};
  }
}

function saveAuth(data: AuthData): void {
  ensureConfigDir();
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
  try {
    chmodSync(AUTH_FILE, 0o600);
  } catch {
    // chmod may fail on Windows — non-critical
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(providerId: string): Promise<void> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    const available = getOAuthProviders()
      .map((p) => p.id)
      .join(", ");
    console.error(`Unknown OAuth provider: ${providerId}`);
    console.error(`Available providers: ${available}`);
    process.exit(1);
  }

  console.log(`Logging in to ${provider.name}...`);

  const credentials = await provider.login({
    onAuth: (info) => {
      console.log(`\nOpen this URL in your browser:\n  ${info.url}`);
      if (info.instructions) {
        console.log(`\n${info.instructions}`);
      }
      // Try to open the browser automatically
      try {
        const { execSync } = require("child_process");
        const platform = process.platform;
        if (platform === "darwin") {
          execSync(`open "${info.url}"`, { stdio: "ignore" });
        } else if (platform === "linux") {
          execSync(`xdg-open "${info.url}"`, { stdio: "ignore" });
        } else if (platform === "win32") {
          execSync(`start "" "${info.url}"`, { stdio: "ignore" });
        }
      } catch {
        // If auto-open fails, user already has the URL printed
      }
    },
    onPrompt: async (prompt) => {
      process.stdout.write(`\n${prompt.message} `);
      const input = await readLine();
      return input;
    },
    onProgress: (message) => {
      console.log(message);
    },
    onManualCodeInput: provider.usesCallbackServer
      ? async () => {
          process.stdout.write(
            "\nOr paste the authorization code/URL here: "
          );
          return await readLine();
        }
      : undefined,
  });

  const auth = loadAuth();
  auth[providerId] = credentials;
  saveAuth(auth);

  console.log(`\nLogged in to ${provider.name} successfully.`);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export function logout(providerId?: string): void {
  const auth = loadAuth();

  if (providerId) {
    if (auth[providerId]) {
      delete auth[providerId];
      saveAuth(auth);
      console.log(`Logged out of ${providerId}.`);
    } else {
      console.log(`No credentials found for ${providerId}.`);
    }
  } else {
    saveAuth({});
    console.log("Logged out of all providers.");
  }
}

// ---------------------------------------------------------------------------
// Auth status
// ---------------------------------------------------------------------------

export function authStatus(): void {
  const auth = loadAuth();
  const providers = getOAuthProviders();

  if (providers.length === 0) {
    console.log("No OAuth providers available.");
    return;
  }

  console.log("Authentication status:\n");

  for (const provider of providers) {
    const creds = auth[provider.id];
    if (creds) {
      const expired = Date.now() >= creds.expires;
      const status = expired
        ? "token expired (will auto-refresh)"
        : "authenticated";
      console.log(`  ${provider.id.padEnd(22)} ✓ ${status}`);
    } else {
      console.log(`  ${provider.id.padEnd(22)} ✗ not authenticated`);
    }
  }

  console.log(
    "\nRun `gitgenie login <provider>` to authenticate with a provider."
  );
}

// ---------------------------------------------------------------------------
// List providers
// ---------------------------------------------------------------------------

export function listProviders(): void {
  const auth = loadAuth();
  const oauthProviders = getOAuthProviders();

  console.log("Available OAuth providers:\n");

  for (const provider of oauthProviders) {
    const creds = auth[provider.id];
    const status = creds ? "✓ logged in" : "✗ not authenticated";
    console.log(`  ${provider.id.padEnd(22)} ${status}    ${provider.name}`);
  }

  console.log(
    "\nRun `gitgenie login <provider>` to authenticate."
  );
}

// ---------------------------------------------------------------------------
// List models
// ---------------------------------------------------------------------------

export function listModelsCmd(providerFilter?: string): void {
  const allProviders = getProviders();

  const providers = providerFilter
    ? allProviders.filter((p) => p === providerFilter)
    : allProviders;

  if (providers.length === 0) {
    if (providerFilter) {
      console.error(`Unknown provider: ${providerFilter}`);
      console.error(`Available providers: ${allProviders.join(", ")}`);
    } else {
      console.error("No providers available.");
    }
    process.exit(1);
  }

  for (const provider of providers) {
    const models = getModels(provider as KnownProvider);
    console.log(`\n${provider} (${models.length} models):`);
    for (const model of models) {
      const features: string[] = [];
      if (model.reasoning) features.push("reasoning");
      if (model.input.includes("image")) features.push("vision");
      const featureStr = features.length > 0 ? ` [${features.join(", ")}]` : "";
      console.log(`  ${model.id}${featureStr}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Get API key for a provider (with auto-refresh)
// ---------------------------------------------------------------------------

/** Map from OAuth provider ID to the pi-ai KnownProvider used for model lookup */
const OAUTH_TO_MODEL_PROVIDER: Record<string, string> = {
  anthropic: "anthropic",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
  "google-gemini-cli": "google-gemini-cli",
  "google-antigravity": "google-antigravity",
};

/**
 * Resolve the OAuth provider ID from the pi-ai model provider string.
 * For most providers they match. For some (e.g. openai uses openai-codex OAuth) they differ.
 */
export function resolveOAuthProviderId(modelProvider: string): string {
  // Direct match check first
  const oauthProvider = getOAuthProvider(modelProvider);
  if (oauthProvider) return modelProvider;

  // Some model providers don't have their own OAuth — not supported
  return modelProvider;
}

export async function getApiKeyForProvider(
  oauthProviderId: string
): Promise<string> {
  const auth = loadAuth();
  const creds = auth[oauthProviderId];

  if (!creds) {
    console.error(`Not authenticated with ${oauthProviderId}.`);
    console.error(`Run: gitgenie login ${oauthProviderId}`);
    process.exit(1);
  }

  const provider = getOAuthProvider(oauthProviderId);
  if (!provider) {
    console.error(`Unknown OAuth provider: ${oauthProviderId}`);
    process.exit(1);
  }

  // Check if token needs refresh
  if (Date.now() >= creds.expires) {
    try {
      const refreshed = await provider.refreshToken(creds);
      auth[oauthProviderId] = refreshed;
      saveAuth(auth);
      return provider.getApiKey(refreshed);
    } catch (err) {
      console.error(`Failed to refresh token for ${oauthProviderId}.`);
      console.error(`Please re-authenticate: gitgenie login ${oauthProviderId}`);
      process.exit(1);
    }
  }

  return provider.getApiKey(creds);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();

    const onData = (chunk: string) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        resolve(data.trim());
      }
    };

    process.stdin.on("data", onData);
  });
}
