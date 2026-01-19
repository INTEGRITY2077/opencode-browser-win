# OpenCode Browser (Windows Support Fork)

Browser automation plugin for [OpenCode](https://opencode.ai).

> **Note:** This is a fork of [@different-ai/opencode-browser](https://github.com/different-ai/opencode-browser) modified to support **Windows (win32)** natively alongside macOS and Linux.

Control your real Chromium browser (Chrome/Brave/Arc/Edge) using your existing profile (logins, cookies, bookmarks). No DevTools Protocol, no security prompts.

## Architecture (Windows)

This version includes specific optimizations for Windows:
- **Registry Automation:** Automatically registers the Chrome Native Messaging Host using `reg.exe`.
- **Batch Wrapper:** Uses `.bat` wrappers instead of `.sh` scripts.
- **Universal Installer:** Detects OS (Win/Mac/Linux) and applies the correct installation method automatically.

## Prerequisites

- **Node.js**: v18 or higher (This plugin is pure JavaScript.).
- **Browser**: Google Chrome, Brave, Edge, or Arc.
- **OpenCode CLI**: The main agent to run this plugin.

## Installation

### 1. Install via NPM

Since this is a custom fork, install directly from GitHub:

```powershell
npm install -g git+https://github.com/INTEGRITY2077/opencode-browser-win.git
```

### 2. Run Setup

Run the following command in your terminal (PowerShell or CMD):

```powershell
opencode-browser install
```
**Important:** Since this plugin is private/unpublished, you must manually install the dependency in your OpenCode config directory as instructed by the installer:
```powershell
cd $env:USERPROFILE\.config\opencode
npm install git+https://github.com/INTEGRITY2077/opencode-browser-win.git
```
Then add `"@integrity2077/opencode-browser-win"` to your `opencode.json`.
The installer will:
1.  Copy extension files to `%USERPROFILE%\.opencode-browser\extension\`
2.  Walk you through loading + pinning the extension in `chrome://extensions`
3.  **Automatically register** the Native Messaging Host in the Windows Registry (`HKCU\Software\Google\Chrome\NativeMessagingHosts`)
4.  Update your OpenCode config (`~/.config/opencode/opencode.json`) to include the plugin (key: `"plugin"` array)

### 3. Load Chrome Extension

1.  Open `chrome://extensions`
2.  Enable **Developer mode** (top right)
3.  Click **Load unpacked**
4.  Select the folder: `%USERPROFILE%\.opencode-browser\extension`
5.  **Copy the Extension ID** and paste it into the terminal if prompt (or restart install if needed).

---

## Usage

Restart OpenCode and try:

```powershell
opencode run "browser_navigate('https://google.com')"
```

## Uninstall

To remove the registry keys and files:

```powershell
opencode-browser uninstall
```

This will cleanly remove:
- The Registry Key (`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opencode.browser_automation`)
- The installation directory (`~/.opencode-browser`)

---

## Privacy & Security

- **Local Execution:** Use standard `os.homedir()` paths. No hardcoded personal paths.
- **Source Code:** Transparently modified to add Windows `bat/reg` support.
- **Original Logic:** All core browser logic remains identical to the original upstream project.
