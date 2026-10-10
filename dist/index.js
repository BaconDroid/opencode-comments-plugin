// @bun
// src/constants.ts
var COMMENT_CHECKER_EVENT = "PostToolUse";
var APPLY_PATCH_TOOL_NAME = "apply_patch";
var DEFAULT_TRIGGER_TOOLS = ["write", "edit", "apply_patch"];
var DEFAULT_CLI_TIMEOUT_MS = 5000;
var DEFAULT_DEDUP_WINDOW_MS = 30000;
var COMMENT_CHECKER_BINARY_NAME = process.platform === "win32" ? "comment-checker.exe" : "comment-checker";

// src/cli.ts
import { createRequire as createRequire2 } from "module";
import { dirname, join as join2 } from "path";
import { existsSync as existsSync2 } from "fs";

// src/downloader.ts
var {spawn } = globalThis.Bun;
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";

// src/core/debug.ts
function createDebugLog(prefix, enabled) {
  if (!enabled)
    return () => {};
  return (...args) => {
    const message = args.map((arg) => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" ");
    process.stderr.write(`[${new Date().toISOString()}] [${prefix}] ${message}
`);
  };
}

// src/downloader.ts
var debugLog = createDebugLog("comment-checker:downloader", process.env.COMMENT_CHECKER_DEBUG === "1");
var REPO = "code-yeongyu/go-claude-code-comment-checker";
var LATEST_URL = `https://github.com/${REPO}/releases/latest`;
var LATEST_TTL_MS = 24 * 60 * 60 * 1000;
var LATEST_CACHE_FILE = "latest.json";
var PLATFORM_MAP = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "amd64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "tar.gz" },
  "linux-x64": { os: "linux", arch: "amd64", ext: "tar.gz" },
  "win32-x64": { os: "windows", arch: "amd64", ext: "zip" }
};
function getCacheDir() {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), ".cache");
  return join(base, "opencode-comments-plugin", "bin");
}
function getCachedBinaryPath(version) {
  if (!version)
    return null;
  const binaryPath = join(getCacheDir(), version, COMMENT_CHECKER_BINARY_NAME);
  return existsSync(binaryPath) ? binaryPath : null;
}
function getCommentCheckerVersion() {
  try {
    const require2 = createRequire(import.meta.url);
    const pkg = require2("@code-yeongyu/comment-checker/package.json");
    const version = pkg?.version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}
function parseLatestTag(location) {
  if (!location)
    return null;
  const match = location.match(/\/tag\/v?(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}
function getLatestCachePath() {
  return join(getCacheDir(), LATEST_CACHE_FILE);
}
function readLatestCache() {
  try {
    const parsed = JSON.parse(readFileSync(getLatestCachePath(), "utf8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0 && typeof parsed.checkedAt === "number") {
      return { version: parsed.version, checkedAt: parsed.checkedAt };
    }
  } catch {
    debugLog("no latest-version cache");
  }
  return null;
}
function writeLatestCache(version) {
  try {
    const dir = getCacheDir();
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
    writeFileSync(getLatestCachePath(), JSON.stringify({ version, checkedAt: Date.now() }));
  } catch (err) {
    debugLog("failed to cache latest version:", err);
  }
}
function getPreferredCommentCheckerVersionSync() {
  return readLatestCache()?.version ?? getCommentCheckerVersion();
}
async function getLatestCommentCheckerVersion() {
  const cached = readLatestCache();
  if (cached && Date.now() - cached.checkedAt < LATEST_TTL_MS) {
    return cached.version;
  }
  try {
    const response = await fetch(LATEST_URL, { redirect: "manual" });
    const version = parseLatestTag(response.headers.get("location"));
    if (version) {
      debugLog("resolved latest comment-checker release:", version);
      writeLatestCache(version);
      return version;
    }
    debugLog("could not parse latest release location:", response.headers.get("location"));
  } catch (err) {
    debugLog("failed to resolve latest release:", err);
  }
  if (cached)
    return cached.version;
  return getCommentCheckerVersion();
}
function cleanupStaleCache(version) {
  let entries;
  try {
    entries = readdirSync(getCacheDir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === version || entry === LATEST_CACHE_FILE)
      continue;
    try {
      rmSync(join(getCacheDir(), entry), { recursive: true, force: true });
    } catch (err) {
      debugLog("Failed to remove stale cache entry:", entry, err);
    }
  }
}
async function extractTarGz(archivePath, destDir) {
  debugLog("Extracting tar.gz:", archivePath, "to", destDir);
  const proc = spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`);
  }
}
async function extractZip(archivePath, destDir) {
  debugLog("Extracting zip:", archivePath, "to", destDir);
  const proc = process.platform === "win32" ? spawn(["powershell", "-command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
    stdout: "pipe",
    stderr: "pipe"
  }) : spawn(["unzip", "-o", archivePath, "-d", destDir], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`);
  }
}
async function downloadCommentChecker(versionOverride) {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformInfo = PLATFORM_MAP[platformKey];
  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey);
    return null;
  }
  const version = versionOverride ?? getCommentCheckerVersion();
  if (!version) {
    debugLog("Cannot resolve a comment-checker version; refusing to download a stale binary");
    return null;
  }
  const cacheDir = join(getCacheDir(), version);
  const binaryName = COMMENT_CHECKER_BINARY_NAME;
  const binaryPath = join(cacheDir, binaryName);
  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath);
    return binaryPath;
  }
  const { os, arch, ext } = platformInfo;
  const assetName = `comment-checker_v${version}_${os}_${arch}.${ext}`;
  const downloadUrl = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`;
  debugLog("Downloading from:", downloadUrl);
  console.log("[opencode-comments-plugin] Downloading comment-checker binary...");
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const archivePath = join(cacheDir, assetName);
    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(archivePath, arrayBuffer);
    debugLog("Downloaded archive to:", archivePath);
    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir);
    } else {
      await extractZip(archivePath, cacheDir);
    }
    if (existsSync(archivePath)) {
      unlinkSync(archivePath);
    }
    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 493);
    }
    debugLog("Successfully downloaded binary to:", binaryPath);
    console.log("[opencode-comments-plugin] comment-checker binary ready.");
    cleanupStaleCache(version);
    return binaryPath;
  } catch (err) {
    debugLog("Failed to download:", err);
    console.error(`[opencode-comments-plugin] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`);
    console.error("[opencode-comments-plugin] Comment checking disabled.");
    return null;
  }
}
async function ensureCommentCheckerBinary(versionOverride) {
  const version = versionOverride ?? await getLatestCommentCheckerVersion();
  if (!version)
    return null;
  const cachedPath = getCachedBinaryPath(version);
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath);
    cleanupStaleCache(version);
    return cachedPath;
  }
  return downloadCommentChecker(version);
}
var TEST_REPO = "BaconDroid/go-claude-code-test-checker";
var TEST_LATEST_URL = `https://github.com/${TEST_REPO}/releases/latest`;
function getTestCheckerCacheDir() {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), ".cache");
  return join(base, "opencode-comments-plugin", "test-checker");
}
function getTestCheckerBinaryName() {
  return process.platform === "win32" ? "test-checker.exe" : "test-checker";
}
function getCachedTestCheckerPath(version) {
  if (!version)
    return null;
  const binaryPath = join(getTestCheckerCacheDir(), version, getTestCheckerBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
}
function getTestCheckerVersion() {
  const version = process.env.TEST_CHECKER_VERSION;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : null;
}
function getTestLatestCachePath() {
  return join(getTestCheckerCacheDir(), LATEST_CACHE_FILE);
}
function readTestLatestCache() {
  try {
    const parsed = JSON.parse(readFileSync(getTestLatestCachePath(), "utf8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0 && typeof parsed.checkedAt === "number") {
      return { version: parsed.version, checkedAt: parsed.checkedAt };
    }
  } catch {
    debugLog("no test-checker latest-version cache");
  }
  return null;
}
function writeTestLatestCache(version) {
  try {
    const dir = getTestCheckerCacheDir();
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
    writeFileSync(getTestLatestCachePath(), JSON.stringify({ version, checkedAt: Date.now() }));
  } catch (err) {
    debugLog("failed to cache test-checker latest version:", err);
  }
}
function getPreferredTestCheckerVersionSync() {
  return readTestLatestCache()?.version ?? getTestCheckerVersion();
}
async function getLatestTestCheckerVersion() {
  const cached = readTestLatestCache();
  if (cached && Date.now() - cached.checkedAt < LATEST_TTL_MS) {
    return cached.version;
  }
  try {
    const response = await fetch(TEST_LATEST_URL, { redirect: "manual" });
    const version = parseLatestTag(response.headers.get("location"));
    if (version) {
      debugLog("resolved latest test-checker release:", version);
      writeTestLatestCache(version);
      return version;
    }
    debugLog("could not parse latest test-checker release location:", response.headers.get("location"));
  } catch (err) {
    debugLog("failed to resolve latest test-checker release:", err);
  }
  if (cached)
    return cached.version;
  return getTestCheckerVersion();
}
function cleanupTestCheckerStaleCache(version) {
  let entries;
  try {
    entries = readdirSync(getTestCheckerCacheDir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === version || entry === LATEST_CACHE_FILE)
      continue;
    try {
      rmSync(join(getTestCheckerCacheDir(), entry), { recursive: true, force: true });
    } catch (err) {
      debugLog("Failed to remove stale test-checker cache entry:", entry, err);
    }
  }
}
async function downloadTestChecker(versionOverride) {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformInfo = PLATFORM_MAP[platformKey];
  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey);
    return null;
  }
  const version = versionOverride ?? getTestCheckerVersion();
  if (!version) {
    debugLog("Cannot resolve a test-checker version; refusing to download a stale binary");
    return null;
  }
  const cacheDir = join(getTestCheckerCacheDir(), version);
  const binaryName = getTestCheckerBinaryName();
  const binaryPath = join(cacheDir, binaryName);
  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath);
    return binaryPath;
  }
  const { os, arch, ext } = platformInfo;
  const assetName = `test-checker_v${version}_${os}_${arch}.${ext}`;
  const downloadUrl = `https://github.com/${TEST_REPO}/releases/download/v${version}/${assetName}`;
  debugLog("Downloading from:", downloadUrl);
  console.log("[opencode-comments-plugin] Downloading test-checker binary...");
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const archivePath = join(cacheDir, assetName);
    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(archivePath, arrayBuffer);
    debugLog("Downloaded archive to:", archivePath);
    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir);
    } else {
      await extractZip(archivePath, cacheDir);
    }
    if (existsSync(archivePath)) {
      unlinkSync(archivePath);
    }
    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 493);
    }
    debugLog("Successfully downloaded binary to:", binaryPath);
    console.log("[opencode-comments-plugin] test-checker binary ready.");
    cleanupTestCheckerStaleCache(version);
    return binaryPath;
  } catch (err) {
    debugLog("Failed to download test-checker:", err);
    console.error(`[opencode-comments-plugin] Failed to download test-checker: ${err instanceof Error ? err.message : err}`);
    console.error("[opencode-comments-plugin] Test checking disabled.");
    return null;
  }
}
async function ensureTestCheckerBinary(versionOverride) {
  const version = versionOverride ?? await getLatestTestCheckerVersion();
  if (!version)
    return null;
  const cachedPath = getCachedTestCheckerPath(version);
  if (cachedPath) {
    debugLog("Using cached test-checker binary:", cachedPath);
    cleanupTestCheckerStaleCache(version);
    return cachedPath;
  }
  return downloadTestChecker(version);
}

// src/core/runner.ts
var {spawn: spawn2 } = globalThis.Bun;
function runShellCommand(command, options = {}) {
  return runProcess(["/bin/sh", "-c", command], options);
}
async function runProcess(args, options = {}) {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_CLI_TIMEOUT_MS;
  try {
    const proc = spawn2(args, { stdin: options.stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
    if (options.stdin !== undefined && proc.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        proc.stdout.cancel().catch(() => {});
        proc.stderr.cancel().catch(() => {});
        resolve("timeout");
      }, timeoutMs);
      (async () => {
        try {
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode });
        } catch {
          clearTimeout(timer);
          resolve("timeout");
        }
      })();
    });
    return outcome;
  } catch {
    return "timeout";
  }
}

