// @bun
// src/index.ts
import { existsSync as existsSync3 } from "fs";

// src/constants.ts
var COMMENT_CHECKER_EVENT = "PostToolUse";
var APPLY_PATCH_TOOL_NAME = "apply_patch";
var DEFAULT_TRIGGER_TOOLS = ["write", "edit", "apply_patch"];
var DEFAULT_CLI_TIMEOUT_MS = 5000;

// src/cli.ts
var {spawn: spawn2 } = globalThis.Bun;
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
  try {
    const args = [binaryPath];
    if (options.prompt && options.prompt.trim().length > 0) {
      args.push("--prompt", options.prompt);
    }
    const proc = spawn2(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(jsonInput);
    proc.stdin.end();
    const TIMEOUT_MS = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_CLI_TIMEOUT_MS;
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        debugLog2("comment-checker timed out; killing");
        try {
          proc.kill();
        } catch {
          debugLog2("comment-checker already exited");
        }
        proc.stdout.cancel().catch(() => {});
        proc.stderr.cancel().catch(() => {});
        resolve("timeout");
      }, TIMEOUT_MS);
      (async () => {
        try {
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode });
        } catch (err) {
          debugLog2("comment-checker stream failed:", err);
          clearTimeout(timer);
          resolve("timeout");
        }
      })();
    });
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
  } catch (err) {
    debugLog2("failed to run comment-checker:", err);
    return { hasComments: false, message: "" };
  }
}

// src/index.ts
var DEBUG3 = process.env.COMMENT_CHECKER_DEBUG === "1";
function debugLog3(...args) {
  if (!DEBUG3)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  process.stderr.write(msg);
}
var pendingCalls = new Map;
var PENDING_CALL_TTL = 60000;
var warningCounts = new Map;
var pluginOptions;
var customPrompt;
var appendPrompt;
var maxWarningsPerFile = 0;
var triggerTools = new Set(DEFAULT_TRIGGER_TOOLS);
var cliTimeoutMs = DEFAULT_CLI_TIMEOUT_MS;
function cleanupStaleState() {
  const now = Date.now();
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID);
    }
  }
  for (const [sessionID, session] of warningCounts) {
    if (now - session.lastSeen > PENDING_CALL_TTL) {
      warningCounts.delete(sessionID);
    }
  }
}
function optionContainer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  const object = value;
  const nested = object.comment_checker;
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
function resolveConfiguration(config) {
  const fromOptions = optionContainer(pluginOptions);
  const fromConfig = optionContainer(config);
  customPrompt = asString(process.env.COMMENT_CHECKER_CUSTOM_PROMPT) ?? asString(fromOptions?.custom_prompt) ?? asString(fromConfig?.custom_prompt);
  appendPrompt = asString(process.env.COMMENT_CHECKER_APPEND_PROMPT) ?? asString(fromOptions?.append_prompt) ?? asString(fromConfig?.append_prompt);
  maxWarningsPerFile = asCount(process.env.COMMENT_CHECKER_MAX_WARNINGS_PER_FILE, 1) ?? asCount(fromOptions?.max_warnings_per_file, 1) ?? asCount(fromConfig?.max_warnings_per_file, 1) ?? 0;
  const tools = asTools(process.env.COMMENT_CHECKER_TOOLS) ?? asTools(fromOptions?.tools) ?? asTools(fromConfig?.tools);
  triggerTools = new Set(tools ?? DEFAULT_TRIGGER_TOOLS);
  cliTimeoutMs = asCount(process.env.COMMENT_CHECKER_TIMEOUT_MS, 1) ?? asCount(fromOptions?.timeout_ms, 1) ?? asCount(fromConfig?.timeout_ms, 1) ?? DEFAULT_CLI_TIMEOUT_MS;
}
setInterval(cleanupStaleState, 1e4).unref();
function canWarn(sessionID, filePath) {
  if (maxWarningsPerFile <= 0)
    return true;
  const session = warningCounts.get(sessionID);
  if (!session)
    return true;
  return (session.files.get(filePath) ?? 0) < maxWarningsPerFile;
}
function recordWarning(sessionID, filePath) {
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
  if (session) {
    session.lastSeen = Date.now();
  }
}
async function reportComments(sessionID, toolName, toolInput, output) {
  try {
    const filePath = toolInput.file_path ?? "";
    if (!canWarn(sessionID, filePath)) {
      debugLog3("warning budget spent for", filePath);
      return;
    }
    const cliPath = await getCommentCheckerPath();
    if (!cliPath || !existsSync3(cliPath)) {
      debugLog3("CLI not available, skipping comment check");
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
    const result = await runCommentChecker(hookInput, { prompt: customPrompt, timeoutMs: cliTimeoutMs });
    if (result.hasComments && result.message) {
      recordWarning(sessionID, filePath);
      const message = appendPrompt ? `${result.message}

${appendPrompt}` : result.message;
      output.output += `

${message}`;
    }
  } catch (err) {
    debugLog3("comment check failed:", err);
  }
}
function toPatchFiles(metadata) {
  const files = metadata?.files;
  if (!Array.isArray(files))
    return [];
  const changes = [];
  for (const file of files) {
    if (!file || typeof file !== "object")
      continue;
    const entry = file;
    changes.push({
      type: typeof entry.type === "string" ? entry.type : undefined,
      filePath: typeof entry.filePath === "string" ? entry.filePath : undefined,
      movePath: typeof entry.movePath === "string" ? entry.movePath : undefined,
      patch: typeof entry.patch === "string" ? entry.patch : undefined
    });
  }
  return changes;
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
  if (added.length === 0)
    return;
  return { oldString: removed.join(`
`), newString: added.join(`
`) };
}
async function checkApplyPatch(sessionID, output) {
  if (output.output.toLowerCase().startsWith("error")) {
    debugLog3("skipping due to tool failure in output");
    return;
  }
  for (const file of toPatchFiles(output.metadata)) {
    if (file.type === "delete")
      continue;
    const filePath = file.movePath ?? file.filePath;
    const sides = file.patch ? splitPatch(file.patch) : undefined;
    if (!filePath || !sides) {
      debugLog3("no file path or no added lines in patch entry for apply_patch");
      continue;
    }
    await reportComments(sessionID, APPLY_PATCH_TOOL_NAME, {
      file_path: filePath,
      old_string: sides.oldString,
      new_string: sides.newString
    }, output);
  }
}
var CommentCheckerPlugin = async (_input, options) => {
  pluginOptions = options;
  resolveConfiguration();
  startBackgroundInit();
  return {
    config: async (config) => {
      resolveConfiguration(config);
    },
    "tool.execute.before": async (input, output) => {
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
        debugLog3("no filePath found for tool:", toolLower);
        return;
      }
      pendingCalls.set(input.callID, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower,
        sessionID: input.sessionID,
        timestamp: Date.now()
      });
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool.toLowerCase() === APPLY_PATCH_TOOL_NAME) {
        if (!triggerTools.has(APPLY_PATCH_TOOL_NAME)) {
          return;
        }
        touchSession(input.sessionID);
        await checkApplyPatch(input.sessionID, output);
        return;
      }
      const pendingCall = pendingCalls.get(input.callID);
      if (!pendingCall) {
        return;
      }
      pendingCalls.delete(input.callID);
      touchSession(input.sessionID);
      const isToolFailure = output.output.toLowerCase().startsWith("error");
      if (isToolFailure) {
        debugLog3("skipping due to tool failure in output");
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
  };
};
var src_default = CommentCheckerPlugin;
export {
  CommentCheckerPlugin,
  src_default as default
};
