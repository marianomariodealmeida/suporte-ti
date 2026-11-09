import fs from "node:fs";
import path from "node:path";

export function createLogger(logDir, level = "info") {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "connector.log");
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const minimum = levels[level] ?? levels.info;
  let lastRotationCheck = 0;

  function rotateIfNeeded() {
    const now = Date.now();
    if (now - lastRotationCheck < 60_000) return;
    lastRotationCheck = now;
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > 5 * 1024 * 1024) {
        const backup = path.join(logDir, "connector.log.1");
        try {
          fs.rmSync(backup, { force: true });
        } catch {}
        fs.renameSync(logFile, backup);
      }
    } catch {}
  }

  function write(tag, args) {
    const message = args
      .map((item) => {
        if (item instanceof Error) return item.stack || item.message;
        if (typeof item === "object") {
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        }
        return String(item);
      })
      .join(" ");
    const line = `${new Date().toISOString()} ${tag} ${message}`;
    if (tag === "ERROR") console.error(line);
    else if (tag === "WARN") console.warn(line);
    else console.log(line);
    try {
      rotateIfNeeded();
      fs.appendFileSync(logFile, line + "\n");
    } catch {}
  }

  return {
    debug: (...args) => {
      if (minimum <= levels.debug) write("DEBUG", args);
    },
    info: (...args) => {
      if (minimum <= levels.info) write("INFO", args);
    },
    warn: (...args) => {
      if (minimum <= levels.warn) write("WARN", args);
    },
    error: (...args) => {
      if (minimum <= levels.error) write("ERROR", args);
    },
    file: logFile,
  };
}