// src/cli.ts
var debugLog2 = createDebugLog("comment-checker:cli", process.env.COMMENT_CHECKER_DEBUG === "1");
function commentHookInput(options) {
  return {
    session_id: options.sessionID,
    tool_name: options.toolName,
    transcript_path: "",
    cwd: options.cwd,
    hook_event_name: COMMENT_CHECKER_EVENT,
    tool_input: options.toolInput
  };
}
function findCommentCheckerPathSync() {
  const binaryName = COMMENT_CHECKER_BINARY_NAME;
  const version = getPreferredCommentCheckerVersionSync();
  if (!version) {
    debugLog2("cannot resolve comment-checker version; comment checking disabled");
    return null;
  }
  if (getCommentCheckerVersion() === version) {
    try {
      const require2 = createRequire2(import.meta.url);
      const cliPkgPath = require2.resolve("@code-yeongyu/comment-checker/package.json");
      const cliDir = dirname(cliPkgPath);
      const binaryPath = join2(cliDir, "bin", binaryName);
      if (existsSync2(binaryPath)) {
        debugLog2("found binary in main package:", binaryPath);
        return binaryPath;
      }
    } catch {
      debugLog2("main package not installed");
    }
  }
  const cachedPath = getCachedBinaryPath(version);
  if (cachedPath) {
    debugLog2("found binary in cache:", cachedPath);
    cleanupStaleCache(version);
    return cachedPath;
  }
  debugLog2("no binary found in known locations");
  return null;
}
var resolvedCliPath = null;
var initPromise = null;
async function getCommentCheckerPath() {
  if (resolvedCliPath !== null) {
    return resolvedCliPath;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const version = await getLatestCommentCheckerVersion();
    if (!version) {
      debugLog2("cannot resolve a comment-checker version; comment checking disabled");
      return null;
    }
    const syncPath = findCommentCheckerPathSync();
    if (syncPath && existsSync2(syncPath)) {
      resolvedCliPath = syncPath;
      debugLog2("using sync-resolved path:", syncPath);
      return syncPath;
    }
    debugLog2("triggering lazy download...");
    const downloadedPath = await ensureCommentCheckerBinary(version);
    if (downloadedPath) {
      resolvedCliPath = downloadedPath;
      debugLog2("using downloaded path:", downloadedPath);
      return downloadedPath;
    }
    debugLog2("no binary available");
    return null;
  })();
  return initPromise;
}
function getCommentCheckerPathSync() {
  return resolvedCliPath ?? findCommentCheckerPathSync();
}
function startBackgroundInit() {
  if (initPromise)
    return;
  initPromise = getCommentCheckerPath();
  initPromise.then((path) => {
    debugLog2("background init complete:", path || "no binary");
  }).catch((err) => {
    debugLog2("background init error:", err);
  });
}
async function runCommentChecker(input, options = {}) {
  const binaryPath = options.cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync();
  if (!binaryPath) {
    debugLog2("comment-checker binary not found");
    return { hasComments: false, message: "" };
  }
  if (!existsSync2(binaryPath)) {
    debugLog2("comment-checker binary does not exist:", binaryPath);
    return { hasComments: false, message: "" };
  }
  const jsonInput = JSON.stringify(input);
  debugLog2("running comment-checker with input:", jsonInput.substring(0, 200));
  const args = [binaryPath];
  if (options.prompt && options.prompt.trim().length > 0) {
    args.push("--prompt", options.prompt);
  }
  const outcome = await runProcess(args, { stdin: jsonInput, timeoutMs: options.timeoutMs });
  if (outcome === "timeout") {
    debugLog2("comment-checker abandoned after timeout or stream failure");
    return { hasComments: false, message: "" };
  }
  const { stdout, stderr, exitCode } = outcome;
  debugLog2("exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length);
  if (exitCode === 0) {
    return { hasComments: false, message: "" };
  }
  if (exitCode === 2) {
    return { hasComments: true, message: stderr };
  }
  debugLog2("unexpected exit code:", exitCode, "stderr:", stderr);
  return { hasComments: false, message: "" };
}
function findTestCheckerPathSync() {
  const version = getPreferredTestCheckerVersionSync();
  if (!version) {
    debugLog2("cannot resolve a test-checker version; binary engine unavailable");
    return null;
  }
  const cachedPath = getCachedTestCheckerPath(version);
  if (cachedPath) {
    debugLog2("found test-checker in cache:", cachedPath);
    cleanupTestCheckerStaleCache(version);
    return cachedPath;
  }
  debugLog2("no test-checker binary found in known locations");
  return null;
}
var resolvedTestCliPath = null;
var testInitPromise = null;
async function getTestCheckerPath() {
  if (resolvedTestCliPath !== null) {
    return resolvedTestCliPath;
  }
  if (testInitPromise) {
    return testInitPromise;
  }
  testInitPromise = (async () => {
    const version = await getLatestTestCheckerVersion();
    if (!version) {
      debugLog2("cannot resolve a test-checker version; binary engine unavailable");
      return null;
    }
    const syncPath = findTestCheckerPathSync();
    if (syncPath && existsSync2(syncPath)) {
      resolvedTestCliPath = syncPath;
      debugLog2("using sync-resolved test-checker path:", syncPath);
      return syncPath;
    }
    debugLog2("triggering lazy test-checker download...");
    const downloadedPath = await ensureTestCheckerBinary(version);
    if (downloadedPath) {
      resolvedTestCliPath = downloadedPath;
      debugLog2("using downloaded test-checker path:", downloadedPath);
      return downloadedPath;
    }
    debugLog2("no test-checker binary available");
    return null;
  })();
  return testInitPromise;
}
function getTestCheckerPathSync() {
  return resolvedTestCliPath ?? findTestCheckerPathSync();
}
function startTestCheckerBackgroundInit() {
  if (testInitPromise)
    return;
  testInitPromise = getTestCheckerPath();
  testInitPromise.then((path) => {
    debugLog2("test-checker background init complete:", path || "no binary");
  }).catch((err) => {
    debugLog2("test-checker background init error:", err);
  });
}
async function runTestChecker(input, options = {}) {
  const binaryPath = options.cliPath ?? resolvedTestCliPath ?? getTestCheckerPathSync();
  if (!binaryPath || !existsSync2(binaryPath)) {
    debugLog2("test-checker binary not found");
    return null;
  }
  const jsonInput = JSON.stringify(input);
  debugLog2("running test-checker with input:", jsonInput.substring(0, 200));
  const outcome = await runProcess([binaryPath], { stdin: jsonInput, timeoutMs: options.timeoutMs });
  if (outcome === "timeout") {
    debugLog2("test-checker abandoned after timeout or stream failure");
    return null;
  }
  const { stdout, stderr, exitCode } = outcome;
  debugLog2("test-checker exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length);
  if (exitCode === 0)
    return [];
  if (exitCode !== 2) {
    debugLog2("unexpected test-checker exit code:", exitCode, "stderr:", stderr);
    return null;
  }
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed.findings))
      return null;
    const findings = [];
    for (const entry of parsed.findings) {
      if (!entry || typeof entry !== "object")
        continue;
      const record = entry;
      const rule = typeof record.rule === "string" && record.rule.length > 0 ? record.rule : undefined;
      if (!rule)
        continue;
      const lineValue = typeof record.line === "number" ? record.line : Number(record.line);
      const message = typeof record.message === "string" ? record.message : "";
      const file = typeof record.file === "string" && record.file.length > 0 ? record.file : input.tool_input.file_path;
      findings.push({
        rule,
        filePath: file,
        line: Number.isFinite(lineValue) ? lineValue : 0,
        message,
        excerpt: message
      });
    }
    return findings;
  } catch (err) {
    debugLog2("failed to parse test-checker output:", err);
    return null;
  }
}

// src/core/config.ts
function asEngine(value) {
  if (typeof value !== "string")
    return;
  const normalized = value.trim().toLowerCase();
  if (normalized === "binary" || normalized === "regex")
    return normalized;
  return;
}
function optionContainer(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  const object = value;
  const nested = object[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  return object;
}
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function asCount(value, minimum) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : undefined;
}
function asTools(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined;
  if (!entries)
    return;
  const tools = entries.filter((entry) => typeof entry === "string").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  return tools.length > 0 ? tools : undefined;
}
function asPatterns(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined;
  if (!entries)
    return;
  const patterns = entries.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return patterns.length > 0 ? patterns : undefined;
}
function asBoolean(value, fallback) {
  if (typeof value === "boolean")
    return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
      return true;
    if (["0", "false", "no", "off"].includes(normalized))
      return false;
  }
  if (typeof value === "number")
    return value !== 0;
  return fallback;
}
function asLevel(value) {
  if (typeof value !== "string")
    return;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off" || normalized === "warn")
    return normalized;
  return;
}
function resolveOption(coerce, envKey, key, inputs) {
  return coerce(process.env[envKey]) ?? coerce(inputs.options?.[key]) ?? coerce(inputs.config?.[key]);
}
function resolveRuleConfig(schema, sources) {
  const optionsChecks = asRecord(sources.options?.checks);
  const configChecks = asRecord(sources.config?.checks);
  const resolved = {};
  for (const [rule, fallback] of Object.entries(schema)) {
    const envKey = `${sources.envPrefix}CHECK_${rule.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const level = asLevel(process.env[envKey]) ?? asLevel(optionsChecks?.[rule]) ?? asLevel(configChecks?.[rule]) ?? fallback;
    resolved[rule] = level;
  }
  return resolved;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  return value;
}

// src/core/analyzer.ts
function runAnalyzer(analyzer, ctx) {
  try {
    if (!analyzer.isEnabled())
      return {};
    return analyzer.analyze(ctx);
  } catch {
    return {};
  }
}

class AnalyzerRegistry {
  analyzers = [];
  register(analyzer) {
    this.analyzers.push(analyzer);
  }
  forTrigger(trigger) {
    return this.analyzers.filter((analyzer) => analyzer.trigger === trigger);
  }
  async run(trigger, ctx) {
    const results = [];
    for (const analyzer of this.forTrigger(trigger)) {
      try {
        if (!analyzer.isEnabled())
          continue;
        results.push(await analyzer.analyze(ctx));
      } catch {}
    }
    return results;
  }
}

// src/core/budget.ts
class GuardBudget {
  dedupWindowMs;
  ttlMs;
  maxWarningsPerFile;
  seen = new Map;
  perFile = new Map;
  constructor(options = {}) {
    this.dedupWindowMs = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
    this.ttlMs = options.ttlMs ?? 60000;
    this.maxWarningsPerFile = options.maxWarningsPerFile ?? 0;
  }
  setMaxWarningsPerFile(value) {
    this.maxWarningsPerFile = value;
  }
  setDedupWindowMs(value) {
    this.dedupWindowMs = value;
  }
  key(sessionID, ruleID, filePath) {
    return `${sessionID}\x00${ruleID}\x00${filePath}`;
  }
  fileKey(sessionID, filePath) {
    return `${sessionID}\x00${filePath}`;
  }
  cleanup(now = Date.now()) {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs)
        this.seen.delete(key);
    }
    for (const [key, counter] of this.perFile) {
      if (now - counter.lastSeen > this.ttlMs)
        this.perFile.delete(key);
    }
  }
  shouldEmit(sessionID, ruleID, filePath, now = Date.now()) {
    this.cleanup(now);
    const key = this.key(sessionID, ruleID, filePath);
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.dedupWindowMs)
      return false;
    if (this.maxWarningsPerFile > 0) {
      const counter = this.perFile.get(this.fileKey(sessionID, filePath));
      if (counter && counter.count >= this.maxWarningsPerFile)
        return false;
    }
    return true;
  }
  record(sessionID, ruleID, filePath, now = Date.now()) {
    this.seen.set(this.key(sessionID, ruleID, filePath), now);
    if (this.maxWarningsPerFile <= 0)
      return;
    const key = this.fileKey(sessionID, filePath);
    const existing = this.perFile.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
    } else {
      this.perFile.set(key, { count: 1, lastSeen: now });
    }
  }
  touch(sessionID, now = Date.now()) {
    const prefix = `${sessionID}\x00`;
    for (const [key, counter] of this.perFile) {
      if (key.startsWith(prefix))
        counter.lastSeen = now;
    }
  }
}

// src/core/diff.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
var EXTENSION_LANGUAGE = {
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".ts": "ts",
  ".tsx": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust"
};
function detectLanguage(filePath) {
  const match = filePath.toLowerCase().match(/\.[a-z0-9]+$/);
  if (!match)
    return "unknown";
  return EXTENSION_LANGUAGE[match[0]] ?? "unknown";
}
function isSupportedLanguage(language) {
  return language !== "unknown";
}
function diffLines(oldText, newText) {
  const oldLines = oldText.length > 0 ? oldText.split(`
`) : [];
  const newLines = newText.length > 0 ? newText.split(`
`) : [];
  const oldCount = new Map;
  const newCount = new Map;
  for (const line of oldLines)
    oldCount.set(line, (oldCount.get(line) ?? 0) + 1);
  for (const line of newLines)
    newCount.set(line, (newCount.get(line) ?? 0) + 1);
  const added = [];
  const removed = [];
  for (const [line, count] of newCount) {
    const previous = oldCount.get(line) ?? 0;
    for (let i = 0;i < count - previous; i++)
      added.push(line);
  }
  for (const [line, count] of oldCount) {
    const next = newCount.get(line) ?? 0;
    for (let i = 0;i < count - next; i++)
      removed.push(line);
  }
  return { added, removed };
}
function extractChange(raw) {
  const { added, removed } = diffLines(raw.oldText, raw.newText);
  return {
    filePath: raw.filePath,
    oldText: raw.oldText,
    newText: raw.newText,
    addedLines: added,
    removedLines: removed,
    isNew: raw.isNew,
    isDelete: raw.isDelete,
    language: detectLanguage(raw.filePath)
  };
}
var LINE_COMMENT = {
  js: ["//"],
  ts: ["//"],
  python: ["#"],
  go: ["//"],
  rust: ["//"],
  unknown: ["//", "#"]
};
function stripComments(text, language) {
  const markers = LINE_COMMENT[language] ?? ["//"];
  let out = text;
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  if (language === "python") {
    out = out.replace(/"""[\s\S]*?"""/g, "");
    out = out.replace(/'''[\s\S]*?'''/g, "");
  }
  const lines = out.split(`
`);
  const stripped = lines.map((line) => {
    if (line.trimStart().startsWith("#!"))
      return "";
    let result = line;
    for (const marker of markers) {
      const index = findCommentIndex(result, marker);
      if (index >= 0) {
        result = result.slice(0, index);
        break;
      }
    }
    return result;
  });
  return stripped.join(`
`);
}
function findCommentIndex(line, marker) {
  let quote;
  for (let i = 0;i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote)
        quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (line.startsWith(marker, i))
      return i;
  }
  return -1;
}
function maskStrings(text) {
  const chars = text.split("");
  let quote;
  for (let i = 0;i < chars.length; i++) {
    const char = chars[i];
    if (quote) {
      if (char === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length && chars[i + 1] !== `
`)
          chars[i + 1] = " ";
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = undefined;
        chars[i] = " ";
      } else if (char !== `
`) {
        chars[i] = " ";
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      chars[i] = " ";
    }
  }
  return chars.join("");
}
function stripStringLiterals(text) {
  let out = "";
  let quote;
  for (let i = 0;i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote)
        quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    out += char;
  }
  return out;
}
function isCommentLine(line, language) {
  const trimmed = line.trim();
  if (trimmed.length === 0)
    return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/"))
    return true;
  if (language === "python" && (trimmed.startsWith("#") || trimmed.startsWith('"""') || trimmed.startsWith("'''")))
    return true;
  return false;
}
function countRealLines(text, language) {
  return text.split(`
`).map((line) => stripComments(line, language)).filter((line) => line.trim().length > 0).length;
}
function stringValue(record, keys, requireNonEmpty) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && (!requireNonEmpty || value.length > 0))
      return value;
  }
  return;
}
function readString(record, ...keys) {
  return stringValue(record, keys, false);
}
function firstString(record, ...keys) {
  return stringValue(record, keys, true);
}
function readFileIfExists(filePath) {
  try {
    return existsSync3(filePath) ? readFileSync2(filePath, "utf8") : undefined;
  } catch {
    return;
  }
}
function changeTextsFromTool(tool, args, preimage) {
  const toolLower = tool.toLowerCase();
  if (toolLower === "write" || toolLower === "create") {
    const content = readString(args, "content", "file_text", "text") ?? "";
    return { oldText: preimage ?? "", newText: content };
  }
  if (toolLower === "edit" || toolLower === "patch") {
    const edits = args.edits;
    if (Array.isArray(edits) && edits.length > 0) {
      let oldText = "";
      let newText = "";
      for (const entry of edits) {
        if (!entry || typeof entry !== "object")
          continue;
        const record = entry;
        oldText += (readString(record, "old_string", "oldString") ?? "") + `
`;
        newText += (readString(record, "new_string", "newString") ?? "") + `
`;
      }
      return { oldText, newText };
    }
    return {
      oldText: readString(args, "oldString", "old_string") ?? "",
      newText: readString(args, "newString", "new_string") ?? ""
    };
  }
  return;
}
function extractToolChange(tool, args, preimage) {
  const filePath = firstString(args, "filePath", "file_path", "path");
  if (!filePath)
    return;
  const texts = changeTextsFromTool(tool, args, preimage);
  if (!texts)
    return;
  const toolLower = tool.toLowerCase();
  const isWrite = toolLower === "write" || toolLower === "create";
  return extractChange({
    filePath,
    oldText: texts.oldText,
    newText: texts.newText,
    isNew: isWrite && preimage === undefined,
    isDelete: false
  });
}
function splitPatch(patch) {
  const removed = [];
  const added = [];
  for (const line of patch.split(`
`)) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++"))
      continue;
    if (line.startsWith("-"))
      removed.push(line.slice(1));
    else if (line.startsWith("+"))
      added.push(line.slice(1));
  }
  return { oldText: removed.join(`
`), newText: added.join(`
`) };
}
function toPatchEntries(metadata) {
  const files = metadata?.files;
  if (!Array.isArray(files))
    return [];
  const entries = [];
  for (const file of files) {
    if (!file || typeof file !== "object")
      continue;
    const entry = file;
    entries.push({
      type: typeof entry.type === "string" ? entry.type : undefined,
      filePath: typeof entry.filePath === "string" ? entry.filePath : undefined,
      movePath: typeof entry.movePath === "string" ? entry.movePath : undefined,
      patch: typeof entry.patch === "string" ? entry.patch : undefined
    });
  }
  return entries;
}
function extractPatchChanges(metadata) {
  const changes = [];
  for (const entry of toPatchEntries(metadata)) {
    const filePath = entry.movePath ?? entry.filePath;
    if (!filePath)
      continue;
    const isDelete = entry.type === "delete";
    const sides = entry.patch ? splitPatch(entry.patch) : { oldText: "", newText: "" };
    changes.push(extractChange({
      filePath,
      oldText: sides.oldText,
      newText: sides.newText,
      isNew: entry.type === "add",
      isDelete
    }));
  }
  return changes;
}

// src/core/feedback.ts
var TEST_GUARD_MARKER = "<!-- opencode-test-guard -->";
var DEFAULT_CUSTOM_PROMPT = `TEST QUALITY DETECTED:
{{findings}}

Fix the cause, do not weaken the test.`;
function truncateExcerpt(excerpt, max) {
  const oneLine = excerpt.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(0, max - 1))}\u2026` : oneLine;
}
function formatFindings(findings, maxExcerpt = 80) {
  return findings.map((finding) => {
    const location = `${finding.filePath}:${finding.line}`;
    return `- [${finding.severity}] ${finding.rule} (${location}): ${finding.message}
  > ${truncateExcerpt(finding.excerpt, maxExcerpt)}`;
  }).join(`
`);
}
function renderFeedback(findings, options = {}) {
  if (findings.length === 0)
    return "";
  const body = formatFindings(findings, options.maxExcerpt);
  const template = options.customPrompt?.includes("{{findings}}") ? options.customPrompt : DEFAULT_CUSTOM_PROMPT;
  const rendered = template.replace(/\{\{findings\}\}/g, body);
  return options.appendPrompt ? `${rendered}

${options.appendPrompt}` : rendered;
}
function appendGuardMessage(output, message, marker) {
  if (message.length === 0)
    return;
  if (marker && output.output.includes(marker))
    return;
  output.output += marker ? `

${marker}
${message}` : `

${message}`;
}
function appendFeedback(output, message) {
  appendGuardMessage(output, message, TEST_GUARD_MARKER);
}

// src/core/pending.ts
var PENDING_CALL_TTL = 60000;

class PendingCallStore {
  entries = new Map;
  ttlMs;
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? PENDING_CALL_TTL;
  }
  set(callID, value, now = Date.now()) {
    this.entries.set(callID, { value, timestamp: now });
  }
  get(callID) {
    return this.entries.get(callID)?.value;
  }
  take(callID) {
    const entry = this.entries.get(callID);
    if (!entry)
      return;
    this.entries.delete(callID);
    return entry.value;
  }
  delete(callID) {
    this.entries.delete(callID);
  }
  prune(now = Date.now()) {
    for (const [callID, entry] of this.entries) {
      if (now - entry.timestamp > this.ttlMs)
        this.entries.delete(callID);
    }
  }
}

