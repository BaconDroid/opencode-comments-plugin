#!/usr/bin/env bun
// @bun

// src/bin.ts
import { readFileSync as readFileSync6 } from "fs";

// src/core/ci.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
import { isAbsolute as isAbsolute2, join as join2, relative as relative2 } from "path";

// src/cli.ts
import { existsSync as existsSync2 } from "fs";

// src/downloader.ts
var {spawn } = globalThis.Bun;
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { isAbsolute, join, relative, sep } from "path";
import { homedir } from "os";

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

// src/constants.ts
var COMMENT_CHECKER_EVENT = "PostToolUse";
var DEFAULT_CLI_TIMEOUT_MS = 5000;
var COMMENT_CHECKER_BINARY_NAME = process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
var COMMENT_CHECKER_FALLBACK_VERSION = "0.8.0";

// src/downloader.ts
var debugLog = createDebugLog("comment-checker:downloader", process.env.COMMENT_CHECKER_DEBUG === "1");
var REPO = "BaconDroid/comment-checker";
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
function getCachedVersionForPath(binaryPath, cacheDir) {
  const rel = relative(cacheDir, binaryPath);
  if (rel.length === 0 || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..")
    return null;
  const segments = rel.split(sep);
  return segments.length >= 2 ? segments[0] ?? null : null;
}
function getCommentCheckerVersionFromCachePath(binaryPath) {
  return getCachedVersionForPath(binaryPath, getCacheDir());
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
  return readLatestCache()?.version ?? COMMENT_CHECKER_FALLBACK_VERSION;
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
  return COMMENT_CHECKER_FALLBACK_VERSION;
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
  const version = versionOverride ?? COMMENT_CHECKER_FALLBACK_VERSION;
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
  console.log("[opencode-guard-plugin] Downloading comment-checker binary...");
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
    console.log("[opencode-guard-plugin] comment-checker binary ready.");
    cleanupStaleCache(version);
    return binaryPath;
  } catch (err) {
    debugLog("Failed to download:", err);
    console.error(`[opencode-guard-plugin] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`);
    console.error("[opencode-guard-plugin] Comment checking disabled.");
    return null;
  }
}
async function ensureCommentCheckerBinary(versionOverride) {
  const version = versionOverride ?? await getLatestCommentCheckerVersion();
  const cachedPath = getCachedBinaryPath(version);
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath);
    cleanupStaleCache(version);
    return cachedPath;
  }
  return downloadCommentChecker(version);
}
var TEST_REPO = "BaconDroid/test-checker";
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
  return getTestCheckerVersion() ?? readTestLatestCache()?.version ?? null;
}
async function getLatestTestCheckerVersion() {
  const pinned = getTestCheckerVersion();
  if (pinned)
    return pinned;
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
  console.log("[opencode-guard-plugin] Downloading test-checker binary...");
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
    console.log("[opencode-guard-plugin] test-checker binary ready.");
    cleanupTestCheckerStaleCache(version);
    return binaryPath;
  } catch (err) {
    debugLog("Failed to download test-checker:", err);
    console.error(`[opencode-guard-plugin] Failed to download test-checker: ${err instanceof Error ? err.message : err}`);
    console.error("[opencode-guard-plugin] Test checking disabled.");
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
async function runProcess(args, options = {}) {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_CLI_TIMEOUT_MS;
  try {
    const proc = spawn2(args, {
      stdin: options.stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      ...options.env ? { env: { ...process.env, ...options.env } } : {}
    });
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
  const version = getPreferredCommentCheckerVersionSync();
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
function firstLine(text) {
  return text.trim().split(`
`)[0]?.trim() ?? "";
}
var binaryVersionCache = new Map;
async function readBinaryVersion(binaryPath, binaryName, timeoutMs) {
  if (binaryVersionCache.has(binaryPath))
    return binaryVersionCache.get(binaryPath) ?? null;
  const outcome = await runProcess([binaryPath, "--version"], { timeoutMs });
  let version = null;
  if (outcome !== "timeout" && outcome.exitCode === 0) {
    const match = outcome.stdout.trim().match(/^(\S+)\s+(\S+)$/);
    if (match && match[1] === binaryName)
      version = match[2] ?? null;
  }
  binaryVersionCache.set(binaryPath, version);
  return version;
}
async function staleBinaryReason(binaryPath, binaryName, expectedVersion, timeoutMs) {
  if (!expectedVersion)
    return null;
  const actual = await readBinaryVersion(binaryPath, binaryName, timeoutMs);
  if (!actual || actual === expectedVersion)
    return null;
  return `cached ${binaryName} binary is ${actual} but the plugin expects ${expectedVersion}`;
}
function didNotRunComment(reason) {
  return { hasComments: false, message: "", didNotRun: { reason } };
}
async function runCommentChecker(input, options = {}) {
  const binaryPath = options.cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync();
  if (!binaryPath) {
    debugLog2("comment-checker binary not found");
    return didNotRunComment("binary not found");
  }
  if (!existsSync2(binaryPath)) {
    debugLog2("comment-checker binary does not exist:", binaryPath);
    return didNotRunComment(`binary not found at ${binaryPath}`);
  }
  const stale = await staleBinaryReason(binaryPath, "comment-checker", options.expectedVersion ?? getCommentCheckerVersionFromCachePath(binaryPath), options.timeoutMs);
  if (stale) {
    debugLog2(stale);
    return didNotRunComment(stale);
  }
  const jsonInput = JSON.stringify(input);
  debugLog2("running comment-checker with input:", jsonInput.substring(0, 200));
  const args = [binaryPath];
  if (options.prompt && options.prompt.trim().length > 0) {
    args.push("--prompt", options.prompt);
  }
  const env = options.keywordAcquit ? { COMMENT_CHECKER_KEYWORD_ACQUIT: options.keywordAcquit } : undefined;
  const outcome = await runProcess(args, { stdin: jsonInput, timeoutMs: options.timeoutMs, env });
  if (outcome === "timeout") {
    debugLog2("comment-checker abandoned after timeout or stream failure");
    return didNotRunComment("timed out or could not be spawned");
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
  const detail = firstLine(stderr);
  return didNotRunComment(`exited with code ${exitCode}${detail ? `: ${detail}` : ""}`);
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

// src/core/diff.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
var LANGUAGE_BY_EXTENSION = {
  ".bash": "bash",
  ".sh": "bash",
  ".bats": "bash",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".cue": "cue",
  ".dart": "dart",
  ".dockerfile": "dockerfile",
  ".ex": "elixir",
  ".exs": "elixir",
  ".elm": "elm",
  ".go": "go",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".hs": "haskell",
  ".hcl": "hcl",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".lua": "lua",
  ".ml": "ocaml",
  ".php": "php",
  ".proto": "proto",
  ".py": "python",
  ".pyi": "python",
  ".pyw": "python",
  ".r": "r",
  ".rb": "ruby",
  ".rs": "rust",
  ".scala": "scala",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "ts",
  ".tsx": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zig": "zig"
};
function detectLanguage(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const file = normalized.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  const extension = dot >= 0 ? file.slice(dot) : `.${file.replace(/^\.+/, "")}`;
  return LANGUAGE_BY_EXTENSION[extension] ?? "unknown";
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
  ruby: ["#"],
  java: ["//"],
  php: ["//", "#"],
  csharp: ["//"],
  kotlin: ["//"],
  swift: ["//"],
  scala: ["//"],
  elixir: ["#"],
  lua: ["--"],
  c: ["//"],
  cpp: ["//"],
  groovy: ["//"],
  ocaml: ["(*"],
  elm: ["--"],
  bash: ["#"],
  css: ["/*"],
  cue: ["//"],
  dart: ["//"],
  dockerfile: ["#"],
  haskell: ["--"],
  hcl: ["//", "#"],
  html: ["<!--"],
  proto: ["//"],
  r: ["#"],
  sql: ["--"],
  svelte: ["//", "<!--"],
  toml: ["#"],
  yaml: ["#"],
  zig: ["//"],
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
  if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/"))
    return true;
  const markers = LINE_COMMENT[language] ?? ["//"];
  if (markers.some((marker) => trimmed.startsWith(marker)))
    return true;
  if (language === "python" && (trimmed.startsWith('"""') || trimmed.startsWith("'''")))
    return true;
  return false;
}
function countRealLines(text, language) {
  return text.split(`
`).map((line) => stripComments(line, language)).filter((line) => line.trim().length > 0).length;
}
function readFileIfExists(filePath) {
  try {
    return existsSync3(filePath) ? readFileSync2(filePath, "utf8") : undefined;
  } catch {
    return;
  }
}

// src/core/feedback.ts
function truncateExcerpt(excerpt, max) {
  const oneLine = excerpt.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(0, max - 1))}\u2026` : oneLine;
}
function formatFindings(findings, maxExcerpt = 80) {
  return findings.map((finding) => {
    const location = `${finding.filePath}:${finding.line}`;
    const confidence = finding.confidence ? ` (confidence: ${finding.confidence})` : "";
    return `- [${finding.severity}] ${finding.rule} (${location}): ${finding.message}${confidence}
  > ${truncateExcerpt(finding.excerpt, maxExcerpt)}`;
  }).join(`
`);
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

// src/rules/tests/patterns.ts
var TEST_PATH_TABLE = {
  directorySegments: ["tests", "test", "__tests__", "spec", "specs"],
  filenamePrefixes: ["test_", "test-"],
  filenameInfixes: ["_test.", ".test.", ".spec.", "_spec."]
};
var DEFAULT_TEST_PATTERNS = [];
var HARNESS_PATH_TABLE = {
  pathSubstrings: [".github/workflows/", ".gitlab-ci"],
  filenames: [
    "pytest.ini",
    "tox.ini",
    "conftest.py",
    "setup.cfg",
    "pyproject.toml",
    "package.json",
    "makefile",
    "codecov.yml"
  ],
  filenamePrefixes: ["jest.config", "vitest.config", "karma.conf", ".nycrc"]
};
var TEST_CONFIG_BASENAMES = [".test-checker.json"];
function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}
function matchesTestPathTable(filePath, table = TEST_PATH_TABLE) {
  const normalized = normalizePath(filePath);
  const file = normalized.split("/").pop() ?? "";
  return normalized.split("/").some((segment) => table.directorySegments.includes(segment)) || table.filenamePrefixes.some((prefix) => file.startsWith(prefix)) || table.filenameInfixes.some((infix) => file.includes(infix));
}
function matchesHarnessPathTable(filePath, table) {
  const normalized = normalizePath(filePath);
  const file = normalized.split("/").pop() ?? "";
  return table.pathSubstrings.some((substring) => normalized.includes(substring)) || table.filenames.includes(file) || table.filenamePrefixes.some((prefix) => file.startsWith(prefix));
}
function isTestPath(filePath, patterns) {
  if (patterns.length === 0)
    return matchesTestPathTable(filePath);
  return matchesAnyGlob(patterns, filePath.replace(/\\/g, "/"));
}
function isHarnessPath(filePath) {
  return matchesHarnessPathTable(filePath, HARNESS_PATH_TABLE);
}
function isTestConfigPath(filePath) {
  const file = normalizePath(filePath).split("/").pop() ?? "";
  return TEST_CONFIG_BASENAMES.includes(file);
}
function isSelectedTestPath(filePath, patterns) {
  return isHarnessPath(filePath) || isTestConfigPath(filePath) || isTestPath(filePath, patterns);
}
function isTestFileForAnalysis(filePath, patterns) {
  return isTestPath(filePath, patterns) && !isHarnessPath(filePath) && !isTestConfigPath(filePath);
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
  /@ts-nocheck\b/,
  /--no-verify\b/,
  /#\s*ruff:\s*noqa/,
  /\bfail_under\s*=\s*0\b/
];
var FORCED_SUCCESS_PATTERNS = [
  /\|\|\s*(?:true|:)\s*$/,
  /(?:^|[^\w])exit\s+0\b/,
  /\bsys\.exit\(\s*0\s*\)/,
  /\bprocess\.exit\(\s*0\s*\)/,
  /\bcontinue-on-error:\s*true\b/,
  /--passWithNoTests\b/
];
var NEGATIVE_CONTROL_PATTERNS = {
  python: [
    /pytest\.raises\(\s*(?:Exception|BaseException)\s*\)/,
    /assertRaises\(\s*(?:Exception|BaseException)\s*\)/,
    /assertRaisesRegex\(\s*(?:Exception|BaseException)/
  ],
  js: [/\.toThrow\s*\(\s*(?:Error\s*)?\)/, /expect\([^)]*\)\.not\.toThrow\(\s*\)/],
  ts: [/\.toThrow\s*\(\s*(?:Error\s*)?\)/, /expect\([^)]*\)\.not\.toThrow\(\s*\)/]
};
var EXPECTED_ASSERTION_GATE = [
  /\bassert/,
  /\bexpect\s*\(/,
  /\brequire\./,
  /\bshould\b/
];
var CALL_IDENTIFIER_PATTERN = /\b([A-Za-z_]\w*)\s*\(/g;
var JS_MOCK_CALL_PATTERN = /(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/;
var JS_SPY_ON_CALL_PATTERN = /(?:vi|jest)\.spyOn\(\s*(\w+)/;
var JS_IMPORT_FROM_PATTERN = /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/;
var JS_REQUIRE_PATTERN = /(?:const|let|var)\s+(.+?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/;
var PY_PATCH_PATTERN = /(?:mocker\.)?patch\(\s*['"]([^'"]+)['"]/;
var TESTS_NOT_RUN_PATTERNS = [
  /--ignore(?:=|\s)/,
  /--exclude\b/,
  /--deselect\b/,
  /-k\s+['"]?not\b/,
  /--testPathIgnorePatterns/
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
var forcedSuccessRule = {
  id: "forced-success",
  run(ctx) {
    return addedLineFindings(ctx, "forced-success", FORCED_SUCCESS_PATTERNS, "Test command forced to succeed regardless of outcome.");
  }
};
var MOCK_OF_SUT_MESSAGE = "The module under test is mocked; asserting on the mock cannot validate real behavior.";
function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}
function testStem(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  let base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot > 0)
    base = base.slice(0, dot);
  if (base.endsWith(".test") || base.endsWith(".spec")) {
    base = base.slice(0, base.lastIndexOf("."));
  } else if (base.startsWith("test_")) {
    base = base.slice("test_".length);
  } else if (base.endsWith("_test")) {
    base = base.slice(0, base.length - "_test".length);
  }
  return base;
}
function mockedModuleStem(spec) {
  let value = spec.trim();
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (slash >= 0)
    value = value.slice(slash + 1);
  const dot = value.lastIndexOf(".");
  if (dot > 0)
    value = value.slice(0, dot);
  return value;
}
function patchedModuleRoot(spec) {
  let value = spec.trim();
  const index = value.search(/[./]/);
  if (index >= 0)
    value = value.slice(0, index);
  return value;
}
function importedNamesFromStem(text, stem, language) {
  const names = new Set;
  for (const raw of text.split(`
`)) {
    const line = stripComments(raw, language).trim();
    if (line.length === 0)
      continue;
    const importMatch = JS_IMPORT_FROM_PATTERN.exec(line);
    if (importMatch) {
      if (mockedModuleStem(importMatch[2]) === stem)
        collectJSBindings(importMatch[1], names);
      continue;
    }
    const requireMatch = JS_REQUIRE_PATTERN.exec(line);
    if (requireMatch) {
      if (mockedModuleStem(requireMatch[2]) === stem)
        collectJSBindings(requireMatch[1], names);
    }
  }
  return names;
}
function collectJSBindings(binding, names) {
  let value = binding.trim();
  const open = value.indexOf("{");
  if (open >= 0) {
    const close = value.indexOf("}", open);
    if (close >= 0) {
      collectNamedBindings(value.slice(open + 1, close), names);
      value = `${value.slice(0, open)}${value.slice(close + 1)}`.trim();
    }
  }
  value = value.trim();
  if (value.length === 0)
    return;
  if (value.startsWith("*")) {
    const space = value.lastIndexOf(" ");
    if (space >= 0)
      names.add(value.slice(space + 1).trim());
    return;
  }
  const first = value.replace(/,\s*$/, "").trim().split(/\s+/)[0];
  if (first)
    names.add(first);
}
function collectNamedBindings(inner, names) {
  for (const part of inner.split(",")) {
    let value = part.trim();
    if (value.length === 0)
      continue;
    const asIndex = value.indexOf(" as ");
    if (asIndex >= 0)
      value = value.slice(asIndex + 4).trim();
    names.add(value);
  }
}
function mockOfSUTJavaScript(ctx) {
  const stem = testStem(ctx.change.filePath);
  if (stem.length === 0)
    return [];
  const imported = importedNamesFromStem(ctx.change.newText, stem, ctx.change.language);
  const findings = [];
  for (const line of ctx.change.addedLines) {
    const code = stripComments(line, ctx.change.language).trim();
    if (code.length === 0)
      continue;
    let hit = false;
    const mockMatch = JS_MOCK_CALL_PATTERN.exec(code);
    if (mockMatch)
      hit = mockedModuleStem(mockMatch[1]) === stem;
    if (!hit) {
      const spyMatch = JS_SPY_ON_CALL_PATTERN.exec(code);
      if (spyMatch)
        hit = imported.has(spyMatch[1]);
    }
    if (!hit)
      continue;
    const lineNumber = locateLine(ctx.change.newText, line);
    if (withinBypass(ctx, lineNumber))
      continue;
    findings.push({ rule: "mock-of-sut", line: lineNumber, message: MOCK_OF_SUT_MESSAGE, excerpt: code });
  }
  return findings;
}
function mockOfSUTPython(ctx) {
  const stem = testStem(ctx.change.filePath);
  if (stem.length === 0)
    return [];
  const findings = [];
  for (const line of ctx.change.addedLines) {
    const code = stripComments(line, ctx.change.language).trim();
    if (code.length === 0)
      continue;
    const patchMatch = PY_PATCH_PATTERN.exec(code);
    if (!patchMatch || patchedModuleRoot(patchMatch[1]) !== stem)
      continue;
    const lineNumber = locateLine(ctx.change.newText, line);
    if (withinBypass(ctx, lineNumber))
      continue;
    findings.push({ rule: "mock-of-sut", line: lineNumber, message: MOCK_OF_SUT_MESSAGE, excerpt: code });
  }
  return findings;
}
var mockOfSUTRule = {
  id: "mock-of-sut",
  run(ctx) {
    if (!ctx.isTestFile)
      return [];
    switch (ctx.change.language) {
      case "js":
      case "ts":
        return mockOfSUTJavaScript(ctx);
      case "python":
        return mockOfSUTPython(ctx);
      default:
        return [];
    }
  }
};
var ASSERTION_FRAMEWORK_CALLS = new Set([
  "expect",
  "tobe",
  "toequal",
  "tobetruthy",
  "tobedefined",
  "tothrow",
  "tocontain",
  "tomatch",
  "tomatchobject",
  "should",
  "require",
  "equal",
  "errorf",
  "fatalf"
]);
function isAssertionFrameworkCall(name) {
  const lower = name.toLowerCase();
  if (ASSERTION_FRAMEWORK_CALLS.has(lower))
    return true;
  return lower.startsWith("assert") || lower.startsWith("expect") || lower.startsWith("require");
}
function hasRepeatedCall(counts) {
  for (const count of counts.values())
    if (count >= 2)
      return true;
  return false;
}
var expectedFromSUTRule = {
  id: "expected-from-sut",
  run(ctx) {
    const findings = [];
    for (const line of ctx.change.addedLines) {
      const code = codeText(line, ctx.change.language).trim();
      if (code.length === 0 || !matchesAny(EXPECTED_ASSERTION_GATE, code))
        continue;
      const counts = new Map;
      for (const match of code.matchAll(CALL_IDENTIFIER_PATTERN)) {
        const name = match[1];
        if (isAssertionFrameworkCall(name))
          continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (!hasRepeatedCall(counts))
        continue;
      const lineNumber = locateLine(ctx.change.newText, line);
      if (withinBypass(ctx, lineNumber))
        continue;
      findings.push({
        rule: "expected-from-sut",
        line: lineNumber,
        message: "Expected value is produced by the code under test; the assertion may be self-referential.",
        excerpt: stripComments(line, ctx.change.language).trim()
      });
    }
    return findings;
  }
};
var negativeControlUnrelatedRule = {
  id: "negative-control-unrelated",
  run(ctx) {
    const patterns = NEGATIVE_CONTROL_PATTERNS[ctx.change.language];
    if (!patterns || patterns.length === 0)
      return [];
    const findings = [];
    for (const line of ctx.change.addedLines) {
      const code = stripComments(line, ctx.change.language).trim();
      if (code.length === 0 || !matchesAny(patterns, code))
        continue;
      const lineNumber = locateLine(ctx.change.newText, line);
      if (withinBypass(ctx, lineNumber))
        continue;
      findings.push({
        rule: "negative-control-unrelated",
        line: lineNumber,
        message: "Negative control is too broad and can pass for an unrelated reason.",
        excerpt: code
      });
    }
    return findings;
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
  duplicateTestRule,
  forcedSuccessRule,
  mockOfSUTRule
];
var ADVISORY_RULES = [
  overMockingRule,
  assertionRouletteRule,
  weakenedConfigRule,
  redundantAssertionRule,
  testsNotRunRule,
  expectedFromSUTRule,
  negativeControlUnrelatedRule
];
// src/rules/tests/binary-rule-ids.json
var binary_rule_ids_default = {
  source: "BaconDroid/test-checker",
  ref: "4313271890fb9ff79be5b0fb48ad1a39856b3615",
  rules: [
    "skip-added",
    "focus-added",
    "assertion-removed",
    "test-removed",
    "gutted-test",
    "no-assertion",
    "tautological-assertion",
    "constant-assertion",
    "weakened-assertion",
    "swallowed-error",
    "incomplete-assertion",
    "unawaited-assertion",
    "broad-exception",
    "mock-of-sut",
    "over-mocking",
    "duplicate-test",
    "expected-copied-from-actual",
    "snapshot-regenerated",
    "tolerance-broadened",
    "conditional-assertion",
    "retry-added",
    "agent-memo-test",
    "allow-added",
    "allow-invalid",
    "config-edited",
    "gate-weakened",
    "commented-out-test",
    "source-grep-test",
    "test-volume",
    "harness-edited",
    "near-duplicate-test",
    "echo-test",
    "mirror-implementation-test"
  ]
};

// src/rules/tests/rule-ids.ts
var BINARY_RULE_ID_TABLE = binary_rule_ids_default;
var BINARY_RULE_IDS = BINARY_RULE_ID_TABLE.rules;
var LEGACY_RULE_ALIASES = {
  "skip-focus-added": ["skip-added", "focus-added"],
  "tautological-assertion": ["tautological-assertion", "constant-assertion"],
  "matcher-loosened": ["weakened-assertion"],
  "empty-test": ["gutted-test"],
  "forced-success": ["gate-weakened"],
  "expected-from-sut": ["expected-copied-from-actual"],
  "weakened-config": ["gate-weakened", "harness-edited"]
};
var DEFAULT_RULE_SEVERITY = "warn";
var KNOWN_RULE_IDS = new Set([
  ...BINARY_RULE_IDS,
  ...Object.keys(LEGACY_RULE_ALIASES),
  ...Object.values(LEGACY_RULE_ALIASES).flat()
]);
function resolveRuleSeverity(checks, ruleId) {
  const exact = checks[ruleId];
  if (exact !== undefined)
    return { severity: exact, known: true };
  for (const [legacy, targets] of Object.entries(LEGACY_RULE_ALIASES)) {
    if (!targets.includes(ruleId))
      continue;
    const aliased = checks[legacy];
    if (aliased !== undefined)
      return { severity: aliased, known: true };
  }
  return { severity: DEFAULT_RULE_SEVERITY, known: KNOWN_RULE_IDS.has(ruleId) };
}

// src/rules/tests/index.ts
var ALL_TEST_RULES = [...DETERMINISTIC_RULES, ...ADVISORY_RULES];
function buildRuleChecks(includeAdvisory) {
  const checks = {};
  for (const rule of DETERMINISTIC_RULES)
    checks[rule.id] = "warn";
  for (const rule of ADVISORY_RULES)
    checks[rule.id] = includeAdvisory ? "warn" : "off";
  for (const id of BINARY_RULE_IDS)
    checks[id] = "warn";
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
var debugLog3 = createDebugLog("test-guard", process.env.TEST_GUARD_DEBUG === "1" || process.env.COMMENT_CHECKER_DEBUG === "1");
var unknownRuleWarned = new Set;
function severityFor(checks, ruleId, sessionID) {
  const resolution = resolveRuleSeverity(checks, ruleId);
  if (!resolution.known) {
    const key = `${sessionID}\x00${ruleId}`;
    if (!unknownRuleWarned.has(key)) {
      unknownRuleWarned.add(key);
      debugLog3(`unknown test-checker rule id "${ruleId}" \u2014 enabled at warn`);
    }
  }
  return resolution.severity;
}
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
        isTestFile: config.isTestFile ?? isTestFileForAnalysis(change.filePath, config.testPatterns),
        config: {
          enabled: config.enabled,
          testPatterns: config.testPatterns,
          checks: config.checks,
          maxWarningsPerFile: 0
        }
      });
      return {
        findings: toFindings(result.findings, change.filePath, config.checks, ctx.sessionID),
        bypasses: result.bypasses
      };
    }
  };
}
function toFindings(findings, filePath, checks, sessionID) {
  return findings.map((finding) => ({
    rule: finding.rule,
    filePath,
    line: finding.line,
    message: finding.message,
    severity: severityFor(checks, finding.rule, sessionID),
    excerpt: finding.excerpt
  }));
}

// src/core/ci.ts
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
  return diffChanges(directory, base).filter((change) => isSelectedTestPath(change.filePath, testPatterns) && (isHarnessPath(change.filePath) || isTestConfigPath(change.filePath) || isSupportedLanguage(change.language)));
}
function diffChanges(directory, base) {
  const changes = [];
  for (const relativePath of changedFiles(directory, base)) {
    const absolute = isAbsolute2(relativePath) ? relativePath : join2(directory, relativePath);
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
function assertionLines(lines, language) {
  const set = new Set;
  for (const line of lines) {
    const code = stripComments(line, language).trim();
    if (code.length > 0 && ASSERTION_COUNT_PATTERNS.some((pattern) => pattern.test(code)))
      set.add(code);
  }
  return set;
}
function isMovedTest(change, addedByFile) {
  const removed = assertionLines(change.removedLines, change.language);
  if (removed.size === 0)
    return false;
  const others = new Set;
  for (const [path, added] of addedByFile) {
    if (path === change.filePath)
      continue;
    for (const line of added)
      others.add(line);
  }
  for (const line of removed)
    if (!others.has(line))
      return false;
  return true;
}
function runDiffCheck(options) {
  const directory = options.directory;
  const base = options.base ?? "HEAD";
  const testPatterns = options.testPatterns && options.testPatterns.length > 0 ? options.testPatterns : [...DEFAULT_TEST_PATTERNS];
  const checks = buildRuleChecks(options.includeAdvisory ?? false);
  const changes = changedTestChanges(directory, base, testPatterns);
  const addedByFile = new Map;
  for (const change of changes)
    addedByFile.set(change.filePath, assertionLines(change.addedLines, change.language));
  const findings = [];
  for (const change of changes) {
    const analyzer = createRuleAnalyzer(() => ({
      enabled: true,
      testPatterns,
      checks,
      isTestFile: isTestFileForAnalysis(change.filePath, testPatterns)
    }));
    const result = runAnalyzer(analyzer, { tool: "", sessionID: "guard-check", change });
    for (const finding of result.findings ?? []) {
      if (finding.rule === "gutted-test" && isMovedTest(change, addedByFile)) {
        continue;
      }
      findings.push({
        rule: finding.rule,
        filePath: relative2(directory, change.filePath) || change.filePath,
        line: finding.line,
        message: finding.message,
        severity: checks[finding.rule] ?? "warn",
        excerpt: finding.excerpt
      });
    }
  }
  if (options.format === "json") {
    return { findings, output: JSON.stringify({ findings }, null, 2) };
  }
  const header = `# Test guard check (${base})`;
  const body = findings.length > 0 ? formatFindings(findings) : "No findings.";
  return { findings, output: `${header}

${body}` };
}
async function defaultCommentCheck(change, directory) {
  const cliPath = await getCommentCheckerPath();
  if (!cliPath || !existsSync4(cliPath))
    return { hasComments: false, message: "" };
  return runCommentChecker(commentHookInput({
    sessionID: "guard-check",
    toolName: "Edit",
    cwd: directory,
    toolInput: { file_path: change.filePath, old_string: change.oldText, new_string: change.newText }
  }), { cliPath });
}
async function runCommentDiffCheck(options, deps = {}) {
  const directory = options.directory;
  const base = options.base ?? "HEAD";
  const runCheck = deps.runCheck ?? ((change) => defaultCommentCheck(change, directory));
  const changes = diffChanges(directory, base).filter((change) => isSupportedLanguage(change.language) && change.addedLines.length > 0);
  const entries = [];
  for (const change of changes) {
    try {
      const result = await runCheck(change);
      if (result.hasComments && result.message) {
        entries.push({ file: relative2(directory, change.filePath) || change.filePath, message: result.message });
      }
    } catch {}
  }
  if (options.format === "json") {
    return { output: JSON.stringify({ comments: entries }, null, 2), count: entries.length };
  }
  const header = `# Comment guard check (${base})`;
  const body = entries.length === 0 ? "No findings." : entries.map((entry) => `## ${entry.file}

${entry.message}`).join(`

`);
  return { output: `${header}

${body}`, count: entries.length };
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
function asKeywordAcquit(value) {
  if (typeof value !== "string")
    return;
  const normalized = value.trim().toLowerCase();
  if (normalized === "proven-only" || normalized === "never")
    return normalized;
  return;
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
function asLevel(value) {
  if (typeof value !== "string")
    return;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off" || normalized === "warn")
    return normalized;
  return;
}

// src/core/schema.ts
var SEVERITY = ["off", "warn"];
function validateTupleOptions(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["options must be an object"] };
  }
  const options = value;
  const comment = options.comment_checker;
  if (comment !== undefined) {
    if (!isRecord(comment))
      errors.push("comment_checker must be an object");
    else
      validateCommentChecker(comment, "comment_checker", errors);
  }
  const guard = options.test_guard;
  if (guard !== undefined) {
    if (!isRecord(guard))
      errors.push("test_guard must be an object");
    else
      validateTestGuard(guard, "test_guard", errors);
  }
  return { valid: errors.length === 0, errors };
}
function validateCommentChecker(record, path, errors) {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    errors.push(`${path}.enabled must be a boolean`);
  for (const key of ["custom_prompt", "append_prompt"]) {
    if (record[key] !== undefined && asString(record[key]) === undefined)
      errors.push(`${path}.${key} must be a non-empty string`);
  }
  if (record.max_warnings_per_file !== undefined && asCount(record.max_warnings_per_file, 0) === undefined) {
    errors.push(`${path}.max_warnings_per_file must be an integer >= 0`);
  }
  if (record.dedup_window_ms !== undefined && asCount(record.dedup_window_ms, 0) === undefined) {
    errors.push(`${path}.dedup_window_ms must be an integer >= 0`);
  }
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`);
  }
  if (record.tools !== undefined && asTools(record.tools) === undefined) {
    errors.push(`${path}.tools must be a string array or a comma separated string`);
  }
  if (record.paths !== undefined && asPatterns(record.paths) === undefined) {
    errors.push(`${path}.paths must be a string array or a comma separated string`);
  }
  if (record.keyword_acquit !== undefined && asKeywordAcquit(record.keyword_acquit) === undefined) {
    errors.push(`${path}.keyword_acquit must be one of proven-only, never`);
  }
  if (record.judge !== undefined) {
    if (!isRecord(record.judge))
      errors.push(`${path}.judge must be an object`);
    else
      validateJudge(record.judge, `${path}.judge`, errors);
  }
  rejectUnknown(record, ["enabled", "custom_prompt", "append_prompt", "max_warnings_per_file", "dedup_window_ms", "timeout_ms", "tools", "paths", "keyword_acquit", "judge"], path, errors);
}
function validateTestGuard(record, path, errors) {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    errors.push(`${path}.enabled must be a boolean`);
  if (record.test_patterns !== undefined && asPatterns(record.test_patterns) === undefined) {
    errors.push(`${path}.test_patterns must be a string array or a comma separated string`);
  }
  if (record.test_command !== undefined && record.test_command !== null && asString(record.test_command) === undefined) {
    errors.push(`${path}.test_command must be a string or null`);
  }
  if (record.max_warnings_per_file !== undefined && asCount(record.max_warnings_per_file, 0) === undefined) {
    errors.push(`${path}.max_warnings_per_file must be an integer >= 0`);
  }
  if (record.dedup_window_ms !== undefined && asCount(record.dedup_window_ms, 0) === undefined) {
    errors.push(`${path}.dedup_window_ms must be an integer >= 0`);
  }
  if (record.tools !== undefined && asTools(record.tools) === undefined) {
    errors.push(`${path}.tools must be a string array or a comma separated string`);
  }
  if (record.engine !== undefined && asEngine(record.engine) === undefined) {
    errors.push(`${path}.engine must be one of binary, regex`);
  }
  if (record.checks !== undefined) {
    if (!isRecord(record.checks))
      errors.push(`${path}.checks must be an object`);
    else {
      for (const [rule, level] of Object.entries(record.checks)) {
        if (asLevel(level) === undefined)
          errors.push(`${path}.checks.${rule} must be one of ${SEVERITY.join(", ")}`);
      }
    }
  }
  if (record.custom_prompt !== undefined && asString(record.custom_prompt) === undefined) {
    errors.push(`${path}.custom_prompt must be a non-empty string`);
  }
  if (record.append_prompt !== undefined && asString(record.append_prompt) === undefined) {
    errors.push(`${path}.append_prompt must be a non-empty string`);
  }
  if (record.mutation !== undefined) {
    if (!isRecord(record.mutation))
      errors.push(`${path}.mutation must be an object`);
    else
      validateMutation(record.mutation, `${path}.mutation`, errors);
  }
  if (record.judge !== undefined) {
    if (!isRecord(record.judge))
      errors.push(`${path}.judge must be an object`);
    else
      validateJudge(record.judge, `${path}.judge`, errors);
  }
  if (record.parser !== undefined) {
    if (!isRecord(record.parser))
      errors.push(`${path}.parser must be an object`);
    else
      validateParser(record.parser, `${path}.parser`, errors);
  }
  rejectUnknown(record, [
    "enabled",
    "test_patterns",
    "test_command",
    "checks",
    "max_warnings_per_file",
    "dedup_window_ms",
    "custom_prompt",
    "append_prompt",
    "tools",
    "engine",
    "mutation",
    "judge",
    "parser"
  ], path, errors);
}
function validateMutation(record, path, errors) {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    errors.push(`${path}.enabled must be a boolean`);
  if (record.command !== undefined && asString(record.command) === undefined)
    errors.push(`${path}.command must be a non-empty string`);
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`);
  }
  rejectUnknown(record, ["enabled", "command", "timeout_ms"], path, errors);
}
function validateJudge(record, path, errors) {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    errors.push(`${path}.enabled must be a boolean`);
  if (record.model !== undefined && asString(record.model) === undefined)
    errors.push(`${path}.model must be a non-empty string`);
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`);
  }
  rejectUnknown(record, ["enabled", "model", "timeout_ms"], path, errors);
}
function validateParser(record, path, errors) {
  if (record.enabled !== undefined && typeof record.enabled !== "boolean")
    errors.push(`${path}.enabled must be a boolean`);
  if (record.command !== undefined && asString(record.command) === undefined)
    errors.push(`${path}.command must be a non-empty string`);
  if (record.timeout_ms !== undefined && asCount(record.timeout_ms, 1) === undefined) {
    errors.push(`${path}.timeout_ms must be an integer >= 1`);
  }
  rejectUnknown(record, ["enabled", "command", "timeout_ms"], path, errors);
}
function rejectUnknown(record, known, path, errors) {
  for (const key of Object.keys(record)) {
    if (!known.includes(key))
      errors.push(`${path}.${key} is not a recognized option`);
  }
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/core/test-command.ts
import { join as join3 } from "path";
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
  const packageJson = readFileIfExists(join3(directory, "package.json"));
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
    const content = readFileIfExists(join3(directory, candidate.file));
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
import { isAbsolute as isAbsolute3, join as join4, relative as relative3 } from "path";

// src/core/idle-advisory.ts
import { tool } from "@opencode-ai/plugin";

// src/audit.ts
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
    const full = join4(dir, entry);
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
      const abs = isAbsolute3(entry) ? entry : join4(directory, entry);
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
`).filter((line) => line.trim().length > 0).map((line) => join4(directory, line)).slice(0, MAX_FILES);
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
  const isTestFile = file.isTestFile ?? true;
  const analyzer = createRuleAnalyzer(() => ({ enabled: true, testPatterns: [], checks, isTestFile }));
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
  return relative3(process.cwd(), filePath) || filePath;
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
    const nonTestGate = isHarnessPath(filePath) || isTestConfigPath(filePath);
    if (!isSupportedLanguage(language) && !(nonTestGate && scope !== "comments"))
      continue;
    if (scope !== "comments" && !isSelectedTestPath(filePath, testPatterns))
      continue;
    audited.push({ filePath, display: display(filePath), language, isTestFile: isTestFileForAnalysis(filePath, testPatterns) });
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
    const fileTexts = audited.filter((file) => isTestFileForAnalysis(file.filePath, testPatterns)).map((file) => ({ filePath: file.filePath, text: readText(file.filePath) ?? "", language: file.language })).filter((entry) => entry.text.length > 0);
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

// src/cleanup.ts
import { tool as tool3 } from "@opencode-ai/plugin";
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "fs";
import { relative as relative4 } from "path";
var CLEANUP_TIMEOUT_MS = 30000;
var SUMMARY_MARKER = "[test-checker] cleanup pass:";
var REMOVED_LINE = /^\s+removed: (.+) \[([^\]]+)\]\s*$/;
var KEPT_LINE = /^\s+kept awaiting approval: (.+) \[([^\]]+)\]\s*$/;
var NOTE_LINE = /^\s+note: (.+)\s*$/;
function parseCleanupSummary(stderr) {
  const removed = [];
  const kept = [];
  let note;
  let summary = false;
  for (const line of stderr.split(`
`)) {
    if (line.includes(SUMMARY_MARKER)) {
      summary = true;
      continue;
    }
    const removedMatch = REMOVED_LINE.exec(line);
    if (removedMatch) {
      removed.push({ name: removedMatch[1].trim(), rule: removedMatch[2].trim() });
      continue;
    }
    const keptMatch = KEPT_LINE.exec(line);
    if (keptMatch) {
      kept.push({ name: keptMatch[1].trim(), rule: keptMatch[2].trim() });
      continue;
    }
    if (note === undefined) {
      const noteMatch = NOTE_LINE.exec(line);
      if (noteMatch)
        note = noteMatch[1].trim();
    }
  }
  return { removed, kept, ...note ? { note } : {}, summary };
}
function cleanupPayload(filePath, cwd, content) {
  return {
    session_id: "guard-cleanup",
    tool_name: "Write",
    transcript_path: "",
    cwd,
    hook_event_name: COMMENT_CHECKER_EVENT,
    is_test_file: true,
    tool_input: { file_path: filePath, content }
  };
}
async function defaultRun(input, binaryPath, timeoutMs) {
  if (!existsSync5(binaryPath)) {
    return { kind: "did-not-run", reason: `binary not found at ${binaryPath}` };
  }
  const outcome = await runProcess([binaryPath, "--strip", "--min-confidence", "low"], {
    stdin: JSON.stringify(input),
    timeoutMs
  });
  if (outcome === "timeout") {
    return { kind: "did-not-run", reason: "timed out or could not be spawned" };
  }
  if (outcome.exitCode !== 0 && outcome.exitCode !== 2) {
    const detail = outcome.stderr.trim().split(`
`)[0]?.trim() ?? "";
    return { kind: "did-not-run", reason: `exited with code ${outcome.exitCode}${detail ? `: ${detail}` : ""}` };
  }
  return { kind: "output", stderr: outcome.stderr, exitCode: outcome.exitCode };
}
async function resolveBinary(cliPath) {
  if (cliPath)
    return cliPath;
  const override = process.env.TC_BINARY?.trim();
  if (override)
    return override;
  try {
    return await getTestCheckerPath();
  } catch {
    return null;
  }
}
function display2(filePath, directory) {
  return relative4(directory, filePath) || filePath;
}
async function collectCleanup(options, deps = {}) {
  const directory = options.directory;
  const testPatterns = options.testPatterns ?? [];
  const run = deps.run ?? defaultRun;
  const skipped = [];
  const testFiles = [];
  for (const filePath of listRepositoryFiles(directory, options.paths)) {
    if (isSecretFile(filePath)) {
      skipped.push(`${display2(filePath, directory)} (secret file pattern)`);
      continue;
    }
    if (!isSelectedTestPath(filePath, testPatterns))
      continue;
    if (isHarnessPath(filePath) || isTestConfigPath(filePath)) {
      skipped.push(`${display2(filePath, directory)} (harness/config; nothing to strip)`);
      continue;
    }
    if (!isSupportedLanguage(detectLanguage(filePath)))
      continue;
    testFiles.push(filePath);
  }
  const binaryPath = await resolveBinary(options.cliPath);
  if (!binaryPath) {
    return {
      directory,
      files: [],
      skipped,
      binaryAvailable: false,
      unsupported: false,
      generatedAt: new Date().toISOString()
    };
  }
  const files = [];
  for (const filePath of testFiles) {
    let content;
    try {
      content = readFileSync5(filePath, "utf8");
    } catch {
      skipped.push(`${display2(filePath, directory)} (unreadable)`);
      continue;
    }
    const file = {
      filePath,
      display: display2(filePath, directory),
      removed: [],
      kept: [],
      summary: false
    };
    const outcome = await run(cleanupPayload(filePath, directory, content), binaryPath, options.timeoutMs ?? CLEANUP_TIMEOUT_MS);
    if (outcome.kind === "did-not-run") {
      file.error = outcome.reason;
      files.push(file);
      continue;
    }
    const parsed = parseCleanupSummary(outcome.stderr);
    file.removed = parsed.removed;
    file.kept = parsed.kept;
    file.summary = parsed.summary;
    if (parsed.note)
      file.note = parsed.note;
    files.push(file);
  }
  return {
    directory,
    files,
    skipped,
    binaryAvailable: true,
    unsupported: files.length > 0 && files.every((file) => !file.summary && !file.error),
    generatedAt: new Date().toISOString()
  };
}
function renderCleanup(report) {
  const lines = [];
  lines.push("# Test guard cleanup");
  lines.push("");
  lines.push(`Generated ${report.generatedAt}`);
  lines.push("");
  const removed = report.files.reduce((count, file) => count + file.removed.length, 0);
  const kept = report.files.reduce((count, file) => count + file.kept.length, 0);
  if (!report.binaryAvailable) {
    lines.push("No test-checker binary available; nothing was checked or rewritten.");
    appendSkipped(lines, report.skipped);
    return lines.join(`
`);
  }
  if (report.files.length === 0) {
    lines.push("No test files found. Nothing to clean up.");
    appendSkipped(lines, report.skipped);
    return lines.join(`
`);
  }
  if (report.unsupported) {
    lines.push("test-checker did not report a cleanup pass for any test file. The binary may predate `--strip`; nothing was rewritten.");
    lines.push("Upgrade test-checker to the version that added `--strip` and run the cleanup again.");
    appendSkipped(lines, report.skipped);
    return lines.join(`
`);
  }
  lines.push(`Removed ${removed} test block(s); ${kept} kept awaiting approval across ${report.files.length} test file(s).`);
  lines.push("");
  if (removed > 0) {
    lines.push(`## Removed (${removed})`);
    lines.push("");
    lines.push("| file | test | rule |");
    lines.push("|---|---|---|");
    for (const file of report.files) {
      for (const item of file.removed) {
        lines.push(`| ${escapeCell2(file.display)} | ${escapeCell2(item.name)} | ${item.rule} |`);
      }
    }
    lines.push("");
  }
  if (kept > 0) {
    lines.push(`## Kept awaiting approval (${kept})`);
    lines.push("");
    lines.push("| file | test | rule |");
    lines.push("|---|---|---|");
    for (const file of report.files) {
      for (const item of file.kept) {
        lines.push(`| ${escapeCell2(file.display)} | ${escapeCell2(item.name)} | ${item.rule} |`);
      }
    }
    lines.push("");
    lines.push('Approve a removal with a "remove" entry (`{"glob","rules","reason"}`, reason at least 12 characters) in the git root\'s `.test-checker.json`, then run the cleanup again. The test-checker binary enforces the approval; the plugin never rewrites an unapproved candidate.');
    lines.push("");
  }
  const notes = report.files.filter((file) => file.note);
  if (notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const file of notes)
      lines.push(`- \`${file.display}\`: ${file.note}`);
    lines.push("");
  }
  const errors = report.files.filter((file) => file.error);
  if (errors.length > 0) {
    lines.push("## Files that could not be cleaned");
    lines.push("");
    for (const file of errors)
      lines.push(`- \`${file.display}\`: ${file.error}`);
    lines.push("");
  }
  const noSummary = report.files.filter((file) => !file.summary && !file.error);
  if (noSummary.length > 0) {
    lines.push("## No cleanup summary");
    lines.push("");
    lines.push("These files got no cleanup summary from the binary, which happens when it predates `--strip`. Nothing was rewritten.");
    for (const file of noSummary)
      lines.push(`- \`${file.display}\``);
    lines.push("");
  }
  if (removed === 0 && kept === 0 && errors.length === 0 && noSummary.length === 0) {
    lines.push("No cleanup candidates. Nothing to clean up.");
  }
  appendSkipped(lines, report.skipped);
  return lines.join(`
`);
}
function appendSkipped(lines, skipped) {
  if (skipped.length === 0)
    return;
  lines.push("");
  lines.push("## Skipped");
  lines.push("");
  for (const entry of skipped)
    lines.push(`- ${entry}`);
}
function escapeCell2(value) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
}
async function runCleanup(options, deps = {}) {
  return renderCleanup(await collectCleanup(options, deps));
}

