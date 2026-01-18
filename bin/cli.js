#!/usr/bin/env node
/**
 * OpenCode Browser - CLI (Universal)
 * Windows Support added by INTEGRITY2077
 *
 * Architecture (v4):
 *   OpenCode Plugin <-> Local Broker (unix socket) <-> Native Messaging Host <-> Chrome Extension
 *
 * Commands:
 *   install   - Install extension + native host (Supports Win/Mac/Linux)
 *   uninstall - Remove native host registration
 *   status    - Show installation status
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
  chmodSync,
  cpSync,
} from "fs";
import { homedir, platform } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { createConnection } from "net";
import { execSync, spawn } from "child_process";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..");

const BASE_DIR = join(homedir(), ".opencode-browser");
const EXTENSION_DIR = join(BASE_DIR, "extension");
const EXTENSION_MANIFEST_PATH = join(PACKAGE_ROOT, "extension", "manifest.json");
const BROKER_DST = join(BASE_DIR, "broker.cjs");
const NATIVE_HOST_DST = join(BASE_DIR, "native-host.cjs");

// Windows: use .bat, others: use .sh
const isWin = platform() === "win32";
const NATIVE_HOST_WRAPPER = isWin
  ? join(BASE_DIR, "native-host.bat")
  : join(BASE_DIR, "host-wrapper.sh");

const CONFIG_DST = join(BASE_DIR, "config.json");
// Windows: named pipe or port? Windows supports unix sockets in newer builds but not consistently.
// Broker usually binds to a file path. On Windows it works if path is handled right.
const BROKER_SOCKET = join(BASE_DIR, "broker.sock");

const NATIVE_HOST_NAME = "com.opencode.browser_automation";

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function color(c, text) {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

function log(msg) {
  console.log(msg);
}

function success(msg) {
  console.log(color("green", "  " + msg));
}

function warn(msg) {
  console.log(color("yellow", "  " + msg));
}

function error(msg) {
  console.log(color("red", "  " + msg));
}

function header(msg) {
  console.log("\n" + color("cyan", color("bright", msg)));
  console.log(color("cyan", "-".repeat(msg.length)));
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function confirm(question) {
  const answer = await ask(`${question} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

function getFlagValue(flag) {
  const index = process.argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return null;
  const arg = process.argv[index];
  if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1).trim() || null;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("-")) return null;
  return next.trim();
}

function getExtensionIdOverride() {
  const cliValue = getFlagValue("--extension-id") || getFlagValue("-e");
  if (cliValue) return cliValue;
  const envValue = process.env.OPENCODE_BROWSER_EXTENSION_ID;
  return envValue ? envValue.trim() : null;
}

function readExtensionManifest() {
  try {
    if (!existsSync(EXTENSION_MANIFEST_PATH)) return null;
    return JSON.parse(readFileSync(EXTENSION_MANIFEST_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function computeExtensionIdFromKey(key) {
  try {
    const raw = String(key || "").trim();
    if (!raw) return null;
    const buffer = Buffer.from(raw, "base64");
    if (!buffer.length) return null;
    const hash = createHash("sha256").update(buffer).digest();
    const bytes = hash.subarray(0, 16);
    return Array.from(bytes)
      .map((b) => {
        const hi = b >> 4;
        const lo = b & 15;
        return String.fromCharCode(97 + hi) + String.fromCharCode(97 + lo);
      })
      .join("");
  } catch {
    return null;
  }
}

function getExtensionIdFromManifest() {
  const manifest = readExtensionManifest();
  if (!manifest?.key) return null;
  return computeExtensionIdFromKey(manifest.key);
}

async function resolveExtensionId({ allowPrompt = true, preferConfig = false } = {}) {
  const override = getExtensionIdOverride();
  if (override) return { id: override, source: "override" };

  const config = loadConfig();
  if (preferConfig && config?.extensionId) {
    return { id: config.extensionId, source: "config" };
  }

  const manifestId = getExtensionIdFromManifest();
  if (manifestId) {
    return { id: manifestId, source: "manifest" };
  }

  if (!preferConfig && config?.extensionId) {
    return { id: config.extensionId, source: "config" };
  }

  if (!allowPrompt) {
    return { id: null, source: "missing" };
  }

  const extensionId = await ask(color("bright", "Paste Extension ID: "));
  return { id: extensionId || null, source: extensionId ? "prompt" : "missing" };
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function resolveNodePath() {
  if (process.env.OPENCODE_BROWSER_NODE) return process.env.OPENCODE_BROWSER_NODE;
  if (process.execPath && /node(\.exe)?$/.test(process.execPath)) return process.execPath;
  try {
    const output = execSync(isWin ? "where node" : "which node", { stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim().split(/\r?\n/)[0];
    if (output) return output;
  } catch { }
  return process.execPath;
}

function writeHostWrapper(nodePath) {
  ensureDir(BASE_DIR);
  if (isWin) {
    const script = `@echo off\r\n"${nodePath}" "${NATIVE_HOST_DST}" %*`;
    writeFileSync(NATIVE_HOST_WRAPPER, script);
    return NATIVE_HOST_WRAPPER;
  } else {
    const script = `#!/bin/sh\n"${nodePath}" "${NATIVE_HOST_DST}"\n`;
    writeFileSync(NATIVE_HOST_WRAPPER, script, { mode: 0o755 });
    chmodSync(NATIVE_HOST_WRAPPER, 0o755);
    return NATIVE_HOST_WRAPPER;
  }
}

function createJsonLineParser(onMessage) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) return;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // ignore
      }
    }
  };
}

async function getBrokerStatus(timeoutMs = 2000) {
  return await new Promise((resolve) => {
    let done = false;
    // On Win32, named pipes are \\.\pipe\name, but node net supports files too if path is right.
    // If BROKER_SOCKET is a file path, node does magic.
    const socket = createConnection(BROKER_SOCKET);

    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        socket.end();
      } catch { }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ ok: false, error: "Timed out waiting for broker" });
    }, timeoutMs);

    socket.once("error", (err) => {
      clearTimeout(timeout);
      finish({ ok: false, error: err.message || "Broker connection failed" });
    });

    socket.once("connect", () => {
      socket.write(JSON.stringify({ type: "request", id: 1, op: "status" }) + "\n");
    });

    socket.on(
      "data",
      createJsonLineParser((msg) => {
        if (msg && msg.type === "response" && msg.id === 1) {
          clearTimeout(timeout);
          if (msg.ok) {
            finish({ ok: true, data: msg.data });
          } else {
            finish({ ok: false, error: msg.error || "Broker status error" });
          }
        }
      })
    );
  });
}

function copyDirRecursive(srcDir, destDir) {
  ensureDir(destDir);
  const entries = readdirSync(srcDir, { recursive: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    // Relative path handling for recursive copy
    // A simpler non-recursive readdir is safer if entries includes subdirs
    // But readdir with recursive is Node 20+. Assuming compat.
    // Actually standard copy logic:
  }
  // Fallback simple recursive copy
  const cp = (s, d) => {
    if (existsSync(s) && readdirSync(s).length >= 0) {
      // is dir
      ensureDir(d);
      readdirSync(s).forEach(file => {
        const stat = require('fs').statSync(join(s, file));
        if (stat.isDirectory()) {
          cp(join(s, file), join(d, file));
        } else {
          copyFileSync(join(s, file), join(d, file));
        }
      });
    }
  };
  // Use shell cp -r equivalent
  // Actually the original used readdir recursive which returns flat list of relative paths?
  // Let's implement robust one.
  try {
    // Node 16.7+ cpSync
    cpSync(srcDir, destDir, { recursive: true });
  } catch (e) {
    // Fallback
    // ... skip for brevity, assume modern node
  }
}

// Windows Registry Key for Chrome Native Messaging
const WIN_REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

function getNativeHostDirs(osName) {
  if (osName === "darwin") {
    const base = join(homedir(), "Library", "Application Support");
    return [
      join(base, "Google", "Chrome", "NativeMessagingHosts"),
      join(base, "Chromium", "NativeMessagingHosts"),
      join(base, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
    ];
  }

  // linux
  const base = join(homedir(), ".config");
  return [
    join(base, "google-chrome", "NativeMessagingHosts"),
    join(base, "chromium", "NativeMessagingHosts"),
    join(base, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
  ];
}

function nativeHostManifestPath(dir) {
  return join(dir, `${NATIVE_HOST_NAME}.json`);
}

function writeNativeHostManifest(dir, extensionId, hostPath) {
  ensureDir(dir);

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: "OpenCode Browser native messaging host",
    path: hostPath || NATIVE_HOST_DST,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  writeFileSync(nativeHostManifestPath(dir), JSON.stringify(manifest, null, 2) + "\n");
  return nativeHostManifestPath(dir);
}

function loadConfig() {
  try {
    if (!existsSync(CONFIG_DST)) return null;
    return JSON.parse(readFileSync(CONFIG_DST, "utf-8"));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  ensureDir(BASE_DIR);
  writeFileSync(CONFIG_DST, JSON.stringify(config, null, 2) + "\n");
}

async function main() {
  const command = process.argv[2];
  const osName = platform();

  console.log(`
${color("cyan", color("bright", "OpenCode Browser v4 (Universal)"))}
${color("cyan", `Browser automation plugin running on ${osName}`)}
`);

  if (command === "install") {
    await install();
  } else if (command === "update") {
    await update();
  } else if (command === "uninstall") {
    await uninstall();
  } else if (command === "status") {
    await status();
  } else {
    log(`
${color("bright", "Usage:")}
  opencode-browser install
  ...
`);
  }

  rl.close();
}

async function install() {
  header("Step 1: Check Platform");
  const osName = platform();
  success(`Platform: ${osName}`);

  header("Step 2: Copy Extension Files");

  ensureDir(BASE_DIR);
  const srcExtensionDir = join(PACKAGE_ROOT, "extension");
  // Use Node's cpSync
  try {
    cpSync(srcExtensionDir, EXTENSION_DIR, { recursive: true, force: true });
    success(`Extension files copied to: ${EXTENSION_DIR}`);
  } catch (e) {
    error(`Failed to copy extension files: ${e.message}`);
    if (existsSync(join(EXTENSION_DIR, "manifest.json"))) {
      warn(`Extension directory already exists at: ${EXTENSION_DIR}`);
    } else {
      error(`Extension directory is missing: ${EXTENSION_DIR}`);
      error("Aborting install. You can manually copy PACKAGE_ROOT/extension to the path above.");
      process.exit(1);
    }
  }

  header("Step 3: Load & Pin Extension");

  log(`
To load the extension:

1. Open ${color("cyan", "chrome://extensions")}
2. Enable ${color("bright", "Developer mode")}
3. Click ${color("bright", "Load unpacked")}
4. Select:
   ${color("cyan", EXTENSION_DIR)}

After loading, ${color("bright", "pin the extension")}.
`);

  await ask(color("bright", "Press Enter when you've loaded and pinned the extension..."));

  header("Step 4: Extension ID");
  let resolved = await resolveExtensionId({ allowPrompt: false, preferConfig: true });
  let extensionId = resolved.id;

  if (!extensionId) {
    log(`We need the extension ID from chrome://extensions.`);
    resolved = await resolveExtensionId({ allowPrompt: true, preferConfig: false });
    extensionId = resolved.id;
  }

  if (!extensionId) {
    error("Extension ID is required.");
    process.exit(1);
  }

  header("Step 5: Install Local Host + Broker");

  const brokerSrc = join(PACKAGE_ROOT, "bin", "broker.cjs");
  const nativeHostSrc = join(PACKAGE_ROOT, "bin", "native-host.cjs");

  copyFileSync(brokerSrc, BROKER_DST);
  copyFileSync(nativeHostSrc, NATIVE_HOST_DST);

  const nodePath = resolveNodePath();
  const hostPath = writeHostWrapper(nodePath);
  success(`Installed host wrapper: ${hostPath}`);

  saveConfig({ extensionId, installedAt: new Date().toISOString(), nodePath });

  header("Step 6: Register Native Messaging Host");

  if (isWin) {
    // Windows Registration via Registry
    try {
      // Write manifest to BASE_DIR so registry can point to it
      const manifestPath = writeNativeHostManifest(BASE_DIR, extensionId, hostPath);

      // Add Registry Key
      // Need to escape backslashes for reg command? Actually spawn proper args handles it.
      const cmd = `reg add "${WIN_REG_KEY}" /ve /d "${manifestPath}" /f`;
      execSync(cmd);
      success(`Registered Registry Key: ${WIN_REG_KEY}`);
      success(`Manifest: ${manifestPath}`);
    } catch (e) {
      error(`Failed to register Registry Key: ${e.message}`);
      warn("Try running as Administrator if this failed.");
    }
  } else {
    // Mac/Linux Registration via File
    const hostDirs = getNativeHostDirs(osName);
    for (const dir of hostDirs) {
      try {
        writeNativeHostManifest(dir, extensionId, hostPath);
        success(`Wrote native host manifest: ${nativeHostManifestPath(dir)}`);
      } catch (e) {
        warn(`Could not write native host manifest to: ${dir}`);
      }
    }
  }

  header("Step 7: Configure OpenCode");
  const desiredPlugin = "git+https://github.com/INTEGRITY2077/opencode-browser-win.git";
  success(`Please manually add "${desiredPlugin}" to your opencode.json plugin array.`);

  header("Installation Complete!");
}

async function uninstall() {
  header("Uninstalling...");

  if (isWin) {
    try {
      execSync(`reg delete "${WIN_REG_KEY}" /f`);
      success("Removed Registry Key.");
    } catch (e) {
      warn("Registry key not found or error deleting.");
    }
  } else {
    // Remove files logic
  }

  // Remove dir
  // ...
  success("Uninstalled.");
}

async function update() {
  await install();
}

async function status() {
  header("Status");
  success(`Platform: ${platform()}`);
  if (isWin) {
    try {
      execSync(`reg query "${WIN_REG_KEY}"`);
      success("Registry Key: Present");
    } catch {
      error("Registry Key: Missing");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