// src/core/result-pipeline.ts
function formatBypassNote(filePath, bypass) {
  return `${filePath}:${bypass.line} ${bypass.kind}${bypass.reason ? ` (${bypass.reason})` : ""}`;
}
function renderBypassFooter(title, entries) {
  return `${title}:
${entries.map((entry) => `- ${entry}`).join(`
`)}`;
}
function renderAnalyzerResults(results, options = {}) {
  try {
    const findings = [];
    const raws = [];
    for (const result of results) {
      if (result.findings)
        findings.push(...result.findings);
      if (result.raw)
        raws.push(result.raw);
    }
    if (findings.length > 0)
      return renderFeedback(findings, options);
    if (raws.length === 0)
      return "";
    const raw = raws.join(`

`);
    return options.appendPrompt ? `${raw}

${options.appendPrompt}` : raw;
  } catch {
    return "";
  }
}

// src/core/triggers.ts
function isTriggeredTool(triggerTools, toolLower, fallback = DEFAULT_TRIGGER_TOOLS) {
  return triggerTools ? triggerTools.has(toolLower) : fallback.includes(toolLower);
}

// src/core/glob.ts
function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, "/");
  let source = "^";
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 2;
        if (normalized[index] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
        index += 1;
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    if ("\\^$.|+()[]{}".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
    index += 1;
  }
  source += "$";
  return new RegExp(source);
}
var cache = new Map;
function matchesGlob(pattern, filePath) {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern);
    cache.set(pattern, regex);
  }
  return regex.test(filePath.replace(/\\/g, "/"));
}
function matchesAnyGlob(patterns, filePath) {
  return patterns.some((pattern) => matchesGlob(pattern, filePath));
}
function matchPathFilter(patterns, filePath, fallback) {
  if (patterns.length === 0)
    return fallback ? matchesAnyGlob(fallback, filePath) : true;
  return matchesAnyGlob(patterns, filePath);
}