// src/bin.ts
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=");
      if (inline !== undefined)
        flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        flags[key] = argv[i + 1];
        i += 1;
      } else
        flags[key] = true;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}
function validateConfigCommand(path) {
  let raw;
  try {
    raw = path ? readFileSync6(path, "utf8") : readFileSync6(0, "utf8");
  } catch (err) {
    process.stderr.write(`cannot read config: ${err instanceof Error ? err.message : String(err)}
`);
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`config is not valid JSON: ${err instanceof Error ? err.message : String(err)}
`);
    return 2;
  }
  const result = validateTupleOptions(parsed);
  if (result.valid) {
    process.stdout.write(`config is valid
`);
    return 0;
  }
  process.stderr.write(`config has ${result.errors.length} error(s):
`);
  for (const error of result.errors)
    process.stderr.write(`  - ${error}
`);
  return 1;
}
async function auditCommand(parsed) {
  const scope = parsed.flags.scope ?? "both";
  if (scope !== "comments" && scope !== "tests" && scope !== "both") {
    process.stderr.write(`--scope must be comments, tests or both
`);
    return 2;
  }
  const paths = typeof parsed.flags.paths === "string" ? parsed.flags.paths.split(",").map((p) => p.trim()).filter(Boolean) : undefined;
  const format = parsed.flags.json ? "json" : "markdown";
  const output = await runAudit({
    scope,
    paths,
    format,
    includeAdvisory: Boolean(parsed.flags["include-advisory"]),
    directory: process.cwd(),
    getConfig: () => ({
      enabled: true,
      testPatterns: [],
      testCommand: detectTestCommand(process.cwd()),
      checks: {},
      maxWarningsPerFile: 0
    })
  });
  process.stdout.write(`${output}
`);
  return 0;
}
async function cleanupCommand() {
  const output = await runCleanup({ directory: process.cwd(), testPatterns: [] });
  process.stdout.write(`${output}
`);
  return 0;
}
async function checkCommand(parsed) {
  const base = typeof parsed.flags.base === "string" ? parsed.flags.base : "HEAD";
  const scope = parsed.flags.scope ?? "tests";
  if (scope !== "tests" && scope !== "comments" && scope !== "both") {
    process.stderr.write(`--scope must be tests, comments or both
`);
    return 2;
  }
  const format = parsed.flags.json ? "json" : "markdown";
  const includeAdvisory = Boolean(parsed.flags["include-advisory"]);
  const parts = [];
  let failed = false;
  if (scope === "tests" || scope === "both") {
    const result = runDiffCheck({ directory: process.cwd(), base, includeAdvisory, format });
    parts.push(result.output);
    if (result.findings.length > 0)
      failed = true;
  }
  if (scope === "comments" || scope === "both") {
    const result = await runCommentDiffCheck({ directory: process.cwd(), base, format });
    parts.push(result.output);
    if (result.count > 0)
      failed = true;
  }
  process.stdout.write(`${parts.join(`

`)}
`);
  return failed ? 1 : 0;
}
function usage() {
  process.stdout.write([
    "opencode-guard-plugin guard <command>",
    "",
    "  check [--diff] [--base <rev>] [--scope tests|comments|both] [--json] [--include-advisory]",
    "  validate-config [file]",
    "  audit [--scope comments|tests|both] [--paths a,b] [--json] [--include-advisory]",
    "  cleanup",
    ""
  ].join(`
`));
}
async function main(argv) {
  const [group, command, ...rest] = argv;
  if (group !== "guard") {
    usage();
    return group ? 2 : 0;
  }
  const parsed = parseArgs(rest);
  switch (command) {
    case "check":
      return checkCommand(parsed);
    case "validate-config":
      return validateConfigCommand(parsed.positionals[0]);
    case "audit":
      return auditCommand(parsed);
    case "cleanup":
      return cleanupCommand();
    default:
      usage();
      return command ? 2 : 0;
  }
}
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  process.stderr.write(`guard failed: ${err instanceof Error ? err.message : String(err)}
`);
  process.exitCode = 3;
});
