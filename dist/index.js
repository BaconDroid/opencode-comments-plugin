// @bun
// src/constants.ts
var COMMENT_CHECKER_EVENT = "PostToolUse";
var APPLY_PATCH_TOOL_NAME = "apply_patch";
var DEFAULT_TRIGGER_TOOLS = ["write", "edit", "apply_patch"];
var DEFAULT_CLI_TIMEOUT_MS = 5000;

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
var DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1";
function debugLog(...args) {
  if (!DEBUG)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:downloader] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  process.stderr.write(msg);
}
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
function getBinaryName() {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
}
function getCachedBinaryPath(version) {
  if (!version)
    return null;
  const binaryPath = join(getCacheDir(), version, getBinaryName());
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
  const binaryName = getBinaryName();
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

// src/core/runner.ts
var {spawn: spawn2 } = globalThis.Bun;
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
var DEBUG2 = process.env.COMMENT_CHECKER_DEBUG === "1";
function debugLog2(...args) {
  if (!DEBUG2)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  process.stderr.write(msg);
}
function getBinaryName2() {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
}
function findCommentCheckerPathSync() {
  const binaryName = getBinaryName2();
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

// src/core/config.ts
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
  if (normalized === "off" || normalized === "warn" || normalized === "block")
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

// src/core/dispatch.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
import { join as join3 } from "path";

// src/core/budget.ts
class GuardBudget {
  dedupWindowMs;
  ttlMs;
  maxWarningsPerFile;
  seen = new Map;
  perFile = new Map;
  constructor(options = {}) {
    this.dedupWindowMs = options.dedupWindowMs ?? 30000;
    this.ttlMs = options.ttlMs ?? 60000;
    this.maxWarningsPerFile = options.maxWarningsPerFile ?? 0;
  }
  setMaxWarningsPerFile(value) {
    this.maxWarningsPerFile = value;
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
    this.seen.set(key, now);
    return true;
  }
  record(sessionID, filePath) {
    if (this.maxWarningsPerFile <= 0)
      return;
    const key = this.fileKey(sessionID, filePath);
    const existing = this.perFile.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      this.perFile.set(key, { count: 1, lastSeen: Date.now() });
    }
  }
}

// src/core/diff.ts
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
function readString(record, ...keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string")
      return value;
  }
  return;
}
function firstString(record, ...keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0)
      return value;
  }
  return;
}
function extractToolChange(tool, args, preimage) {
  const filePath = firstString(args, "filePath", "file_path", "path");
  if (!filePath)
    return;
  const toolLower = tool.toLowerCase();
  if (toolLower === "write" || toolLower === "create") {
    const content = readString(args, "content", "file_text", "text") ?? "";
    return extractChange({
      filePath,
      oldText: preimage ?? "",
      newText: content,
      isNew: preimage === undefined,
      isDelete: false
    });
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
      return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false });
    }
    const oldText = readString(args, "oldString", "old_string") ?? "";
    const newText = readString(args, "newString", "new_string") ?? "";
    return extractChange({ filePath, oldText, newText, isNew: false, isDelete: false });
  }
  return;
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
function appendFeedback(output, message) {
  if (message.length === 0)
    return;
  if (output.output.includes(TEST_GUARD_MARKER))
    return;
  output.output += `

${TEST_GUARD_MARKER}
${message}`;
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
var DEFAULT_TEST_PATTERNS = [
  "**/*.test.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.spec.*"
];
function isTestPath(filePath, patterns) {
  return matchesAnyGlob(patterns.length > 0 ? patterns : DEFAULT_TEST_PATTERNS, filePath);
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
var HELPER_DECLARATION_PATTERNS = [
  /^\s*def\s+(?!test_)\w+\s*\(/,
  /^\s*(?:async\s+)?function\s+\w+\s*\(/,
  /^\s*const\s+\w+\s*=\s*(?:async\s*)?\(/,
  /parametrize/i,
  /@pytest\.fixture/
];
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

// src/rules/tests/content.ts
var ALLOW_MARKER = /test-guard:\s*allow\b/i;
var DISABLE_FILE_MARKER = /test-guard-disable-file\b/i;
var BYPASS_WINDOW = 2;
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
function withinBypass(newText, line) {
  if (line <= 0)
    return false;
  const lines = newText.split(`
`);
  const from = Math.max(0, line - 1 - BYPASS_WINDOW);
  const to = Math.min(lines.length, line + BYPASS_WINDOW);
  for (let i = from;i < to; i++) {
    if (ALLOW_MARKER.test(lines[i] ?? ""))
      return true;
  }
  return false;
}
function isFileDisabled(change) {
  return DISABLE_FILE_MARKER.test(change.newText);
}
function collectBypasses(change) {
  const bypasses = [];
  const lines = change.newText.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const allow = line.match(/test-guard:\s*allow\s*(.*)$/i);
    if (allow)
      bypasses.push({ kind: "allow", line: i + 1, reason: allow[1].trim() });
    if (DISABLE_FILE_MARKER.test(line))
      bypasses.push({ kind: "disable-file", line: i + 1, reason: "" });
  }
  return bypasses;
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
    if (withinBypass(ctx.change.newText, lineNumber))
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
      if (withinBypass(ctx.change.newText, lineNumber))
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
var netAssertionLossRule = {
  id: "net-assertion-loss",
  run(ctx) {
    if (ctx.change.removedLines.length === 0)
      return [];
    const removed = uniqueAssertions(ctx.change.removedLines, ctx.change.language).length;
    const added = uniqueAssertions(ctx.change.addedLines, ctx.change.language).length;
    const threshold = ctx.config.netAssertionLossThreshold ?? 2;
    if (removed - added < threshold)
      return [];
    const learned = ctx.change.addedLines.some((line) => HELPER_DECLARATION_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language))));
    if (learned)
      return [];
    const declarations = TEST_DECLARATION_PATTERNS[ctx.change.language];
    if (declarations) {
      const before = ctx.change.removedLines.filter((line) => declarations.test(codeText(line, ctx.change.language))).length;
      const after = ctx.change.addedLines.filter((line) => declarations.test(codeText(line, ctx.change.language))).length;
      if (before !== after)
        return [];
    }
    const sample = ctx.change.removedLines.find((line) => ASSERTION_COUNT_PATTERNS.some((p) => p.test(codeText(line, ctx.change.language)))) ?? "";
    const lineNumber = locateLine(ctx.change.oldText, sample);
    return [{
      rule: "net-assertion-loss",
      line: lineNumber,
      message: `Net assertion loss of ${removed - added} without added helper or parametrization.`,
      excerpt: sample.trim()
    }];
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
      if (withinBypass(ctx.change.newText, lineNumber))
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
        if (!withinBypass(ctx.change.newText, lineNumber)) {
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
  netAssertionLossRule,
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
function runTestRules(ctx) {
  if (!ctx.isTestFile)
    return { findings: [], bypassed: false, bypasses: [] };
  if (isFileDisabled(ctx.change)) {
    return { findings: [], bypassed: true, bypasses: collectBypasses(ctx.change) };
  }
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
  return { findings, bypassed: false, bypasses: collectBypasses(ctx.change) };
}

// src/core/dispatch.ts
var DEBUG3 = process.env.TEST_GUARD_DEBUG === "1" || process.env.COMMENT_CHECKER_DEBUG === "1";
function debugLog3(...args) {
  if (!DEBUG3)
    return;
  const msg = `[${new Date().toISOString()}] [test-guard] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  process.stderr.write(msg);
}
var DEFAULT_TEST_GUARD = {
  enabled: true,
  testPatterns: [],
  checks: {},
  maxWarningsPerFile: 0,
  netAssertionLossThreshold: 2
};
var PATCH_ENTRY = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/gm;
function extractPatchEntries(patchText) {
  const entries = [];
  let match;
  const regex = new RegExp(PATCH_ENTRY.source, "gm");
  while ((match = regex.exec(patchText)) !== null) {
    entries.push({ kind: match[1], path: match[2] });
  }
  return entries;
}
function createTestGuard(getResolved) {
  const budget = new GuardBudget;
  const pending = new Map;
  function resolve() {
    try {
      return getResolved();
    } catch {
      return DEFAULT_TEST_GUARD;
    }
  }
  function isBlocking() {
    return (resolve().checks["protected-paths"] ?? "warn") === "block";
  }
  function isProtectedPath(filePath, patterns) {
    return isTestPath(filePath, patterns);
  }
  function pathExists(filePath) {
    try {
      return existsSync3(filePath) || existsSync3(join3(process.cwd(), filePath));
    } catch {
      return false;
    }
  }
  function permission(input, output) {
    try {
      const resolved = resolve();
      if (!resolved.enabled)
        return;
      if (!isBlocking())
        return;
      if (input.type !== "edit" && input.type !== "write")
        return;
      const patterns = resolved.testPatterns;
      const candidates = Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : [];
      for (const candidate of candidates) {
        if (!isProtectedPath(candidate, patterns))
          continue;
        if (!pathExists(candidate))
          continue;
        output.status = "deny";
        debugLog3("permission denied for protected test path", candidate);
        return;
      }
    } catch (err) {
      debugLog3("permission failed (fail-open):", err);
    }
  }
  function before(input, output) {
    try {
      const resolved = resolve();
      if (!resolved.enabled)
        return;
      const toolLower = input.tool.toLowerCase();
      const args = output.args ?? {};
      const patterns = resolved.testPatterns.length > 0 ? resolved.testPatterns : [];
      if (isBlocking()) {
        if (toolLower === APPLY_PATCH_TOOL_NAME) {
          const patchText = firstString(args, "patchText", "patch", "patch_text") ?? "";
          for (const entry of extractPatchEntries(patchText)) {
            if (entry.kind !== "Delete" && entry.kind !== "Update")
              continue;
            if (!isProtectedPath(entry.path, patterns))
              continue;
            if (entry.kind === "Delete") {
              throw new Error(`[test-guard] protected-paths is set to block: refusing to delete test file ${entry.path}. Set "checks": { "protected-paths": "warn" } or add a bypass.`);
            }
          }
        } else {
          const filePath = firstString(args, "filePath", "file_path", "path");
          if (filePath && isProtectedPath(filePath, patterns) && existsSync3(filePath)) {
            throw new Error(`[test-guard] protected-paths is set to block: refusing to edit existing test file ${filePath}. Set "checks": { "protected-paths": "warn" } or add a bypass.`);
          }
        }
      }
      let preimage;
      const filePath = firstString(args, "filePath", "file_path", "path");
      if (toolLower !== APPLY_PATCH_TOOL_NAME && filePath && typeof args.content === "string") {
        try {
          if (existsSync3(filePath))
            preimage = readFileSync2(filePath, "utf8");
        } catch {}
      }
      pending.set(input.callID, { args, preimage });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[test-guard]"))
        throw err;
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
      if (toolLower === APPLY_PATCH_TOOL_NAME) {
        if (output.output.toLowerCase().startsWith("error"))
          return;
        changes = extractPatchChanges(output.metadata);
      } else {
        const call = pending.get(input.callID);
        pending.delete(input.callID);
        if (!call)
          return;
        if (output.output.toLowerCase().startsWith("error"))
          return;
        const change = extractToolChange(toolLower, call.args, call.preimage);
        if (change)
          changes.push(change);
      }
      if (changes.length === 0)
        return;
      budget.setMaxWarningsPerFile(resolved.maxWarningsPerFile);
      const findings = [];
      const bypassNotes = [];
      for (const change of changes) {
        const isTestFile = isProtectedPath(change.filePath, resolved.testPatterns);
        const ctx = {
          change,
          isTestFile,
          config: { ...resolved, testPatterns: resolved.testPatterns, testCommand: resolved.testCommand ?? null }
        };
        const result = runTestRules(ctx);
        for (const bypass of result.bypasses) {
          debugLog3("bypass", change.filePath, bypass);
          bypassNotes.push(`${change.filePath}:${bypass.line} ${bypass.kind}${bypass.reason ? ` (${bypass.reason})` : ""}`);
        }
        const grouped = new Map;
        for (const finding of result.findings) {
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
          budget.record(input.sessionID, change.filePath);
          for (const finding of ruleFindings) {
            findings.push({
              rule: finding.rule,
              filePath: change.filePath,
              line: finding.line,
              message: finding.message,
              severity: level,
              excerpt: finding.excerpt
            });
          }
        }
      }
      let message = findings.length > 0 ? renderFeedback(findings, { customPrompt: resolved.customPrompt, appendPrompt: resolved.appendPrompt }) : "";
      if (findings.some((finding) => finding.severity === "block")) {
        message = `BLOCK BYPASSED \u2014 a rule configured as "block" reached the after hook; the change was not stopped.

${message}`;
      }
      if (bypassNotes.length > 0) {
        const footer = `Test guard bypass recorded:
${bypassNotes.map((note) => `- ${note}`).join(`
`)}`;
        message = message.length > 0 ? `${message}

${footer}` : footer;
      }
      if (message.length === 0)
        return;
      appendFeedback(output, message);
    } catch (err) {
      debugLog3("after failed (fail-open):", err);
    }
  }
  return { before, after, permission };
}

// src/rules/comments/index.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
var DEBUG4 = process.env.COMMENT_CHECKER_DEBUG === "1";
function debugLog4(...args) {
  if (!DEBUG4)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  process.stderr.write(msg);
}
var PENDING_CALL_TTL = 60000;
function createCommentGuard(getConfig) {
  const pendingCalls = new Map;
  const warningCounts = new Map;
  function cleanupStaleState() {
    const now = Date.now();
    for (const [callID, call] of pendingCalls) {
      if (now - call.timestamp > PENDING_CALL_TTL)
        pendingCalls.delete(callID);
    }
    for (const [sessionID, session] of warningCounts) {
      if (now - session.lastSeen > PENDING_CALL_TTL)
        warningCounts.delete(sessionID);
    }
  }
  const interval = setInterval(cleanupStaleState, 1e4);
  interval.unref?.();
  function canWarn(sessionID, filePath) {
    const { maxWarningsPerFile } = getConfig();
    if (maxWarningsPerFile <= 0)
      return true;
    const session = warningCounts.get(sessionID);
    if (!session)
      return true;
    return (session.files.get(filePath) ?? 0) < maxWarningsPerFile;
  }
  function recordWarning(sessionID, filePath) {
    const { maxWarningsPerFile } = getConfig();
    if (maxWarningsPerFile <= 0)
      return;
    let session = warningCounts.get(sessionID);
    if (!session) {
      session = { lastSeen: Date.now(), files: new Map };
      warningCounts.set(sessionID, session);
    }
    session.files.set(filePath, (session.files.get(filePath) ?? 0) + 1);
  }
  function touchSession(sessionID) {
    const session = warningCounts.get(sessionID);
    if (session)
      session.lastSeen = Date.now();
  }
  function hasNewCommentLines(preimage, content, filePath) {
    const language = detectLanguage(filePath);
    const { added } = diffLines(preimage, content);
    return added.some((line) => isCommentLine(line, language));
  }
  async function reportComments(sessionID, toolName, toolInput, output) {
    try {
      const { customPrompt, appendPrompt, timeoutMs } = getConfig();
      const filePath = toolInput.file_path ?? "";
      if (!canWarn(sessionID, filePath)) {
        debugLog4("warning budget spent for", filePath);
        return;
      }
      const cliPath = await getCommentCheckerPath();
      if (!cliPath || !existsSync4(cliPath)) {
        debugLog4("CLI not available, skipping comment check");
        return;
      }
      const hookInput = {
        session_id: sessionID,
        tool_name: toolName,
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: COMMENT_CHECKER_EVENT,
        tool_input: toolInput
      };
      const result = await runCommentChecker(hookInput, { prompt: customPrompt, timeoutMs });
      if (result.hasComments && result.message) {
        recordWarning(sessionID, filePath);
        const message = appendPrompt ? `${result.message}

${appendPrompt}` : result.message;
        output.output += `

${message}`;
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
    for (const file of toPatchEntries(output.metadata)) {
      if (file.type === "delete")
        continue;
      const filePath = file.movePath ?? file.filePath;
      const sides = file.patch ? splitPatch(file.patch) : undefined;
      if (!filePath || !sides || sides.newText.length === 0) {
        debugLog4("no file path or no added lines in patch entry for apply_patch");
        continue;
      }
      await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
        file_path: filePath,
        old_string: sides.oldText,
        new_string: sides.newText
      }, output);
    }
  }
  async function before(input, output) {
    const { triggerTools } = getConfig();
    const toolLower = input.tool.toLowerCase();
    if (toolLower === APPLY_PATCH_TOOL_NAME || !triggerTools.has(toolLower)) {
      return;
    }
    const filePath = output.args.filePath ?? output.args.file_path ?? output.args.path;
    const content = output.args.content;
    const oldString = output.args.oldString ?? output.args.old_string;
    const newString = output.args.newString ?? output.args.new_string;
    const edits = output.args.edits;
    if (!filePath) {
      debugLog4("no filePath found for tool:", toolLower);
      return;
    }
    let preimage;
    if (typeof content === "string") {
      try {
        if (existsSync4(filePath))
          preimage = readFileSync3(filePath, "utf8");
      } catch (err) {
        debugLog4("could not read preimage:", err);
      }
    }
    pendingCalls.set(input.callID, {
      filePath,
      content,
      oldString,
      newString,
      edits,
      tool: toolLower,
      sessionID: input.sessionID,
      timestamp: Date.now(),
      preimage
    });
  }
  async function after(input, output) {
    const { triggerTools } = getConfig();
    if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
      if (!triggerTools.has(APPLY_PATCH_TOOL_NAME))
        return;
      touchSession(input.sessionID);
      await checkApplyPatch(input.sessionID, output);
      return;
    }
    const pendingCall = pendingCalls.get(input.callID);
    if (!pendingCall)
      return;
    pendingCalls.delete(input.callID);
    touchSession(input.sessionID);
    const isToolFailure = output.output.toLowerCase().startsWith("error");
    if (isToolFailure) {
      debugLog4("skipping due to tool failure in output");
      return;
    }
    if (pendingCall.tool === "write" && pendingCall.preimage !== undefined && typeof pendingCall.content === "string" && !hasNewCommentLines(pendingCall.preimage, pendingCall.content, pendingCall.filePath)) {
      debugLog4("no new comment lines in write; skipping");
      return;
    }
    await reportComments(pendingCall.sessionID, pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1), {
      file_path: pendingCall.filePath,
      content: pendingCall.content,
      old_string: pendingCall.oldString,
      new_string: pendingCall.newString,
      edits: pendingCall.edits
    }, output);
  }
  return { before, after };
}

// src/core/test-command.ts
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "fs";
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
function readIfExists(filePath) {
  try {
    return existsSync5(filePath) ? readFileSync4(filePath, "utf8") : undefined;
  } catch {
    return;
  }
}
function detectTestCommand(directory) {
  const packageJson = readIfExists(join4(directory, "package.json"));
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
    const content = readIfExists(join4(directory, candidate.file));
    if (content === undefined)
      continue;
    if (candidate.contains && !content.includes(candidate.contains))
      continue;
    return candidate.command;
  }
  return null;
}

// src/audit.ts
import { tool } from "@opencode-ai/plugin";
import { readFileSync as readFileSync5, readdirSync as readdirSync2, statSync } from "fs";
import { isAbsolute, join as join5, relative } from "path";
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
      const abs = isAbsolute(entry) ? entry : join5(directory, entry);
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
  "net-assertion-loss": "adjust",
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
  const checks = {};
  for (const rule of ALL_TEST_RULES) {
    const advisory = rule.id === "over-mocking" || rule.id === "assertion-roulette" || rule.id === "weakened-config" || rule.id === "redundant-assertion" || rule.id === "tests-not-run";
    checks[rule.id] = advisory && !includeAdvisory ? "off" : "warn";
  }
  const ctx = {
    change,
    isTestFile: true,
    config: { enabled: true, testPatterns: [], testCommand: null, checks, maxWarningsPerFile: 0 }
  };
  const result = runTestRules(ctx);
  const findings = [];
  for (const finding of result.findings) {
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
    return readFileSync5(filePath, "utf8");
  } catch {
    return;
  }
}
async function defaultRunCheck(filePath, content) {
  const cliPath = await getCommentCheckerPath();
  if (!cliPath)
    return [];
  const result = await runCommentChecker({
    session_id: "guard-audit",
    tool_name: "Write",
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: COMMENT_CHECKER_EVENT,
    tool_input: { file_path: filePath, content }
  });
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
  return relative(process.cwd(), filePath) || filePath;
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
  return tool({
    description: "Read-only audit of existing comments and tests. Produces a cleanup plan (markdown or json) that the agent applies afterwards. Never modifies files.",
    args: {
      scope: tool.schema.enum(["comments", "tests", "both"]).optional(),
      paths: tool.schema.array(tool.schema.string()).optional(),
      format: tool.schema.enum(["markdown", "json"]).optional(),
      include_advisory: tool.schema.boolean().optional()
    },
    async execute(args) {
      return runAudit({
        scope: args.scope ?? "both",
        paths: args.paths,
        format: args.format,
        includeAdvisory: args.include_advisory,
        directory: options.directory,
        getConfig: options.getConfig
      }, options.deps);
    }
  });
}
var GUARD_AUDIT_COMMAND = {
  template: "Use the guard_audit tool to audit the current repository's existing comments and tests, then apply the cleanup plan it returns. Report what you changed.",
  description: "Audit existing comments and tests and produce a cleanup plan"
};

// src/index.ts
var DEFAULT_TEST_CHECKS = {
  "protected-paths": "warn",
  "skip-focus-added": "warn",
  "tautological-assertion": "warn",
  "empty-test": "warn",
  "unknown-test": "warn",
  "net-assertion-loss": "warn",
  "gutted-test": "warn",
  "matcher-loosened": "warn",
  "swallowed-error": "warn",
  "duplicate-test": "warn",
  "over-mocking": "off",
  "assertion-roulette": "off",
  "weakened-config": "off",
  "redundant-assertion": "off",
  "tests-not-run": "off"
};
var pluginOptions;
var projectDirectory = process.cwd();
var resolvedCommentConfig = {
  maxWarningsPerFile: 0,
  triggerTools: new Set(DEFAULT_TRIGGER_TOOLS),
  timeoutMs: DEFAULT_CLI_TIMEOUT_MS
};
function resolveConfiguration(config) {
  const options = optionContainer(pluginOptions, "comment_checker");
  const fromConfig = optionContainer(config, "comment_checker");
  const inputs = { options, config: fromConfig };
  resolvedCommentConfig.customPrompt = resolveOption(asString, "COMMENT_CHECKER_CUSTOM_PROMPT", "custom_prompt", inputs);
  resolvedCommentConfig.appendPrompt = resolveOption(asString, "COMMENT_CHECKER_APPEND_PROMPT", "append_prompt", inputs);
  resolvedCommentConfig.maxWarningsPerFile = resolveOption((value) => asCount(value, 1), "COMMENT_CHECKER_MAX_WARNINGS_PER_FILE", "max_warnings_per_file", inputs) ?? 0;
  const tools = resolveOption(asTools, "COMMENT_CHECKER_TOOLS", "tools", inputs);
  resolvedCommentConfig.triggerTools = new Set(tools ?? DEFAULT_TRIGGER_TOOLS);
  resolvedCommentConfig.timeoutMs = resolveOption((value) => asCount(value, 1), "COMMENT_CHECKER_TIMEOUT_MS", "timeout_ms", inputs) ?? DEFAULT_CLI_TIMEOUT_MS;
}
var resolvedTestGuard = {
  enabled: true,
  testPatterns: [...DEFAULT_TEST_PATTERNS],
  testCommand: null,
  checks: { ...DEFAULT_TEST_CHECKS },
  maxWarningsPerFile: 0,
  netAssertionLossThreshold: 2
};
function resolveTestGuardConfiguration(config) {
  const options = optionContainer(pluginOptions, "test_guard");
  const fromConfig = optionContainer(config, "test_guard");
  resolvedTestGuard.enabled = resolveOption((value) => value === undefined ? undefined : asBoolean(value, true), "TEST_GUARD_ENABLED", "enabled", { options, config: fromConfig }) ?? true;
  resolvedTestGuard.testPatterns = resolveOption(asPatterns, "TEST_GUARD_TEST_PATTERNS", "test_patterns", { options, config: fromConfig }) ?? [...DEFAULT_TEST_PATTERNS];
  resolvedTestGuard.maxWarningsPerFile = resolveOption((value) => asCount(value, 1), "TEST_GUARD_MAX_WARNINGS_PER_FILE", "max_warnings_per_file", {
    options,
    config: fromConfig
  }) ?? 0;
  resolvedTestGuard.customPrompt = resolveOption(asString, "TEST_GUARD_CUSTOM_PROMPT", "custom_prompt", { options, config: fromConfig });
  resolvedTestGuard.appendPrompt = resolveOption(asString, "TEST_GUARD_APPEND_PROMPT", "append_prompt", { options, config: fromConfig });
  resolvedTestGuard.testCommand = resolveOption(asString, "TEST_GUARD_TEST_COMMAND", "test_command", { options, config: fromConfig }) ?? detectTestCommand(projectDirectory);
  resolvedTestGuard.netAssertionLossThreshold = resolveOption((value) => asCount(value, 1), "TEST_GUARD_NET_ASSERTION_LOSS_THRESHOLD", "net_assertion_loss_threshold", { options, config: fromConfig }) ?? 2;
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
  const commentGuard = createCommentGuard(() => resolvedCommentConfig);
  const testGuard = createTestGuard(() => resolvedTestGuard);
  const auditTool = createGuardAuditTool({ directory: projectDirectory, getConfig: () => resolvedTestGuard });
  return {
    config: async (config) => {
      resolveConfiguration(config);
      resolveTestGuardConfiguration(config);
      registerAuditCommand(config);
    },
    tool: {
      guard_audit: auditTool
    },
    "permission.ask": async (input, output) => {
      testGuard.permission(input, output);
    },
    "tool.execute.before": async (input, output) => {
      testGuard.before(input, output);
      await commentGuard.before(input, output);
    },
    "tool.execute.after": async (input, output) => {
      await commentGuard.after(input, output);
      await testGuard.after(input, output);
    }
  };
};
var src_default = CommentCheckerPlugin;
export {
  CommentCheckerPlugin,
  src_default as default
};