// src/rules/tests/patterns.ts
var DEFAULT_TEST_PATTERNS = [
  "**/*.test.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.spec.*"
];
function isTestPath(filePath, patterns) {
  return matchPathFilter(patterns, filePath, DEFAULT_TEST_PATTERNS);
}
var SKIP_FOCUS_PATTERNS = {
  js: [/\.(?:skip|only|todo)\s*\(/, /\b(?:xit|xdescribe|xtest)\s*\(/],
  ts: [/\.(?:skip|only|todo)\s*\(/, /\b(?:xit|xdescribe|xtest)\s*\(/],
  python: [
    /@pytest\.mark\.skip(?!if)/,
    /@pytest\.mark\.(?:xfail)/,
    /@unittest\.skip(?!If|Unless)/,
    /\.skipIf\s*\(/
  ],
  go: [/\bt\.Skip(?:f|Now)?\s*\(/],
  rust: [/#\[ignore\]/]
};
var CONDITIONAL_SKIP_PATTERNS = [
  /skipif/i,
  /skipIf(?:Unless)?\s*\(/,
  /@unittest\.skipIf/,
  /@unittest\.skipUnless/,
  /\bif\s+.*\bskip/i
];
var TAUTOLOGICAL_PATTERNS = [
  /\bassert\s+True\b/,
  /\bassertTrue\s*\(\s*True\s*\)/,
  /\bexpect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
  /\bassert\.ok\s*\(\s*true\s*\)/,
  /\bassertEquals\s*\(\s*(\w+)\s*,\s*\1\s*\)/,
  /\bassert\s+(\w+)\s*==\s*\1\b/
];
var ASSERTION_PATTERNS = [
  /\bassert\b/,
  /\bexpect\s*\(/,
  /\bfail\s*\(/,
  /\bverify\s*\(/,
  /\bshould\b/,
  /\braises\b/,
  /\bthrows\b/,
  /\bassertRaises\b/,
  /\bt\.(?:Error|Fatal)\b/,
  /\bpanic!\s*\(/,
  /\brequire\./
];
var ASSERTION_COUNT_PATTERNS = [
  /\bassert\w*\s*\(/,
  /\bassert\s+/,
  /\bexpect\s*\(/,
  /\bassertEqual\b/,
  /\bassertRaises\b/,
  /\bverify\b/,
  /\bassertThat\b/,
  /\bself\.assert\w+/
];
var MATCHER_LOOSENINGS = [
  { before: /assertEqual\s*\(/, after: /assertTrue\s*\(/, message: "assertEqual loosened to assertTrue" },
  { before: /\.toBe\s*\(/, after: /\.toBeTruthy\s*\(/, message: "toBe loosened to toBeTruthy" },
  { before: /\.toBe\s*\(/, after: /\.toBeDefined\s*\(/, message: "toBe loosened to toBeDefined" },
  {
    before: /assertRaises\s*\(\s*\w+/,
    after: /assertRaises\s*\(\s*Exception\s*\)/,
    message: "assertRaises narrowed to Exception"
  },
  { before: /\.toThrow\s*\(/, after: /\.not\.toThrow\s*\(/, message: "toThrow inverted to not.toThrow" }
];
var SWALLOWED_ERROR_PATTERNS = {
  js: [/catch\s*(?:\([^)]*\))?\s*\{\s*\}/],
  ts: [/catch\s*(?:\([^)]*\))?\s*\{\s*\}/],
  python: [/except\s+(?:Exception|BaseException)?\s*:\s*pass\b/],
  rust: [/Err\(_\)\s*=>\s*(?:\{\s*\}|\(\))/]
};
var MOCK_IDENTIFIER_PATTERNS = [
  /\b(?:dummy|stub|mock|spy|fake)[A-Za-z0-9_]*\b/i,
  /\bmonkeypatch\b/,
  /\bpatch\s*\(/
];
var WEAKENED_CONFIG_PATTERNS = [
  /\|\|\s*true\b/,
  /--passWithNoTests\b/,
  /\bcontinue-on-error\s*:\s*true\b/,
  /@ts-nocheck\b/,
  /#\s*ruff:\s*noqa/,
  /\bexit\s+0\b/,
  /\bfail_under\s*=\s*0\b/
];
var TESTS_NOT_RUN_PATTERNS = [
  /--ignore(?:=|\s)/,
  /--exclude\b/,
  /--deselect\b/,
  /-k\s+['"]?not\b/,
  /--testPathIgnorePatterns/,
  /--passWithNoTests\b/
];
var TEST_DECLARATION_PATTERNS = {
  js: /(?:^|[^\w.])(?:it|test|describe)(?:\.(?:skip|only|todo|each|concurrent))?\s*\(/,
  ts: /(?:^|[^\w.])(?:it|test|describe)(?:\.(?:skip|only|todo|each|concurrent))?\s*\(/,
  python: /^\s*(?:async\s+)?def\s+test_\w*\s*\(/,
  go: /^\s*func\s+Test\w*\s*\(/,
  rust: /#\[test\]/
};
var PLACEHOLDER_PATTERN = /^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i;
function hasAssertion(text) {
  return ASSERTION_PATTERNS.some((pattern) => pattern.test(text));
}
function countAssertions(lines) {
  let count = 0;
  for (const line of lines) {
    if (ASSERTION_COUNT_PATTERNS.some((pattern) => pattern.test(line)))
      count += 1;
  }
  return count;
}
function isConditionalSkip(line) {
  return CONDITIONAL_SKIP_PATTERNS.some((pattern) => pattern.test(line));
}

// src/core/bypass.ts
var BYPASS_WINDOW = 2;
function bypassMatchers(prefix) {
  return {
    allow: new RegExp(`${prefix}:\\s*allow\\b`, "i"),
    allowReason: new RegExp(`${prefix}:\\s*allow\\s*(.*)$`, "i"),
    disableFile: new RegExp(`${prefix}-disable-file\\b`, "i")
  };
}
function collectBypasses(text, matchers) {
  const bypasses = [];
  const lines = text.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const allow = line.match(matchers.allowReason);
    if (allow)
      bypasses.push({ kind: "allow", line: i + 1, reason: allow[1].trim() });
    if (matchers.disableFile.test(line))
      bypasses.push({ kind: "disable-file", line: i + 1, reason: "" });
  }
  return bypasses;
}
function isFileDisabled(text, matchers) {
  return matchers.disableFile.test(text);
}
function applyBypass(newText, matchers) {
  const notes = collectBypasses(newText, matchers);
  return {
    notes,
    fileDisabled: isFileDisabled(newText, matchers),
    covers: (line) => withinAllowWindow(newText, line, matchers)
  };
}
function withinAllowWindow(text, line, matchers, window = BYPASS_WINDOW) {
  if (line <= 0)
    return false;
  const lines = text.split(`
`);
  const from = Math.max(0, line - 1 - window);
  const to = Math.min(lines.length, line + window);
  for (let i = from;i < to; i++)
    if (matchers.allow.test(lines[i] ?? ""))
      return true;
  return false;
}

// src/rules/tests/content.ts
var MATCHERS = bypassMatchers("test-guard");
function codeText(line, language) {
  return stripStringLiterals(stripComments(line, language));
}
function blocksOf(ctx) {
  return ctx.blocks ?? findTestBlocks(ctx.change.newText, ctx.change.language);
}
function countAssertionsCode(lines, language) {
  return countAssertions(lines.map((line) => codeText(line, language)));
}
function normalizeAssertion(code) {
  return code.replace(/\s+/g, "").replace(/self\.(?=assert)/g, "").replace(/assertEqual/gi, "assertEquals").replace(/\.toBe\b/g, ".toEqual");
}
function uniqueAssertions(lines, language) {
  const set = new Set;
  for (const line of lines) {
    const code = codeText(line, language).trim();
    if (code.length === 0)
      continue;
    if (!ASSERTION_COUNT_PATTERNS.some((pattern) => pattern.test(code)))
      continue;
    set.add(normalizeAssertion(code));
  }
  return [...set];
}
function multiset(lines) {
  const map = new Map;
  for (const line of lines)
    map.set(line, (map.get(line) ?? 0) + 1);
  return map;
}
function locateLine(newText, needle) {
  const lines = newText.split(`
`);
  const exact = lines.findIndex((line) => line === needle);
  if (exact >= 0)
    return exact + 1;
  const trimmed = needle.trim();
  const loose = lines.findIndex((line) => line.trim() === trimmed);
  return loose >= 0 ? loose + 1 : 0;
}
function withinBypass(ctx, line) {
  return ctx.bypass?.covers(line) ?? false;
}
function testBypass(newText) {
  return applyBypass(newText, MATCHERS);
}
function collectBypasses2(change) {
  return testBypass(change.newText).notes;
}
function addedLineFindings(ctx, rule, patterns, message, skip) {
  const findings = [];
  for (const line of ctx.change.addedLines) {
    const code = codeText(line, ctx.change.language);
    const trimmed = code.trim();
    if (trimmed.length === 0)
      continue;
    if (skip?.(line))
      continue;
    if (!patterns.some((pattern) => pattern.test(code)))
      continue;
    const lineNumber = locateLine(ctx.change.newText, line);
    if (withinBypass(ctx, lineNumber))
      continue;
    findings.push({ rule, line: lineNumber, message, excerpt: stripComments(line, ctx.change.language).trim() });
  }
  return findings;
}
var skipFocusAddedRule = {
  id: "skip-focus-added",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const patterns = SKIP_FOCUS_PATTERNS[ctx.change.language];
    if (!patterns || patterns.length === 0)
      return [];
    return addedLineFindings(ctx, "skip-focus-added", patterns, "A test was disabled or focused (.skip/.only/.todo, xit/xdescribe, skip marker, #[ignore], t.Skip).", isConditionalSkip);
  }
};
var tautologicalAssertionRule = {
  id: "tautological-assertion",
  run(ctx) {
    return addedLineFindings(ctx, "tautological-assertion", TAUTOLOGICAL_PATTERNS, "Assertion is tautological (always true).");
  }
};
var swallowedErrorRule = {
  id: "swallowed-error",
  run(ctx) {
    const patterns = SWALLOWED_ERROR_PATTERNS[ctx.change.language];
    if (!patterns || patterns.length === 0)
      return [];
    const joined = ctx.change.addedLines.map((line) => codeText(line, ctx.change.language)).join(`
`);
    const findings = [];
    for (const pattern of patterns) {
      if (!pattern.test(joined))
        continue;
      const sample = ctx.change.addedLines.find((line) => pattern.test(codeText(line, ctx.change.language))) ?? ctx.change.addedLines[0] ?? "";
      const lineNumber = locateLine(ctx.change.newText, sample);
      if (withinBypass(ctx, lineNumber))
        continue;
      findings.push({
        rule: "swallowed-error",
        line: lineNumber,
        message: "Errors are swallowed (empty catch / except pass / Err(_) => {}).",
        excerpt: sample.trim()
      });
      break;
    }
    return findings;
  }
};
var guttedTestRule = {
  id: "gutted-test",
  run(ctx) {
    const removed = uniqueAssertions(ctx.change.removedLines, ctx.change.language).length;
    const added = uniqueAssertions(ctx.change.addedLines, ctx.change.language).length;
    if (removed <= 0 || added !== 0)
      return [];
    const declarations = TEST_DECLARATION_PATTERNS[ctx.change.language];
    if (declarations) {
      const before = ctx.change.removedLines.filter((line) => declarations.test(codeText(line, ctx.change.language))).length;
      const after = ctx.change.addedLines.filter((line) => declarations.test(codeText(line, ctx.change.language))).length;
      if (before !== after)
        return [];
    }
    const sample = ctx.change.removedLines.find((line) => ASSERTION_COUNT_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language)))) ?? "";
    return [{
      rule: "gutted-test",
      line: locateLine(ctx.change.oldText, sample),
      message: "All assertions were removed and nothing replaced them.",
      excerpt: sample.trim()
    }];
  }
};
var matcherLoosenedRule = {
  id: "matcher-loosened",
  run(ctx) {
    if (ctx.change.addedLines.length === 0 || ctx.change.removedLines.length === 0)
      return [];
    const findings = [];
    for (const loosening of MATCHER_LOOSENINGS) {
      const removedHit = ctx.change.removedLines.find((line) => {
        const code = codeText(line, ctx.change.language);
        return loosening.before.test(code) && !loosening.after.test(code);
      });
      if (!removedHit)
        continue;
      const addedHit = ctx.change.addedLines.find((line) => loosening.after.test(codeText(line, ctx.change.language)));
      if (!addedHit)
        continue;
      const lineNumber = locateLine(ctx.change.newText, addedHit);
      if (withinBypass(ctx, lineNumber))
        continue;
      findings.push({
        rule: "matcher-loosened",
        line: lineNumber,
        message: loosening.message,
        excerpt: addedHit.trim()
      });
    }
    return findings;
  }
};
function findTestBlocks(text, language) {
  const declaration = TEST_DECLARATION_PATTERNS[language];
  if (!declaration)
    return [];
  const stripped = stripComments(text, language);
  const searchable = maskStrings(stripped);
  if (language === "python")
    return findPythonBlocks(stripped.split(`
`), searchable.split(`
`), declaration);
  return findBraceBlocks(searchable, stripped, declaration);
}
function findPythonBlocks(lines, searchableLines, declaration) {
  const blocks = [];
  for (let i = 0;i < searchableLines.length; i++) {
    const searchable = searchableLines[i];
    if (!declaration.test(searchable))
      continue;
    const indent = searchable.length - searchable.trimStart().length;
    let end = i + 1;
    while (end < searchableLines.length) {
      const candidate = searchableLines[end];
      if (candidate.trim().length === 0) {
        end += 1;
        continue;
      }
      const candidateIndent = candidate.length - candidate.trimStart().length;
      if (candidateIndent <= indent)
        break;
      end += 1;
    }
    blocks.push({ startLine: i + 1, endLine: end, lines: lines.slice(i + 1, end) });
    i = end - 1;
  }
  return blocks;
}
function findBraceBlocks(searchable, content, declaration) {
  const blocks = [];
  const global = new RegExp(declaration.source, "gm");
  let match;
  while ((match = global.exec(searchable)) !== null) {
    const openIndex = searchable.indexOf("{", match.index);
    if (openIndex < 0)
      continue;
    const closeIndex = matchBrace(searchable, openIndex);
    if (closeIndex === undefined)
      continue;
    const startLine = searchable.slice(0, openIndex).split(`
`).length;
    const endLine = searchable.slice(0, closeIndex).split(`
`).length;
    blocks.push({ startLine, endLine, lines: content.slice(openIndex + 1, closeIndex).split(`
`) });
    global.lastIndex = closeIndex + 1;
  }
  return blocks;
}
function matchBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex;i < text.length; i++) {
    const char = text[i];
    if (char === "{")
      depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0)
        return i;
    }
  }
  return;
}
function blockIsAdded(ctx, block) {
  if (ctx.change.isNew)
    return true;
  const added = multiset(ctx.change.addedLines.map((line) => stripComments(line, ctx.change.language).trim()));
  let codeLines = 0;
  for (const raw of block.lines) {
    const line = raw.trim();
    if (line.length === 0 || isCommentLine(raw, ctx.change.language))
      continue;
    codeLines += 1;
    const count = added.get(line) ?? 0;
    if (count <= 0)
      return false;
    added.set(line, count - 1);
  }
  return codeLines > 0;
}
var emptyTestRule = {
  id: "empty-test",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const findings = [];
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block))
        continue;
      const body = block.lines.join(`
`);
      const executable = countRealLines(body, ctx.change.language);
      const trivial = /^\s*(?:pass|\.\.\.)?\s*$/.test(body.trim());
      if (executable > 0 && !trivial)
        continue;
      findings.push({
        rule: "empty-test",
        line: block.startLine,
        message: "Test body has no executable statement.",
        excerpt: (ctx.change.newText.split(`
`)[block.startLine - 1] ?? "").trim()
      });
    }
    return findings;
  }
};
var unknownTestRule = {
  id: "unknown-test",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const findings = [];
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block))
        continue;
      const body = block.lines.join(`
`);
      if (countRealLines(body, ctx.change.language) === 0)
        continue;
      if (hasAssertion(body))
        continue;
      findings.push({
        rule: "unknown-test",
        line: block.startLine,
        message: "Test has no assertion, expect, fail, or expected exception.",
        excerpt: (ctx.change.newText.split(`
`)[block.startLine - 1] ?? "").trim()
      });
    }
    return findings;
  }
};
var protectedPathsRule = {
  id: "protected-paths",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    if (ctx.change.isNew)
      return [];
    return [{
      rule: "protected-paths",
      line: 0,
      message: ctx.change.isDelete ? "Deletion of an existing test file." : "Edit of an existing test file.",
      excerpt: ctx.change.filePath
    }];
  }
};
var overMockingRule = {
  id: "over-mocking",
  run(ctx) {
    const added = ctx.change.addedLines;
    const removed = ctx.change.removedLines;
    let addedMocks = 0;
    let removedMocks = 0;
    for (const line of added)
      if (MOCK_IDENTIFIER_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language))))
        addedMocks += 1;
    for (const line of removed)
      if (MOCK_IDENTIFIER_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language))))
        removedMocks += 1;
    if (addedMocks - removedMocks < 1)
      return [];
    const sample = added.find((line) => MOCK_IDENTIFIER_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language)))) ?? "";
    return [{
      rule: "over-mocking",
      line: locateLine(ctx.change.newText, sample),
      message: `New mock identifiers added (net +${addedMocks - removedMocks}).`,
      excerpt: sample.trim()
    }];
  }
};
var assertionRouletteRule = {
  id: "assertion-roulette",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const findings = [];
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block))
        continue;
      const body = block.lines.join(`
`);
      const assertions = countAssertionsCode(block.lines, ctx.change.language);
      if (assertions <= 1)
        continue;
      const hasMessage = /assert\w*\([^)]*,\s*["'`]/.test(body) || /expect\([^)]*,\s*["'`]/.test(body);
      if (hasMessage)
        continue;
      findings.push({
        rule: "assertion-roulette",
        line: block.startLine,
        message: `${assertions} assertions with no message; failures are indistinguishable.`,
        excerpt: (ctx.change.newText.split(`
`)[block.startLine - 1] ?? "").trim()
      });
    }
    return findings;
  }
};
var THRESHOLD_PATTERN = /(fail_under|cov-fail-under)\s*[=:]\s*(\d+(?:\.\d+)?)/;
function parseThresholds(lines) {
  const values = [];
  for (const line of lines) {
    const match = line.match(THRESHOLD_PATTERN);
    if (match)
      values.push(Number(match[2]));
  }
  return values;
}
var weakenedConfigRule = {
  id: "weakened-config",
  run(ctx) {
    const findings = addedLineFindings(ctx, "weakened-config", WEAKENED_CONFIG_PATTERNS, "Configuration weakens test enforcement.");
    const removed = parseThresholds(ctx.change.removedLines);
    const added = parseThresholds(ctx.change.addedLines);
    if (removed.length > 0 && added.length > 0) {
      const previous = Math.max(...removed);
      const next = Math.min(...added);
      if (next < previous) {
        const sample = ctx.change.addedLines.find((line) => THRESHOLD_PATTERN.test(line)) ?? "";
        const lineNumber = locateLine(ctx.change.newText, sample);
        if (!withinBypass(ctx, lineNumber)) {
          findings.push({
            rule: "weakened-config",
            line: lineNumber,
            message: `Coverage/test threshold lowered from ${previous} to ${next}.`,
            excerpt: sample.trim()
          });
        }
      }
    }
    return findings;
  }
};
function normalizeBody(lines, language) {
  return lines.map((line) => stripComments(line, language).trim()).filter((line) => line.length > 0).join(`
`);
}
var duplicateTestRule = {
  id: "duplicate-test",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const findings = [];
    const seen = new Map;
    for (const block of blocksOf(ctx)) {
      const normalized = normalizeBody(block.lines, ctx.change.language);
      if (normalized.length === 0)
        continue;
      const first = seen.get(normalized);
      if (first === undefined) {
        seen.set(normalized, block.startLine);
        continue;
      }
      if (!blockIsAdded(ctx, block) && !ctx.change.isNew)
        continue;
      findings.push({
        rule: "duplicate-test",
        line: block.startLine,
        message: `Duplicate test body (identical to the test at line ${first}).`,
        excerpt: (ctx.change.newText.split(`
`)[block.startLine - 1] ?? "").trim()
      });
    }
    return findings;
  }
};
var redundantAssertionRule = {
  id: "redundant-assertion",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    const findings = [];
    for (const block of blocksOf(ctx)) {
      if (!blockIsAdded(ctx, block))
        continue;
      const seen = new Set;
      for (const raw of block.lines) {
        const code = codeText(raw, ctx.change.language).trim();
        if (code.length === 0)
          continue;
        if (!ASSERTION_COUNT_PATTERNS.some((pattern) => pattern.test(code)))
          continue;
        if (seen.has(code)) {
          findings.push({
            rule: "redundant-assertion",
            line: locateLine(ctx.change.newText, raw),
            message: "The same assertion is repeated in one test.",
            excerpt: raw.trim()
          });
          break;
        }
        seen.add(code);
      }
    }
    return findings;
  }
};
var testsNotRunRule = {
  id: "tests-not-run",
  run(ctx) {
    return addedLineFindings(ctx, "tests-not-run", TESTS_NOT_RUN_PATTERNS, "A test command excludes or skips tests.");
  }
};
function findCrossFileDuplicates(files, minBodyLength = 20) {
  const first = new Map;
  const out = [];
  for (const file of files) {
    for (const block of findTestBlocks(file.text, file.language)) {
      const normalized = normalizeBody(block.lines, file.language);
      if (normalized.length < minBodyLength)
        continue;
      const existing = first.get(normalized);
      if (!existing) {
        first.set(normalized, { filePath: file.filePath, line: block.startLine });
        continue;
      }
      if (existing.filePath === file.filePath)
        continue;
      out.push({
        filePath: file.filePath,
        line: block.startLine,
        otherFilePath: existing.filePath,
        otherLine: existing.line,
        excerpt: (file.text.split(`
`)[block.startLine - 1] ?? "").trim()
      });
    }
  }
  return out.slice(0, 50);
}
var DETERMINISTIC_RULES = [
  protectedPathsRule,
  skipFocusAddedRule,
  tautologicalAssertionRule,
  emptyTestRule,
  unknownTestRule,
  guttedTestRule,
  matcherLoosenedRule,
  swallowedErrorRule,
  duplicateTestRule
];
var ADVISORY_RULES = [
  overMockingRule,
  assertionRouletteRule,
  weakenedConfigRule,
  redundantAssertionRule,
  testsNotRunRule
];

