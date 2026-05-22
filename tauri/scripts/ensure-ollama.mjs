#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const command = process.argv.slice(2);

async function isOllamaAvailable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllama(baseUrl) {
  if (await isOllamaAvailable(baseUrl)) {
    console.log(`[ensure-ollama] Ollama already reachable at ${baseUrl}`);
    return;
  }

  console.log(`[ensure-ollama] Starting Ollama at ${baseUrl}...`);

  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } catch (error) {
    console.warn(`[ensure-ollama] Unable to launch Ollama automatically: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(500);
    if (await isOllamaAvailable(baseUrl)) {
      console.log("[ensure-ollama] Ollama is ready");
      return;
    }
  }

  console.warn(`[ensure-ollama] Ollama did not become reachable at ${baseUrl} within 6 seconds. Continuing anyway.`);
}

async function main() {
  await ensureOllama(DEFAULT_OLLAMA_URL);

  if (command.length === 0) {
    return;
  }

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, GTK_USE_PORTAL: "1" },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[ensure-ollama] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
