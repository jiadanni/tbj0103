const PATCH_FLAG = "__aetheriumConsoleTimestampPatched__";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

export function installConsoleTimestamps(): void {
  /* eslint-disable no-console */
  const consoleWithFlag = console as Console & { [PATCH_FLAG]?: boolean };
  if (consoleWithFlag[PATCH_FLAG]) {
    return;
  }

  const methods: ConsoleMethod[] = ["debug", "error", "info", "log", "warn"];

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      original(`[${new Date().toISOString()}]`, ...args);
    }) as Console[ConsoleMethod];
  }

  consoleWithFlag[PATCH_FLAG] = true;
  /* eslint-enable no-console */
}