// src/rules/tests/index.ts
var ALL_TEST_RULES = [...DETERMINISTIC_RULES, ...ADVISORY_RULES];
function buildRuleChecks(includeAdvisory) {
  const checks = {};
  for (const rule of DETERMINISTIC_RULES)
    checks[rule.id] = "warn";
  for (const rule of ADVISORY_RULES)
    checks[rule.id] = includeAdvisory ? "warn" : "off";
  return checks;
}
function runTestRules(ctx) {
  if (!ctx.isTestFile)
    return { findings: [], bypassed: false, bypasses: [] };
  const bypass = testBypass(ctx.change.newText);
  if (bypass.fileDisabled) {
    return { findings: [], bypassed: true, bypasses: bypass.notes };
  }
  ctx.bypass = bypass;
  if (!ctx.blocks)
    ctx.blocks = findTestBlocks(ctx.change.newText, ctx.change.language);
  const findings = [];
  for (const rule of ALL_TEST_RULES) {
    const level = ctx.config.checks[rule.id] ?? "off";
    if (level === "off")
      continue;
    try {
      findings.push(...rule.run(ctx));
    } catch {}
  }
  return { findings, bypassed: false, bypasses: bypass.notes };
}

// src/rules/tests/analyzer.ts
function createRuleAnalyzer(getConfig) {
  return {
    id: "test-rules",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: (ctx) => {
      const change = ctx.change;
      if (!change)
        return {};
      const config = getConfig();
      const result = runTestRules({
        change,
        isTestFile: config.isTestFile ?? isTestPath(change.filePath, config.testPatterns),
        config: {
          enabled: config.enabled,
          testPatterns: config.testPatterns,
          checks: config.checks,
          maxWarningsPerFile: 0
        }
      });
      return { findings: toFindings(result.findings, change.filePath, config.checks), bypasses: result.bypasses };
    }
  };
}
function toFindings(findings, filePath, checks) {
  return findings.map((finding) => ({
    rule: finding.rule,
    filePath,
    line: finding.line,
    message: finding.message,
    severity: checks[finding.rule] ?? "off",
    excerpt: finding.excerpt
  }));
}
function buildTestCheckerInput(change, ctx) {
  const toolInput = { file_path: change.filePath };
  let toolName;
  if (change.isNew) {
    toolName = "Write";
    toolInput.content = change.newText;
  } else {
    toolName = "Edit";
    toolInput.old_string = change.oldText;
    toolInput.new_string = change.newText;
  }
  return {
    session_id: ctx.sessionID,
    tool_name: toolName,
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: COMMENT_CHECKER_EVENT,
    is_test_file: true,
    tool_input: toolInput
  };
}
function excerptFromSource(change, line, fallback) {
  if (line <= 0)
    return fallback;
  const lines = change.newText.split(`
`);
  if (line > lines.length)
    return fallback;
  const stripped = stripComments(lines[line - 1] ?? "", change.language).replace(/\s+/g, " ").trim();
  return stripped.length > 0 ? stripped : fallback;
}
function binaryToFindings(findings, change, checks) {
  return findings.map((finding) => ({
    rule: finding.rule,
    filePath: change.filePath,
    line: finding.line,
    message: finding.message,
    severity: checks[finding.rule] ?? "off",
    excerpt: excerptFromSource(change, finding.line, finding.message)
  }));
}
function createTestEngineAnalyzer(getConfig, run = runTestChecker) {
  const rules = createRuleAnalyzer(getConfig);
  return {
    id: "test-engine",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: async (ctx) => {
      const change = ctx.change;
      if (!change)
        return {};
      const config = getConfig();
      const isTestFile = config.isTestFile ?? isTestPath(change.filePath, config.testPatterns);
      const useBinary = (config.engine ?? "binary") === "binary" && isTestFile && !change.isDelete && change.newText.trim().length > 0;
      if (useBinary) {
        let binaryFindings = null;
        try {
          binaryFindings = await run(buildTestCheckerInput(change, ctx));
        } catch {
          binaryFindings = null;
        }
        if (binaryFindings !== null) {
          return {
            findings: binaryToFindings(binaryFindings, change, config.checks),
            bypasses: collectBypasses2(change)
          };
        }
      }
      return rules.analyze(ctx);
    }
  };
}

// src/core/dispatch.ts
var debugLog3 = createDebugLog("test-guard", process.env.TEST_GUARD_DEBUG === "1" || process.env.COMMENT_CHECKER_DEBUG === "1");
var DEFAULT_TEST_GUARD = {
  enabled: true,
  testPatterns: [],
  checks: {},
  maxWarningsPerFile: 0,
  engine: "binary"
};
function createTestGuard(getResolved) {
  const budget = new GuardBudget;
  const pending = new PendingCallStore;
  const registry = new AnalyzerRegistry;
  registry.register(createTestEngineAnalyzer(getResolved));
  function resolve() {
    try {
      return getResolved();
    } catch {
      return DEFAULT_TEST_GUARD;
    }
  }
  function before(input, output) {
    try {
      const resolved = resolve();
      if (!resolved.enabled)
        return;
      const toolLower = input.tool.toLowerCase();
      const args = output.args ?? {};
      if (!isTriggeredTool(resolved.triggerTools, toolLower))
        return;
      pending.prune();
      let preimage;
      const filePath = firstString(args, "filePath", "file_path", "path");
      if (toolLower !== APPLY_PATCH_TOOL_NAME && filePath && typeof args.content === "string") {
        preimage = readFileIfExists(filePath);
      }
      pending.set(input.callID, { args, preimage });
    } catch (err) {
      debugLog3("before failed (fail-open):", err);
    }
  }
  async function after(input, output) {
    try {
      const resolved = resolve();
      if (!resolved.enabled)
        return;
      const toolLower = input.tool.toLowerCase();
      let changes = [];
      const failed = output.output.toLowerCase().startsWith("error");
      if (toolLower === APPLY_PATCH_TOOL_NAME) {
        if (isTriggeredTool(resolved.triggerTools, APPLY_PATCH_TOOL_NAME) && !failed)
          changes = extractPatchChanges(output.metadata);
      } else if (isTriggeredTool(resolved.triggerTools, toolLower)) {
        const call = pending.take(input.callID);
        if (call && !failed) {
          const change = extractToolChange(toolLower, call.args, call.preimage);
          if (change)
            changes.push(change);
        }
      } else {
        pending.delete(input.callID);
      }
      const parts = [];
      if (changes.length > 0) {
        budget.touch(input.sessionID);
        budget.setMaxWarningsPerFile(resolved.maxWarningsPerFile);
        budget.setDedupWindowMs(resolved.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS);
        const findings = [];
        const bypassNotes = [];
        for (const change of changes) {
          const results = await registry.run("after", {
            tool: input.tool,
            sessionID: input.sessionID,
            change
          });
          const changeFindings = [];
          const changeBypasses = [];
          for (const result of results) {
            if (result.findings)
              changeFindings.push(...result.findings);
            if (result.bypasses)
              changeBypasses.push(...result.bypasses);
          }
          for (const bypass of changeBypasses) {
            debugLog3("bypass", change.filePath, bypass);
            bypassNotes.push(formatBypassNote(change.filePath, bypass));
          }
          const grouped = new Map;
          for (const finding of changeFindings) {
            const list = grouped.get(finding.rule) ?? [];
            list.push(finding);
            grouped.set(finding.rule, list);
          }
          for (const [rule, ruleFindings] of grouped) {
            const level = resolved.checks[rule] ?? "off";
            if (level === "off")
              continue;
            if (!budget.shouldEmit(input.sessionID, rule, change.filePath))
              continue;
            budget.record(input.sessionID, rule, change.filePath);
            for (const finding of ruleFindings)
              findings.push(finding);
          }
        }
        let message = renderAnalyzerResults([{ findings }], {
          customPrompt: resolved.customPrompt,
          appendPrompt: resolved.appendPrompt
        });
        if (bypassNotes.length > 0) {
          const footer = renderBypassFooter("Test guard bypass recorded", bypassNotes);
          message = message.length > 0 ? `${message}

${footer}` : footer;
        }
        if (message.length > 0)
          parts.push(message);
      }
      if (parts.length === 0)
        return;
      appendFeedback(output, parts.join(`

`));
    } catch (err) {
      debugLog3("after failed (fail-open):", err);
    }
  }
  return { before, after };
}

// src/core/advisory-queue.ts
class AdvisoryQueue {
  notes = [];
  queue(message) {
    if (message.length > 0)
      this.notes.push(message);
  }
  consume() {
    return this.notes.splice(0, this.notes.length);
  }
}
function appendAdvisories(output, notes) {
  if (notes.length === 0)
    return;
  const body = notes.join(`

`);
  if (output.output.includes(TEST_GUARD_MARKER)) {
    output.output += `

${body}`;
  } else {
    output.output += `

${TEST_GUARD_MARKER}
${body}`;
  }
}

// src/core/idle-advisory.ts
import { tool } from "@opencode-ai/plugin";
function idleMessages(label, hint, empty) {
  return {
    disabledMessage: `${label}: disabled (${hint}).`,
    unavailableMessage: `${label}: unavailable.`,
    emptyMessage: `${label}: ${empty}.`
  };
}
function createIdleAdvisory(options) {
  const cooldownMs = options.cooldownMs ?? 60000;
  const lastRun = new Map;
  return {
    async onIdle(sessionID) {
      try {
        if (!options.isEnabled())
          return null;
        const now = Date.now();
        if (now - (lastRun.get(sessionID) ?? 0) < cooldownMs)
          return null;
        lastRun.set(sessionID, now);
        return await options.analyze();
      } catch {
        return null;
      }
    },
    async analyzeNow() {
      try {
        if (!options.isEnabled())
          return options.disabledMessage;
        return await options.analyze() ?? options.emptyMessage;
      } catch {
        return options.unavailableMessage;
      }
    }
  };
}
function createIdleAnalyzer(id, controller) {
  return {
    id,
    trigger: "idle",
    isEnabled: () => true,
    analyze: async (ctx) => {
      const note = await controller.onIdle(ctx.sessionID);
      return note ? { note } : {};
    }
  };
}
function createReadonlyTool(description, args, execute) {
  return tool({ description, args, execute });
}
function createAdvisoryTool(description, controller) {
  return createReadonlyTool(description, {}, async () => controller.analyzeNow());
}

// src/core/ci.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
import { isAbsolute, join as join3, relative } from "path";
function run(args, cwd) {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "ignore" });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
}
function changedFiles(directory, base) {
  const files = new Set;
  const diff = run(["git", "diff", "--name-only", base], directory);
  if (diff.exitCode === 0) {
    for (const line of diff.stdout.split(`
`))
      if (line.trim())
        files.add(line.trim());
  }
  const untracked = run(["git", "ls-files", "--others", "--exclude-standard"], directory);
  if (untracked.exitCode === 0) {
    for (const line of untracked.stdout.split(`
`))
      if (line.trim())
        files.add(line.trim());
  }
  return [...files];
}
function readOldRevision(directory, base, relativePath) {
  const result = run(["git", "show", `${base}:${relativePath}`], directory);
  return result.exitCode === 0 ? result.stdout : "";
}
function readWorktree(filePath) {
  try {
    return existsSync4(filePath) ? readFileSync3(filePath, "utf8") : "";
  } catch {
    return;
  }
}
function changedTestChanges(directory, base, testPatterns) {
  return diffChanges(directory, base).filter((change) => isSupportedLanguage(change.language) && isTestPath(change.filePath, testPatterns));
}
function diffChanges(directory, base) {
  const changes = [];
  for (const relativePath of changedFiles(directory, base)) {
    const absolute = isAbsolute(relativePath) ? relativePath : join3(directory, relativePath);
    const newText = readWorktree(absolute);
    if (newText === undefined)
      continue;
    const oldText = readOldRevision(directory, base, relativePath);
    if (oldText.length === 0 && newText.length === 0)
      continue;
    changes.push(extractChange({
      filePath: absolute,
      oldText,
      newText,
      isNew: oldText.length === 0,
      isDelete: newText.length === 0
    }));
  }
  return changes;
}

