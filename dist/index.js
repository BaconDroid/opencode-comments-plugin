// @bun
// src/index.ts
import { existsSync as existsSync3 } from "fs";
import { appendFileSync as appendFileSync3 } from "fs";
import { join as join3 } from "path";
import { tmpdir as tmpdir3 } from "os";

// src/constants.ts
var COMMENT_CHECKER_EVENT = "PostToolUse";
var TOOL_NAMES = new Set(["write", "edit", "multiedit"]);

// src/cli.ts
var {spawn: spawn2 } = globalThis.Bun;
import { createRequire as createRequire2 } from "module";
import { dirname, join as join2 } from "path";
import { existsSync as existsSync2 } from "fs";
import { appendFileSync as appendFileSync2 } from "fs";
import { tmpdir as tmpdir2 } from "os";

// src/downloader.ts
var {spawn } = globalThis.Bun;
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { createRequire } from "module";
var DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1";
var DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log");
function debugLog(...args) {
  if (!DEBUG)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:downloader] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  appendFileSync(DEBUG_FILE, msg);
}
var REPO = "code-yeongyu/go-claude-code-comment-checker";
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
function cleanupStaleCache(version) {
  let entries;
  try {
    entries = readdirSync(getCacheDir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === version)
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
async function downloadCommentChecker() {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformInfo = PLATFORM_MAP[platformKey];
  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey);
    return null;
  }
  const version = getCommentCheckerVersion();
  if (!version) {
    debugLog("Cannot resolve @code-yeongyu/comment-checker version; refusing to download a stale binary");
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
async function ensureCommentCheckerBinary() {
  const version = getCommentCheckerVersion();
  if (!version)
    return null;
  const cachedPath = getCachedBinaryPath(version);
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath);
    cleanupStaleCache(version);
    return cachedPath;
  }
  return downloadCommentChecker();
}

// src/cli.ts
var DEBUG2 = process.env.COMMENT_CHECKER_DEBUG === "1";
var DEBUG_FILE2 = join2(tmpdir2(), "comment-checker-debug.log");
function debugLog2(...args) {
  if (!DEBUG2)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  appendFileSync2(DEBUG_FILE2, msg);
}
function getBinaryName2() {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
}
function findCommentCheckerPathSync() {
  const binaryName = getBinaryName2();
  const version = getCommentCheckerVersion();
  if (!version) {
    debugLog2("cannot resolve comment-checker version; comment checking disabled");
    return null;
  }
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
    const syncPath = findCommentCheckerPathSync();
    if (syncPath && existsSync2(syncPath)) {
      resolvedCliPath = syncPath;
      debugLog2("using sync-resolved path:", syncPath);
      return syncPath;
    }
    debugLog2("triggering lazy download...");
    const downloadedPath = await ensureCommentCheckerBinary();
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
    const TIMEOUT_MS = 5000;
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
var DEBUG_FILE3 = join3(tmpdir3(), "comment-checker-debug.log");
function debugLog3(...args) {
  if (!DEBUG3)
    return;
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}
`;
  appendFileSync3(DEBUG_FILE3, msg);
}
var pendingCalls = new Map;
var PENDING_CALL_TTL = 60000;
var customPrompt;
function cleanupOldPendingCalls() {
  const now = Date.now();
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID);
    }
  }
}
function resolveCustomPrompt(config) {
  const raw = config.comment_checker;
  if (!raw || typeof raw !== "object")
    return;
  const prompt = raw.custom_prompt;
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined;
}
setInterval(cleanupOldPendingCalls, 1e4).unref();
var CommentCheckerPlugin = async () => {
  startBackgroundInit();
  return {
    config: async (config) => {
      customPrompt = resolveCustomPrompt(config);
    },
    "tool.execute.before": async (input, output) => {
      const toolLower = input.tool.toLowerCase();
      if (!TOOL_NAMES.has(toolLower)) {
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
      const pendingCall = pendingCalls.get(input.callID);
      if (!pendingCall) {
        return;
      }
      pendingCalls.delete(input.callID);
      const isToolFailure = output.output.toLowerCase().startsWith("error");
      if (isToolFailure) {
        debugLog3("skipping due to tool failure in output");
        return;
      }
      try {
        const cliPath = await getCommentCheckerPath();
        if (!cliPath || !existsSync3(cliPath)) {
          debugLog3("CLI not available, skipping comment check");
          return;
        }
        const hookInput = {
          session_id: pendingCall.sessionID,
          tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1),
          transcript_path: "",
          cwd: process.cwd(),
          hook_event_name: COMMENT_CHECKER_EVENT,
          tool_input: {
            file_path: pendingCall.filePath,
            content: pendingCall.content,
            old_string: pendingCall.oldString,
            new_string: pendingCall.newString,
            edits: pendingCall.edits
          }
        };
        const result = await runCommentChecker(hookInput, { prompt: customPrompt });
        if (result.hasComments && result.message) {
          output.output += `

${result.message}`;
        }
      } catch (err) {
        debugLog3("tool.execute.after failed:", err);
      }
    }
  };
};
var src_default = CommentCheckerPlugin;
export {
  CommentCheckerPlugin,
  src_default as default
};
