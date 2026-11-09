import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(file);
      return;
    }
  } catch {
    // cai no parser manual
  }
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const list = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const bool = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  root,
  supabaseUrl: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  groupIds: list(process.env.WHATSAPP_GROUP_IDS),
  groupMatch: list(process.env.WHATSAPP_GROUP_MATCH).map((item) => item.toLowerCase()),
  monitorAllGroups: bool(process.env.MONITOR_ALL_GROUPS),
  sessionDir: path.resolve(
    root,
    process.env.WHATSAPP_SESSION_DIR || path.join("data", "auth"),
  ),
  logDir: path.resolve(root, process.env.LOG_DIR || "logs"),
  mergeWindowMinutes: Math.max(0, number(process.env.MERGE_WINDOW_MINUTES, 15)),
  slaHours: Math.max(1, number(process.env.SLA_HOURS, 24)),
  minMessageLength: Math.max(0, number(process.env.MIN_MESSAGE_LENGTH, 6)),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  ai: {
    enabled: bool(process.env.AI_ENABLED),
    baseUrl: String(process.env.AI_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: String(process.env.AI_API_KEY || "").trim(),
    model: String(process.env.AI_MODEL || "").trim(),
  },
};

export function validateConfig() {
  const errors = [];
  if (!config.supabaseUrl || config.supabaseUrl.includes("SEU-PROJETO")) {
    errors.push("SUPABASE_URL não configurada no connector/.env");
  }
  if (!config.serviceKey) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY não configurada no connector/.env");
  }
  if (!config.monitorAllGroups && !config.groupIds.length && !config.groupMatch.length) {
    errors.push(
      "Nenhum grupo configurado. Use WHATSAPP_GROUP_IDS, WHATSAPP_GROUP_MATCH ou MONITOR_ALL_GROUPS=true",
    );
  }
  if (config.ai.enabled) {
    if (!config.ai.baseUrl) errors.push("AI_ENABLED=true exige AI_BASE_URL");
    if (!config.ai.model) errors.push("AI_ENABLED=true exige AI_MODEL");
  }
  return errors;
}