// src/core/advisory-findings.ts
var MAX_ADVISORY_FINDINGS = 20;
function parseAdvisoryFindings(items, textKey) {
  const findings = [];
  for (const item of items) {
    if (!item || typeof item !== "object")
      continue;
    const record = item;
    const file = typeof record.file === "string" ? record.file : "";
    const text = typeof record[textKey] === "string" ? record[textKey].trim() : "";
    if (!file || !text)
      continue;
    if (PLACEHOLDER_PATTERN.test(text))
      continue;
    findings.push({
      file,
      line: typeof record.line === "number" && Number.isFinite(record.line) ? record.line : 0,
      text,
      confidence: typeof record.confidence === "string" ? record.confidence : "medium",
      record
    });
    if (findings.length >= MAX_ADVISORY_FINDINGS)
      break;
  }
  return findings;
}

// src/core/json.ts
function sliceBetween(raw, open, close) {
  const start = raw.indexOf(open);
  const end = raw.lastIndexOf(close);
  return start >= 0 && end > start ? raw.slice(start, end + 1) : undefined;
}
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}
function parseJsonSlice(raw, open, close) {
  const slice = sliceBetween(raw, open, close);
  return slice === undefined ? undefined : tryParseJson(slice);
}

// src/core/judge.ts
var DEFAULT_JUDGE_MODEL = "opencode/big-pickle";
function resolveJudgeModel(configured) {
  if (configured === "host")
    return;
  return configured ?? DEFAULT_JUDGE_MODEL;
}
var JUDGE_SYSTEM = "You are a read-only test-quality reviewer. Do not call any tool. Reply with JSON only.";
function buildJudgePrompt(changes) {
  const sections = [];
  for (const change of changes) {
    if (change.addedLines.length === 0 && change.removedLines.length === 0)
      continue;
    const removed = change.removedLines.map((line) => `- ${line}`).join(`
`);
    const added = change.addedLines.map((line) => `+ ${line}`).join(`
`);
    sections.push(`--- ${change.filePath}
${removed}
${added}`);
  }
  if (sections.length === 0)
    return "";
  return [
    "Review the following test changes and decide whether any of them weakens the tests",
    "(removed assertions, loosened matchers, skipped/focused tests, tautological assertions,",
    "swallowed errors, or tests that no longer validate behavior).",
    "Reply with ONLY a JSON array. Each item:",
    '{"file": "<path>", "line": <number>, "reason": "<short>", "confidence": "high|medium|low"}.',
    "If nothing weakens the tests, reply with [].",
    "",
    sections.join(`

`)
  ].join(`
`);
}
function parseJudgeResponse(raw) {
  const parsed = parseJsonSlice(raw, "[", "]");
  if (!Array.isArray(parsed))
    return [];
  return parseAdvisoryFindings(parsed, "reason").map((finding) => ({
    file: finding.file,
    line: finding.line,
    reason: finding.text,
    confidence: finding.confidence
  }));
}
function judgeFindingLines(findings) {
  return findings.map((finding) => `- ${finding.file}:${finding.line} ${finding.reason} (${finding.confidence})`).join(`
`);
}
function formatJudgeFindings(findings) {
  return `LLM judge (advisory, opt-in):
${judgeFindingLines(findings)}`;
}
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("judge timeout")), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
async function runJudgeWithPrompt(changes, config, runner, buildPrompt) {
  if (!config.enabled)
    return [];
  const prompt = buildPrompt(changes);
  if (prompt.length === 0)
    return [];
  try {
    const raw = await withTimeout(runner(prompt, config.model), config.timeoutMs ?? 30000);
    return parseJudgeResponse(raw);
  } catch {
    return [];
  }
}
function parseModel(model) {
  if (!model)
    return;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1)
    return;
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}
function createModelJudgeRunner(client, directory) {
  const session = client?.session;
  return async (prompt, model) => {
    if (!session?.create || !session?.prompt)
      return "";
    const modelRef = parseModel(model);
    try {
      const created = await session.create({ body: { title: "test-guard judge" }, query: { directory } });
      const id = created?.data?.id;
      if (!id)
        return "";
      try {
        const result = await session.prompt({
          path: { id },
          query: { directory },
          body: {
            system: JUDGE_SYSTEM,
            tools: { bash: false, edit: false, write: false, read: false, webfetch: false, patch: false, task: false },
            ...modelRef ? { model: modelRef } : {},
            parts: [{ type: "text", text: prompt }]
          }
        });
        const parts = result?.data?.parts ?? [];
        return parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join(`
`);
      } finally {
        try {
          await session.delete?.({ path: { id }, query: { directory } });
        } catch {}
      }
    } catch {
      return "";
    }
  };
}
function createDiffJudge(options) {
  return createIdleAdvisory({
    isEnabled: () => options.getConfig().enabled,
    cooldownMs: options.cooldownMs,
    disabledMessage: options.disabledMessage,
    unavailableMessage: options.unavailableMessage,
    emptyMessage: options.emptyMessage,
    analyze: async () => {
      const changes = options.selectChanges(options.directory, options.base ?? "HEAD");
      const findings = await runJudgeWithPrompt(changes, options.getConfig(), options.runner, options.buildPrompt);
      return findings.length > 0 ? options.format(findings) : null;
    }
  });
}
function createJudge(options) {
  return createDiffJudge({
    directory: options.directory,
    getConfig: options.getConfig,
    runner: options.runner,
    cooldownMs: options.cooldownMs,
    selectChanges: (directory, base) => changedTestChanges(directory, base, options.getTestPatterns()),
    buildPrompt: buildJudgePrompt,
    format: formatJudgeFindings,
    ...idleMessages("LLM judge", "set test_guard.judge.enabled", "no findings")
  });
}
function createGuardJudgeTool(judge) {
  return createAdvisoryTool("Run the opt-in LLM judge over the current test diff. Read-only and advisory; requires test_guard.judge.enabled.", judge);
}
function buildCommentJudgePrompt(changes) {
  const sections = [];
  for (const change of changes) {
    const addedComments = change.addedLines.filter((line) => isCommentLine(line, change.language));
    if (addedComments.length === 0)
      continue;
    const lines = change.newText.split(`
`);
    const used = new Set;
    const body = [];
    for (const comment of addedComments) {
      const index = lines.findIndex((line, i) => !used.has(i) && line === comment);
      if (index >= 0)
        used.add(index);
      body.push(`+ ${index >= 0 ? index + 1 : 0}: ${comment}`);
    }
    sections.push(`--- ${change.filePath}
${body.join(`
`)}`);
  }
  if (sections.length === 0)
    return "";
  return [
    "Review the following newly added comments and decide whether any should be removed",
    "because it restates the code, is an agent memo (// now, // changed, // updated),",
    "a TODO/FIXME without an owner, or commented-out code, rather than explaining WHY",
    "(business rule, security, performance, regex/math, public API).",
    "Reply with ONLY a JSON array. Each item:",
    '{"file": "<path>", "line": <number>, "reason": "<short>", "confidence": "high|medium|low"}.',
    "If every comment is worth keeping, reply with [].",
    "",
    sections.join(`

`)
  ].join(`
`);
}
function formatCommentJudgeFindings(findings) {
  return `Comment relevance judge (advisory, opt-in):
${judgeFindingLines(findings)}`;
}
function createCommentJudge(options) {
  return createDiffJudge({
    directory: options.directory,
    getConfig: options.getConfig,
    runner: options.runner,
    cooldownMs: options.cooldownMs,
    selectChanges: (directory, base) => diffChanges(directory, base).filter((change) => isSupportedLanguage(change.language)),
    buildPrompt: buildCommentJudgePrompt,
    format: formatCommentJudgeFindings,
    ...idleMessages("Comment relevance judge", "set comment_checker.judge.enabled", "no findings")
  });
}
function createGuardCommentJudgeTool(judge) {
  return createAdvisoryTool("Run the opt-in comment relevance judge over the current diff. Read-only and advisory; requires comment_checker.judge.enabled.", judge);
}

// src/core/parser-adapter.ts
function buildParserPayload(changes) {
  const files = [];
  for (const change of changes) {
    if (change.addedLines.length === 0 && change.removedLines.length === 0)
      continue;
    files.push({
      path: change.filePath,
      language: change.language,
      added: change.addedLines,
      removed: change.removedLines
    });
  }
  return JSON.stringify({ files });
}
function parseParserFindings(raw) {
  const objectSlice = sliceBetween(raw, "{", "}");
  let parsed;
  if (objectSlice !== undefined) {
    parsed = tryParseJson(objectSlice);
    if (parsed === undefined)
      return [];
  } else {
    parsed = parseJsonSlice(raw, "[", "]");
    if (parsed === undefined)
      return [];
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.findings) ? parsed.findings : [];
  return parseAdvisoryFindings(items, "message").map((finding) => ({
    file: finding.file,
    line: finding.line,
    rule: typeof finding.record.rule === "string" ? finding.record.rule : "external-parser",
    message: finding.text,
    confidence: finding.confidence
  }));
}
function formatParserFindings(findings) {
  const lines = findings.map((finding) => `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.message} (${finding.confidence})`);
  return `External parser (advisory, opt-in):
${lines.join(`
`)}`;
}
async function defaultRun(command, payload, timeoutMs) {
  const outcome = await runShellCommand(command, { stdin: payload, timeoutMs });
  return outcome === "timeout" ? "" : outcome.stdout;
}
async function runParserAdapter(changes, config, run = defaultRun) {
  if (!config.enabled || !config.command)
    return [];
  const payload = buildParserPayload(changes);
  if (payload === JSON.stringify({ files: [] }))
    return [];
  try {
    const raw = await run(config.command, payload, config.timeoutMs ?? 30000);
    return parseParserFindings(raw);
  } catch {
    return [];
  }
}
function createParserAdapter(options) {
  return createIdleAdvisory({
    ...idleMessages("External parser", "set test_guard.parser.enabled", "no findings"),
    isEnabled: () => options.getConfig().enabled,
    cooldownMs: options.cooldownMs,
    analyze: async () => {
      const changes = changedTestChanges(options.directory, "HEAD", options.getTestPatterns());
      const findings = await runParserAdapter(changes, options.getConfig(), options.run);
      return findings.length > 0 ? formatParserFindings(findings) : null;
    }
  });
}
function createGuardParseTool(controller) {
  return createAdvisoryTool("Run the opt-in external parser adapter over the current test diff. Read-only and advisory; requires test_guard.parser.enabled.", controller);
}

// src/core/mutation.ts
function isSurvivor(status) {
  const normalized = status.toLowerCase();
  return normalized === "survived" || normalized === "nocoverage" || normalized === "no coverage" || normalized === "timeout";
}
function parseMutationReport(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const root = asRecord(parsed);
  if (!root)
    return [];
  const files = root.files;
  if (Array.isArray(files) || asRecord(files)) {
    const survivors = [];
    const entries = Array.isArray(files) ? files.map((file) => [asRecord(file)?.file, file]) : Object.entries(asRecord(files));
    for (const [name, file] of entries) {
      const entry = asRecord(file);
      if (!entry || !Array.isArray(entry.mutants))
        continue;
      for (const mutant of entry.mutants) {
        const record = asRecord(mutant);
        if (!record)
          continue;
        const status = typeof record.status === "string" ? record.status : "";
        if (!isSurvivor(status))
          continue;
        const location = asRecord(record.location);
        const start = location ? asRecord(location.start) : undefined;
        survivors.push({
          file: typeof entry.file === "string" ? entry.file : name,
          line: start && typeof start.line === "number" ? start.line : undefined,
          mutator: typeof record.mutatorName === "string" ? record.mutatorName : undefined,
          status
        });
      }
    }
    return survivors;
  }
  if (Array.isArray(root.survivors)) {
    const survivors = [];
    for (const item of root.survivors) {
      const record = asRecord(item);
      if (!record)
        continue;
      survivors.push({
        file: typeof record.file === "string" ? record.file : undefined,
        line: typeof record.line === "number" ? record.line : undefined,
        mutator: typeof record.mutator === "string" ? record.mutator : undefined,
        status: typeof record.status === "string" ? record.status : "survived"
      });
    }
    return survivors;
  }
  return [];
}
async function runMutationCheck(command, options = {}) {
  if (!command.trim())
    return { ran: false, survivors: [] };
  const outcome = await runShellCommand(command, { timeoutMs: options.timeoutMs });
  if (outcome === "timeout")
    return { ran: false, survivors: [], error: "timeout" };
  return { ran: true, survivors: parseMutationReport(outcome.stdout) };
}
function formatSurvivors(survivors, max = 20) {
  const lines = survivors.slice(0, max).map((survivor) => {
    const location = `${survivor.file ?? "?"}${survivor.line ? `:${survivor.line}` : ""}`;
    return `- ${location}${survivor.mutator ? ` (${survivor.mutator})` : ""}`;
  });
  return `Mutation survivors detected (${survivors.length}):
${lines.join(`
`)}

Add or strengthen tests to kill them.`;
}
function createMutationAdapter(options) {
  return createIdleAdvisory({
    ...idleMessages("Mutation", "set test_guard.mutation.enabled and command", "no survivors"),
    isEnabled: () => {
      const config = options.getConfig();
      return config.enabled && Boolean(config.command);
    },
    cooldownMs: options.cooldownMs,
    analyze: async () => {
      const config = options.getConfig();
      const run = await runMutationCheck(config.command ?? "", { timeoutMs: config.timeoutMs });
      if (!run.ran || run.survivors.length === 0)
        return null;
      return formatSurvivors(run.survivors);
    }
  });
}

