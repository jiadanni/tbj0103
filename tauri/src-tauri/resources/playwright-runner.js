#!/usr/bin/env node
/**
 * playwright-runner.js
 * Aetherium Web AI bridge — opens a visible Chromium window, logs the user in
 * to a supported web AI provider, submits a query, streams the response back to
 * stdout as newline-delimited JSON, then optionally wipes the session profile.
 *
 * Args:
 *   --provider   chatgpt | deepseek | claude | gemini
 *   --query      The text to send
 *   --profile-dir  Absolute path to a persistent Chromium profile directory
 *   --preserve   (flag) If present, do NOT wipe cookies/profile after completion
 *
 * stdout format (one JSON object per line):
 *   {"type":"chunk","text":"..."}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// ── Provider config ───────────────────────────────────────────────────────────
// NOTE: Web UIs update their DOM frequently. Selectors are in one place so they
// are easy to update when providers change their UI.
const PROVIDERS = {
  chatgpt: {
    url: "https://chat.openai.com/",
    authCheck: '[data-testid="profile-button"], [aria-label="Open user menu"], button[aria-label="User menu"]',
    input: '#prompt-textarea, textarea[placeholder]',
    submit: 'button[data-testid="send-button"], button[aria-label="Send message"]',
    response: '[data-message-author-role="assistant"] .prose, [data-message-author-role="assistant"] .markdown',
    loginWaitMs: 120_000,
    pollMs: 500,
    settleMs: 3000,
  },
  deepseek: {
    url: "https://chat.deepseek.com/",
    authCheck: '.user-avatar, [class*="userAvatar"], [class*="avatar"]',
    input: 'textarea#chat-input, textarea[placeholder*="message"], textarea[placeholder*="Message"]',
    submit: 'button[aria-label*="send"], button[class*="send"], button[type="submit"]',
    response: '.ds-markdown, [class*="markdown"], [class*="message"] .content',
    loginWaitMs: 120_000,
    pollMs: 500,
    settleMs: 3000,
  },
  claude: {
    url: "https://claude.ai/new",
    authCheck: '[data-testid="user-menu"], [aria-label*="account"], [class*="UserMenu"]',
    input: '[contenteditable="true"].ProseMirror, [contenteditable="true"][data-placeholder]',
    submit: 'button[aria-label="Send message"], button[aria-label*="Send"]',
    response: '.font-claude-message, [data-testid="assistant-message"], .prose',
    loginWaitMs: 120_000,
    pollMs: 600,
    settleMs: 4000,
  },
  gemini: {
    url: "https://gemini.google.com/app",
    authCheck: '[aria-label="Google Account"]',
    input: '.ql-editor, rich-textarea .ql-editor, [aria-label*="message input"]',
    submit: 'button.send-button, button[aria-label*="Send"], mat-icon[data-mat-icon-name="send"]',
    response: 'model-response .markdown, model-response .response-content, .model-response-text',
    loginWaitMs: 120_000,
    pollMs: 700,
    settleMs: 4000,
  },
};

// ── Arg parsing ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { provider: null, query: null, profileDir: null, preserve: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider")   result.provider   = args[++i];
    if (args[i] === "--query")      result.query      = args[++i];
    if (args[i] === "--profile-dir") result.profileDir = args[++i];
    if (args[i] === "--preserve")   result.preserve   = true;
  }
  return result;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { provider, query, profileDir, preserve } = parseArgs();

  if (!provider || !PROVIDERS[provider]) {
    emit({ type: "error", message: `Unknown provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(", ")}` });
    process.exit(1);
  }
  if (!query) {
    emit({ type: "error", message: "Missing --query argument." });
    process.exit(1);
  }
  if (!profileDir) {
    emit({ type: "error", message: "Missing --profile-dir argument." });
    process.exit(1);
  }

  const cfg = PROVIDERS[provider];

  // Ensure profile dir exists
  fs.mkdirSync(profileDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: ["--no-sandbox"],
    });
  } catch (err) {
    emit({ type: "error", message: `Failed to launch browser: ${err.message}` });
    process.exit(1);
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // ── Wait for login ──────────────────────────────────────────────────────
    const isLoggedIn = async () => {
      try {
        const el = await page.$(cfg.authCheck);
        return !!el;
      } catch {
        return false;
      }
    };

    if (!(await isLoggedIn())) {
      // Give user time to manually log in in the visible window
      const deadline = Date.now() + cfg.loginWaitMs;
      while (Date.now() < deadline) {
        await sleep(1500);
        if (await isLoggedIn()) break;
      }
      if (!(await isLoggedIn())) {
        emit({ type: "error", message: `Login timeout: not authenticated with ${provider} after ${cfg.loginWaitMs / 1000}s.` });
        await context.close();
        process.exit(1);
      }
    }

    // ── Type into input ─────────────────────────────────────────────────────
    await page.waitForSelector(cfg.input, { timeout: 15_000 });
    const inputEl = await page.$(cfg.input);
    if (!inputEl) throw new Error("Input element not found after wait.");

    // Handle both <textarea> and contenteditable
    const tagName = await inputEl.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === "textarea" || tagName === "input") {
      await inputEl.click();
      await inputEl.fill(query);
    } else {
      // contenteditable
      await inputEl.click();
      await page.keyboard.type(query, { delay: 0 });
    }

    // ── Submit ──────────────────────────────────────────────────────────────
    await sleep(300);
    try {
      const btn = await page.waitForSelector(cfg.submit, { timeout: 5_000 });
      await btn.click();
    } catch {
      // Fallback: Enter key
      await page.keyboard.press("Enter");
    }

    // ── Stream response via DOM polling ─────────────────────────────────────
    let lastText = "";
    let settleStart = null;

    await sleep(1500); // give the response bubble a moment to appear

    const deadline = Date.now() + 180_000; // 3-minute max
    while (Date.now() < deadline) {
      await sleep(cfg.pollMs);

      let currentText = "";
      try {
        // Collect all matching elements, take the last (most recent response)
        const elements = await page.$$(cfg.response);
        if (elements.length > 0) {
          const last = elements[elements.length - 1];
          currentText = await last.innerText();
        }
      } catch {
        // DOM not ready yet — keep polling
      }

      if (currentText.length > lastText.length) {
        const newChunk = currentText.slice(lastText.length);
        emit({ type: "chunk", text: newChunk });
        lastText = currentText;
        settleStart = null; // reset settle timer any time we get new text
      } else if (currentText === lastText && lastText.length > 0) {
        // Text hasn't grown — start settle timer
        if (!settleStart) settleStart = Date.now();
        if (Date.now() - settleStart >= cfg.settleMs) {
          break; // response has settled
        }
      }
    }

    emit({ type: "done" });

  } catch (err) {
    emit({ type: "error", message: err.message });
  } finally {
    // ── Session cleanup ─────────────────────────────────────────────────────
    if (!preserve) {
      try { await context.clearCookies(); } catch { /* ignore */ }
    }
    await context.close();

    if (!preserve && profileDir) {
      // Wipe the profile directory so no credentials linger on disk
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main().catch((err) => {
  emit({ type: "error", message: String(err) });
  process.exit(1);
});