// src/rules/comments/index.ts
import { existsSync as existsSync5 } from "fs";
var debugLog4 = createDebugLog("comment-guard", process.env.COMMENT_CHECKER_DEBUG === "1");
var MATCHERS2 = bypassMatchers("comment-guard");
function bypassState(newText, oldText, language) {
  const bypass = applyBypass(newText, MATCHERS2);
  const { added } = diffLines(oldText, newText);
  const addedComments = added.filter((line) => isCommentLine(line, language));
  const lines = newText.split(`
`);
  const used = new Set;
  const lineNumbers = [];
  for (const comment of addedComments) {
    const index = lines.findIndex((line, i) => !used.has(i) && line === comment);
    if (index >= 0)
      used.add(index);
    lineNumbers.push(index >= 0 ? index + 1 : 0);
  }
  const suppress = bypass.fileDisabled || lineNumbers.length > 0 && lineNumbers.every((line) => bypass.covers(line));
  return { suppress, notes: bypass.notes };
}
function commentBypassFooter(filePath, notes) {
  return renderBypassFooter("Comment guard bypass recorded", notes.map((note) => formatBypassNote(filePath, note)));
}
var COMMENT_RULE = "comment";
function isCheckedPath(filePath, paths) {
  return matchPathFilter(paths, filePath);
}
function createCommentBinaryAnalyzer(getConfig) {
  return {
    id: "comment-binary",
    trigger: "after",
    isEnabled: () => getConfig().enabled,
    analyze: async (ctx) => {
      const config = getConfig();
      const cliPath = await getCommentCheckerPath();
      if (!cliPath || !existsSync5(cliPath)) {
        debugLog4("CLI not available, skipping comment check");
        return {};
      }
      const hookInput = commentHookInput({
        sessionID: ctx.sessionID,
        toolName: ctx.tool,
        cwd: process.cwd(),
        toolInput: ctx.args ?? {}
      });
      const result = await runCommentChecker(hookInput, { prompt: config.customPrompt, timeoutMs: config.timeoutMs });
      return result.hasComments && result.message ? { raw: result.message } : {};
    }
  };
}
function createCommentGuard(getConfig) {
  const pendingCalls = new PendingCallStore;
  const budget = new GuardBudget;
  const registry = new AnalyzerRegistry;
  registry.register(createCommentBinaryAnalyzer(getConfig));
  function hasNewCommentLines(preimage, content, filePath) {
    const language = detectLanguage(filePath);
    const { added } = diffLines(preimage, content);
    return added.some((line) => isCommentLine(line, language));
  }
  async function reportComments(sessionID, toolName, toolInput, output, change) {
    try {
      const { appendPrompt, maxWarningsPerFile, dedupWindowMs } = getConfig();
      const filePath = toolInput.file_path ?? "";
      const bypass = bypassState(change.newText, change.oldText, detectLanguage(filePath));
      if (bypass.suppress) {
        debugLog4("comment guard bypassed for", filePath);
        if (bypass.notes.length > 0)
          appendGuardMessage(output, commentBypassFooter(filePath, bypass.notes));
        return;
      }
      budget.setMaxWarningsPerFile(maxWarningsPerFile);
      budget.setDedupWindowMs(dedupWindowMs);
      if (!budget.shouldEmit(sessionID, COMMENT_RULE, filePath)) {
        debugLog4("warning budget spent for", filePath);
        return;
      }
      const results = await registry.run("after", {
        tool: toolName,
        sessionID,
        args: toolInput
      });
      const message = renderAnalyzerResults(results, { appendPrompt });
      if (message.length > 0) {
        budget.record(sessionID, COMMENT_RULE, filePath);
        appendGuardMessage(output, message);
        if (bypass.notes.length > 0)
          appendGuardMessage(output, commentBypassFooter(filePath, bypass.notes));
      }
    } catch (err) {
      debugLog4("comment check failed:", err);
    }
  }
  async function checkApplyPatch(sessionID, output) {
    if (output.output.toLowerCase().startsWith("error")) {
      debugLog4("skipping due to tool failure in output");
      return;
    }
    for (const change of extractPatchChanges(output.metadata)) {
      if (change.isDelete || change.newText.length === 0) {
        debugLog4("no file path or no added lines in patch entry for apply_patch");
        continue;
      }
      if (!isCheckedPath(change.filePath, getConfig().paths))
        continue;
      await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
        file_path: change.filePath,
        old_string: change.oldText,
        new_string: change.newText
      }, output, { oldText: change.oldText, newText: change.newText });
    }
  }
  async function before(input, output) {
    try {
      const { triggerTools } = getConfig();
      if (!getConfig().enabled)
        return;
      const toolLower = input.tool.toLowerCase();
      if (toolLower === APPLY_PATCH_TOOL_NAME || !isTriggeredTool(triggerTools, toolLower)) {
        return;
      }
      pendingCalls.prune();
      const filePath = firstString(output.args, "filePath", "file_path", "path");
      if (!filePath) {
        debugLog4("no filePath found for tool:", toolLower);
        return;
      }
      if (!isCheckedPath(filePath, getConfig().paths)) {
        debugLog4("path not in comment_checker.paths; skipping:", filePath);
        return;
      }
      let preimage;
      if (typeof output.args.content === "string") {
        preimage = readFileIfExists(filePath);
      }
      pendingCalls.set(input.callID, { args: output.args, preimage });
    } catch (err) {
      debugLog4("before failed (fail-open):", err);
    }
  }
  async function after(input, output) {
    try {
      const { triggerTools } = getConfig();
      if (!getConfig().enabled)
        return;
      const toolLower = input.tool.toLowerCase();
      if (toolLower === APPLY_PATCH_TOOL_NAME) {
        if (!isTriggeredTool(triggerTools, APPLY_PATCH_TOOL_NAME))
          return;
        budget.touch(input.sessionID);
        await checkApplyPatch(input.sessionID, output);
        return;
      }
      const pendingCall = pendingCalls.take(input.callID);
      if (!pendingCall)
        return;
      budget.touch(input.sessionID);
      const isToolFailure = output.output.toLowerCase().startsWith("error");
      if (isToolFailure) {
        debugLog4("skipping due to tool failure in output");
        return;
      }
      const change = extractToolChange(toolLower, pendingCall.args, pendingCall.preimage);
      if (!change)
        return;
      const filePath = firstString(pendingCall.args, "filePath", "file_path", "path") ?? "";
      if (toolLower === "write" && pendingCall.preimage !== undefined && !hasNewCommentLines(change.oldText, change.newText, filePath)) {
        debugLog4("no new comment lines in write; skipping");
        return;
      }
      await reportComments(input.sessionID, toolLower.charAt(0).toUpperCase() + toolLower.slice(1), {
        file_path: filePath,
        content: readString(pendingCall.args, "content"),
        old_string: readString(pendingCall.args, "oldString", "old_string"),
        new_string: readString(pendingCall.args, "newString", "new_string"),
        edits: pendingCall.args.edits
      }, output, { oldText: change.oldText, newText: change.newText });
    } catch (err) {
      debugLog4("after failed (fail-open):", err);
    }
  }
  return { before, after };
}

// src/core/test-command.ts
import { join as join4 } from "path";
var CANDIDATES = [
  { file: "pytest.ini", command: "pytest" },
  { file: "pyproject.toml", contains: "[tool.pytest", command: "pytest" },
  { file: "go.mod", command: "go test ./..." },
  { file: "Cargo.toml", command: "cargo test" },
  { file: "pom.xml", command: "mvn test" },
  { file: "build.gradle", command: "gradle test" },
  { file: "build.gradle.kts", command: "gradle test" }
];
function detectTestCommand(directory) {
  const packageJson = readFileIfExists(join4(directory, "package.json"));
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson);
      const test = parsed.scripts?.test;
      if (typeof test === "string" && test.trim().length > 0) {
        return test.trim();
      }
    } catch {}
  }
  for (const candidate of CANDIDATES) {
    const content = readFileIfExists(join4(directory, candidate.file));
    if (content === undefined)
      continue;
    if (candidate.contains && !content.includes(candidate.contains))
      continue;
    return candidate.command;
  }
  return null;
}

// src/audit.ts
import { tool as tool2 } from "@opencode-ai/plugin";
import { readFileSync as readFileSync4, readdirSync as readdirSync2, statSync } from "fs";
import { isAbsolute as isAbsolute2, join as join5, relative as relative2 } from "path";
var EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".cache", "coverage"]);
var SECRET_PATTERNS = [/(?:^|\/)\.env(?:\.|$)/, /\.pem$/, /\.key$/, /(?:^|\/)id_(?:rsa|ed25519)$/, /\.p12$/];
var MAX_FILES = 500;
function isSecretFile(filePath) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(filePath));
}
function walk(dir, out, limit) {
  if (out.length >= limit)
    return;
  let entries;
  try {
    entries = readdirSync2(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit)
      return;
    if (entry.startsWith(".") && entry !== ".env.example")
      continue;
    const full = join5(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry))
        continue;
      walk(full, out, limit);
    } else if (stat.isFile()) {
      out.push(full);
    }
  }
}
function listRepositoryFiles(directory, paths) {
  const collected = [];
  if (paths && paths.length > 0) {
    for (const entry of paths) {
      const abs = isAbsolute2(entry) ? entry : join5(directory, entry);
      try {
        const stat = statSync(abs);
        if (stat.isDirectory())
          walk(abs, collected, MAX_FILES);
        else if (stat.isFile())
          collected.push(abs);
      } catch {}
    }
    return collected.slice(0, MAX_FILES);
  }
  try {
    const result = Bun.spawnSync(["git", "ls-files"], { cwd: directory, stdout: "pipe", stderr: "ignore" });
    if (result.exitCode === 0) {
      return result.stdout.toString().split(`
`).filter((line) => line.trim().length > 0).map((line) => join5(directory, line)).slice(0, MAX_FILES);
    }
  } catch {}
  walk(directory, collected, MAX_FILES);
  return collected;
}
var COMMENT_LINE_NUMBER = /<comment\s+line-number="(\d+)"[^>]*>([\s\S]*?)<\/comment>/g;
var COMMENT_TEXT_NUMBER = /<comment\s+[^>]*?number="(\d+)"[^>]*>([\s\S]*?)<\/comment>/g;
function parseCommentsXml(xml) {
  const comments = [];
  for (const regex of [COMMENT_LINE_NUMBER, COMMENT_TEXT_NUMBER]) {
    let match;
    const re = new RegExp(regex.source, "g");
    while ((match = re.exec(xml)) !== null) {
      comments.push({ line: Number(match[1]), text: decodeXml(match[2]).trim() });
    }
    if (comments.length > 0)
      break;
  }
  return comments;
}
function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
var REMOVE_COMMENT_PATTERNS = [
  /^\s*(?:\/\/|#|\*|--)\s*[a-z_$][\w$]*\s*\(/i,
  /\b(?:changed|updated|added|removed|refactored|now|temporarily|for now)\b/i,
  /^(?:note|todo|fixme|hack|xxx)\b/i,
  /^(?:increment|initialize|set|get|declare|loop|call|check|create)\b/i
];
var WHY_COMMENT_PATTERNS = [
  /\b(?:because|why|workaround|bug|security|performance|regex|math|business|legacy|backward|compat|intentional|race|lock|retry)\b/i
];
function classifyComment(text) {
  if (text.trim().length === 0)
    return { action: "remove", confidence: "high" };
  if (REMOVE_COMMENT_PATTERNS.some((pattern) => pattern.test(text)))
    return { action: "remove", confidence: "high" };
  if (WHY_COMMENT_PATTERNS.some((pattern) => pattern.test(text)))
    return { action: "adjust", confidence: "medium" };
  return { action: "remove", confidence: "low" };
}
var TEST_ACTION = {
  "empty-test": "remove",
  "unknown-test": "remove",
  "tautological-assertion": "remove",
  "duplicate-test": "remove",
  "skip-focus-added": "remove",
  "matcher-loosened": "adjust",
  "gutted-test": "adjust",
  "swallowed-error": "adjust",
  "over-mocking": "adjust",
  "assertion-roulette": "adjust",
  "weakened-config": "adjust"
};
var TEST_CONFIDENCE = {
  "empty-test": "high",
  "unknown-test": "high",
  "tautological-assertion": "high",
  "duplicate-test": "high",
  "skip-focus-added": "high",
  "over-mocking": "low",
  "assertion-roulette": "low"
};
function validExcerpt(text) {
  return text.trim().length > 0 && !PLACEHOLDER_PATTERN.test(text.trim());
}
function auditTestFile(file, includeAdvisory) {
  const content = readText(file.filePath);
  if (content === undefined)
    return [];
  const change = extractChange({
    filePath: file.filePath,
    oldText: "",
    newText: content,
    isNew: true,
    isDelete: false
  });
  const checks = buildRuleChecks(includeAdvisory);
  const analyzer = createRuleAnalyzer(() => ({ enabled: true, testPatterns: [], checks, isTestFile: true }));
  const result = runAnalyzer(analyzer, { tool: "", sessionID: "guard-audit", change });
  const findings = [];
  for (const finding of result.findings ?? []) {
    if (!validExcerpt(finding.excerpt))
      continue;
    findings.push({
      filePath: file.filePath,
      line: finding.line,
      rule: finding.rule,
      action: TEST_ACTION[finding.rule] ?? "keep",
      confidence: TEST_CONFIDENCE[finding.rule] ?? "medium",
      text: finding.excerpt
    });
  }
  return findings;
}
function readText(filePath) {
  try {
    return readFileSync4(filePath, "utf8");
  } catch {
    return;
  }
}
async function defaultRunCheck(filePath, content) {
  const cliPath = await getCommentCheckerPath();
  if (!cliPath)
    return [];
  const result = await runCommentChecker(commentHookInput({
    sessionID: "guard-audit",
    toolName: "Write",
    cwd: process.cwd(),
    toolInput: { file_path: filePath, content }
  }));
  if (!result.hasComments)
    return [];
  return parseCommentsXml(result.message);
}
async function auditComments(file, deps = {}) {
  const content = readText(file.filePath);
  if (content === undefined)
    return [];
  const runCheck = deps.runCheck ?? defaultRunCheck;
  let raw = [];
  try {
    raw = await runCheck(file.filePath, content);
  } catch {
    return [];
  }
  const findings = [];
  for (const comment of raw) {
    if (!validExcerpt(comment.text))
      continue;
    const { action, confidence } = classifyComment(comment.text);
    findings.push({ filePath: file.filePath, line: comment.line, action, confidence, text: comment.text });
  }
  return findings;
}
function renderAudit(report, format = "markdown") {
  if (format === "json")
    return JSON.stringify(report, null, 2);
  const lines = [];
  lines.push("# Test guard audit");
  lines.push("");
  lines.push(`Scope: ${report.scope} \u2014 generated ${report.generatedAt}`);
  if (report.testCommand)
    lines.push(`Test command: \`${report.testCommand}\``);
  lines.push("");
  if (report.comments.length > 0) {
    lines.push(`## Comments (${report.comments.length})`);
    lines.push("");
    lines.push("| file:line | action | confidence | excerpt |");
    lines.push("|---|---|---|---|");
    for (const finding of report.comments) {
      lines.push(`| ${display(finding.filePath)}:${finding.line} | ${finding.action} | ${finding.confidence} | ${escapeCell(finding.text)} |`);
    }
    lines.push("");
  }
  if (report.tests.length > 0) {
    lines.push(`## Tests (${report.tests.length})`);
    lines.push("");
    lines.push("| file:line | rule | action | confidence | excerpt |");
    lines.push("|---|---|---|---|---|");
    for (const finding of report.tests) {
      lines.push(`| ${display(finding.filePath)}:${finding.line} | ${finding.rule} | ${finding.action} | ${finding.confidence} | ${escapeCell(finding.text)} |`);
    }
    lines.push("");
  }
  if (report.skipped.length > 0) {
    lines.push("## Skipped");
    lines.push("");
    for (const skipped of report.skipped)
      lines.push(`- ${skipped}`);
    lines.push("");
  }
  if (report.comments.length === 0 && report.tests.length === 0) {
    lines.push("No findings. Nothing to clean up.");
  }
  return lines.join(`
`);
}
function display(filePath) {
  return relative2(process.cwd(), filePath) || filePath;
}
function escapeCell(value) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
}
async function runAudit(options, deps = {}) {
  const scope = options.scope ?? "both";
  const format = options.format ?? "markdown";
  const includeAdvisory = options.includeAdvisory ?? false;
  const config = (() => {
    try {
      return options.getConfig();
    } catch {
      return;
    }
  })();
  const testPatterns = config?.testPatterns ?? [];
  const skipped = [];
  const files = listRepositoryFiles(options.directory, options.paths);
  const audited = [];
  for (const filePath of files) {
    if (isSecretFile(filePath)) {
      skipped.push(`${display(filePath)} (secret file pattern)`);
      continue;
    }
    const language = detectLanguage(filePath);
    if (!isSupportedLanguage(language))
      continue;
    if (scope !== "comments" && !isTestPath(filePath, testPatterns))
      continue;
    audited.push({ filePath, display: display(filePath), language });
  }
  const comments = [];
  const tests = [];
  for (const file of audited) {
    try {
      if (scope === "comments" || scope === "both") {
        comments.push(...await auditComments(file, deps));
      }
      if (scope === "tests" || scope === "both") {
        tests.push(...auditTestFile(file, includeAdvisory));
      }
    } catch {
      skipped.push(`${file.display} (unparsable)`);
    }
  }
  if (scope === "tests" || scope === "both") {
    const fileTexts = audited.filter((file) => isTestPath(file.filePath, testPatterns)).map((file) => ({ filePath: file.filePath, text: readText(file.filePath) ?? "", language: file.language })).filter((entry) => entry.text.length > 0);
    for (const duplicate of findCrossFileDuplicates(fileTexts)) {
      if (!validExcerpt(duplicate.excerpt))
        continue;
      tests.push({
        filePath: duplicate.filePath,
        line: duplicate.line,
        rule: "duplicate-test",
        action: "remove",
        confidence: "high",
        text: `${duplicate.excerpt} (duplicate of ${display(duplicate.otherFilePath)}:${duplicate.otherLine})`
      });
    }
  }
  return renderAudit({ scope, comments, tests, skipped, generatedAt: new Date().toISOString(), testCommand: config?.testCommand ?? null }, format);
}
function createGuardAuditTool(options) {
  return createReadonlyTool("Read-only audit of existing comments and tests. Produces a cleanup plan (markdown or json) that the agent applies afterwards. Never modifies files.", {
    scope: tool2.schema.enum(["comments", "tests", "both"]).optional(),
    paths: tool2.schema.array(tool2.schema.string()).optional(),
    format: tool2.schema.enum(["markdown", "json"]).optional(),
    include_advisory: tool2.schema.boolean().optional()
  }, async (args) => runAudit({
    scope: args.scope ?? "both",
    paths: args.paths,
    format: args.format,
    includeAdvisory: args.include_advisory,
    directory: options.directory,
    getConfig: options.getConfig
  }, options.deps));
}
var GUARD_AUDIT_COMMAND = {
  template: "Use the guard_audit tool to audit the current repository's existing comments and tests, then apply the cleanup plan it returns. Report what you changed.",
  description: "Audit existing comments and tests and produce a cleanup plan"
};

// src/index.ts
var DEFAULT_TEST_CHECKS = buildRuleChecks(false);
var pluginOptions;
var projectDirectory = process.cwd();
var resolvedCommentConfig = {
  enabled: true,
  maxWarningsPerFile: 0,
  dedupWindowMs: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  paths: [],
  timeoutMs: DEFAULT_CLI_TIMEOUT_MS
};
function asOptionalBoolean(value) {
  return value === undefined ? undefined : asBoolean(value, false);
}
function subConfigInputs(options, config, key) {
  return { options: asRecord(options?.[key]), config: asRecord(config?.[key]) };
}
function resolveAdapterBase(target, envPrefix, inputs) {
  target.enabled = resolveOption(asOptionalBoolean, `${envPrefix}_ENABLED`, "enabled", inputs) ?? false;
  target.timeoutMs = resolveOption((value) => asCount(value, 1), `${envPrefix}_TIMEOUT_MS`, "timeout_ms", inputs);
}
function resolveJudge(target, envPrefix, inputs) {
  resolveAdapterBase(target, envPrefix, inputs);
  target.model = resolveJudgeModel(resolveOption(asString, `${envPrefix}_MODEL`, "model", inputs));
}
function resolveCommandAdapter(target, envPrefix, inputs) {
  resolveAdapterBase(target, envPrefix, inputs);
  target.command = resolveOption(asString, `${envPrefix}_COMMAND`, "command", inputs);
}
function resolveGuardBase(target, envPrefix, inputs) {
  target.enabled = resolveOption((value) => value === undefined ? undefined : asBoolean(value, true), `${envPrefix}_ENABLED`, "enabled", inputs) ?? true;
  target.customPrompt = resolveOption(asString, `${envPrefix}_CUSTOM_PROMPT`, "custom_prompt", inputs);
  target.appendPrompt = resolveOption(asString, `${envPrefix}_APPEND_PROMPT`, "append_prompt", inputs);
  target.maxWarningsPerFile = resolveOption((value) => asCount(value, 1), `${envPrefix}_MAX_WARNINGS_PER_FILE`, "max_warnings_per_file", inputs) ?? 0;
  target.dedupWindowMs = resolveOption((value) => asCount(value, 0), `${envPrefix}_DEDUP_WINDOW_MS`, "dedup_window_ms", inputs) ?? DEFAULT_DEDUP_WINDOW_MS;
  target.triggerTools = new Set(resolveOption(asTools, `${envPrefix}_TOOLS`, "tools", inputs) ?? DEFAULT_TRIGGER_TOOLS);
}
function resolveConfiguration(config) {
  const options = optionContainer(pluginOptions, "comment_checker");
  const fromConfig = optionContainer(config, "comment_checker");
  const inputs = { options, config: fromConfig };
  resolveGuardBase(resolvedCommentConfig, "COMMENT_CHECKER", inputs);
  resolvedCommentConfig.paths = resolveOption(asPatterns, "COMMENT_CHECKER_PATHS", "paths", inputs) ?? [];
  resolvedCommentConfig.timeoutMs = resolveOption((value) => asCount(value, 1), "COMMENT_CHECKER_TIMEOUT_MS", "timeout_ms", inputs) ?? DEFAULT_CLI_TIMEOUT_MS;
  resolveJudge(resolvedCommentJudge, "COMMENT_CHECKER_JUDGE", subConfigInputs(options, fromConfig, "judge"));
}
var resolvedTestGuard = {
  enabled: true,
  testPatterns: [...DEFAULT_TEST_PATTERNS],
  testCommand: null,
  checks: { ...DEFAULT_TEST_CHECKS },
  maxWarningsPerFile: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  engine: "binary"
};
var resolvedMutation = { enabled: false };
var resolvedJudge = { enabled: false };
var resolvedCommentJudge = { enabled: false };
var resolvedParser = { enabled: false };
function resolveTestGuardConfiguration(config) {
  const options = optionContainer(pluginOptions, "test_guard");
  const fromConfig = optionContainer(config, "test_guard");
  const inputs = { options, config: fromConfig };
  resolveGuardBase(resolvedTestGuard, "TEST_GUARD", inputs);
  resolvedTestGuard.testPatterns = resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", inputs) ?? [...DEFAULT_TEST_PATTERNS];
  resolvedTestGuard.testCommand = resolveOption(asString, "TEST_GUARD_TEST_COMMAND", "test_command", inputs) ?? detectTestCommand(projectDirectory);
  resolvedTestGuard.engine = resolveOption(asEngine, "TEST_GUARD_ENGINE", "engine", inputs) ?? "binary";
  resolveCommandAdapter(resolvedMutation, "TEST_GUARD_MUTATION", subConfigInputs(options, fromConfig, "mutation"));
  resolveJudge(resolvedJudge, "TEST_GUARD_JUDGE", subConfigInputs(options, fromConfig, "judge"));
  resolveCommandAdapter(resolvedParser, "TEST_GUARD_PARSER", subConfigInputs(options, fromConfig, "parser"));
  resolvedTestGuard.checks = resolveRuleConfig(DEFAULT_TEST_CHECKS, {
    envPrefix: "TEST_GUARD_",
    options,
    config: fromConfig
  });
}
function registerAuditCommand(config) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return;
  const record = config;
  const commands = record.command;
  if (commands && typeof commands === "object" && !Array.isArray(commands)) {
    const map = commands;
    if (!map["guard-audit"])
      map["guard-audit"] = { ...GUARD_AUDIT_COMMAND };
    return;
  }
  if (commands === undefined) {
    record.command = { "guard-audit": { ...GUARD_AUDIT_COMMAND } };
  }
}
var CommentCheckerPlugin = async (input, options) => {
  pluginOptions = options;
  if (input && typeof input === "object" && "directory" in input && typeof input.directory === "string") {
    projectDirectory = input.directory;
  }
  resolveConfiguration();
  resolveTestGuardConfiguration();
  startBackgroundInit();
  startTestCheckerBackgroundInit();
  const commentGuard = createCommentGuard(() => resolvedCommentConfig);
  const testGuard = createTestGuard(() => resolvedTestGuard);
  const auditTool = createGuardAuditTool({ directory: projectDirectory, getConfig: () => resolvedTestGuard });
  const judge = createJudge({
    directory: projectDirectory,
    getConfig: () => resolvedJudge,
    getTestPatterns: () => resolvedTestGuard.testPatterns,
    runner: createModelJudgeRunner(input.client, projectDirectory)
  });
  const judgeTool = createGuardJudgeTool(judge);
  const commentJudge = createCommentJudge({
    directory: projectDirectory,
    getConfig: () => resolvedCommentJudge,
    runner: createModelJudgeRunner(input.client, projectDirectory)
  });
  const commentJudgeTool = createGuardCommentJudgeTool(commentJudge);
  const parser = createParserAdapter({
    directory: projectDirectory,
    getConfig: () => resolvedParser,
    getTestPatterns: () => resolvedTestGuard.testPatterns
  });
  const parseTool = createGuardParseTool(parser);
  const mutation = createMutationAdapter({ getConfig: () => resolvedMutation });
  const analyzers = new AnalyzerRegistry;
  analyzers.register(createIdleAnalyzer("mutation", mutation));
  analyzers.register(createIdleAnalyzer("test-judge", judge));
  analyzers.register(createIdleAnalyzer("parser", parser));
  analyzers.register(createIdleAnalyzer("comment-judge", commentJudge));
  const advisories = new AdvisoryQueue;
  return {
    config: async (config) => {
      resolveConfiguration(config);
      resolveTestGuardConfiguration(config);
      registerAuditCommand(config);
    },
    tool: {
      guard_audit: auditTool,
      guard_judge: judgeTool,
      guard_parse: parseTool,
      guard_comment_judge: commentJudgeTool
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle")
        return;
      const sessionID = event.properties?.sessionID ?? "";
      const results = await analyzers.run("idle", { tool: "", sessionID });
      for (const result of results) {
        if (result.note)
          advisories.queue(result.note);
      }
    },
    "tool.execute.before": async (input, output) => {
      testGuard.before(input, output);
      await commentGuard.before(input, output);
    },
    "tool.execute.after": async (input, output) => {
      await commentGuard.after(input, output);
      await testGuard.after(input, output);
      appendAdvisories(output, advisories.consume());
    }
  };
};
var src_default = CommentCheckerPlugin;
export {
  CommentCheckerPlugin,
  src_default as default
};
