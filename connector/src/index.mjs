import { config, validateConfig } from "./config.mjs";
import { createLogger } from "./logger.mjs";
import { SupabaseRest, enc } from "./supabase.mjs";
import { createClassifier } from "./classifier.mjs";
import { connect } from "./whatsapp.mjs";

const logger = createLogger(config.logDir, config.logLevel);
const supabase = new SupabaseRest({
  url: config.supabaseUrl,
  key: config.serviceKey,
  logger,
});
const classifier = createClassifier({ supabase, config, logger });

const envAiEnabled = config.ai.enabled;

let runtime = {
  group_ids: [],
  auto_create: true,
  ai_enabled: envAiEnabled,
  sla_hours: config.slaHours,
  merge_window_minutes: config.mergeWindowMinutes,
};
let lastSettingsLoad = 0;

async function loadSettings(force = false) {
  if (!force && Date.now() - lastSettingsLoad < 60_000) return runtime;
  try {
    const rows = await supabase.select("settings", "select=*&id=eq.1");
    if (rows?.[0]) {
      runtime = { ...runtime, ...rows[0] };
      config.ai.enabled = envAiEnabled && runtime.ai_enabled !== false;
      logger.debug("Configurações recarregadas do Supabase.");
    }
    lastSettingsLoad = Date.now();
  } catch (error) {
    logger.warn("Não consegui carregar settings:", error.message);
  }
  return runtime;
}

function acceptsGroup(groupId, subject) {
  if (config.monitorAllGroups) return true;

  const ids = runtime.group_ids?.length ? runtime.group_ids : config.groupIds;
  if (ids.includes("*") || ids.includes(groupId)) return true;
  if (runtime.group_ids?.length) return false;

  if (config.groupMatch.length) {
    return config.groupMatch.some((match) => subject.toLowerCase().includes(match));
  }
  return false;
}

// ------------------------------------------------------------ pipeline
let queue = Promise.resolve();

function enqueue(message) {
  queue = queue
    .then(() => handleMessage(message))
    .catch((error) => logger.error("Falha no processamento da mensagem:", error));
  return queue;
}

async function handleMessage(message) {
  const preview = (message.text || "[anexo]").replace(/\s+/g, " ").slice(0, 80);

  // 1. registra a mensagem bruta (deduplicação por wa_message_id)
  const inserted = await supabase.insert(
    "raw_messages",
    [
      {
        group_id: message.groupId,
        group_name: message.groupName,
        wa_message_id: message.waMessageId,
        sender_id: message.senderId,
        sender_name: message.senderName,
        sender_phone: message.senderPhone,
        content: message.text || "[anexo]",
        media: message.media,
      },
    ],
    { onConflict: "wa_message_id" },
  );

  if (!Array.isArray(inserted) || !inserted.length) {
    logger.debug(`Mensagem duplicada ignorada: ${message.waMessageId}`);
    return;
  }
  const raw = inserted[0];

  await loadSettings();

  if (runtime.auto_create === false) {
    await supabase.update("raw_messages", `id=eq.${raw.id}`, {
      processed: true,
      error: "criação automática desligada",
    });
    logger.info(`Auto-criação desligada; mensagem registrada apenas: "${preview}"`);
    return;
  }

  if (classifier.isNoise(message.text, message.media)) {
    await supabase.update("raw_messages", `id=eq.${raw.id}`, {
      processed: true,
      error: "ignorada (saudação ou mensagem curta)",
    });
    logger.debug(`Ignorada (ruído): "${preview}"`);
    return;
  }

  // 2. tenta anexar a um chamado aberto recente do mesmo solicitante
  const windowStart = new Date(
    Date.now() - Math.max(0, Number(runtime.merge_window_minutes) || 0) * 60_000,
  ).toISOString();

  const existing = await supabase.select(
    "tickets",
    [
      "select=*",
      `group_id=eq.${enc(message.groupId)}`,
      `requester_id=eq.${enc(message.senderId)}`,
      "status=in.(pending,in_progress)",
      `updated_at=gte.${enc(windowStart)}`,
      "order=updated_at.desc",
      "limit=1",
    ].join("&"),
  );

  if (Array.isArray(existing) && existing.length) {
    const ticket = existing[0];
    const combined = `${ticket.content || ""}\n\n${message.text || "[anexo]"}`.slice(0, 8000);
    const patch = {
      content: combined,
      media: [...(ticket.media || []), ...(message.media || [])],
    };

    if (!ticket.category_id || ticket.category_slug === "outros") {
      const result = await classifier.classify(combined);
      patch.category_id = result.category?.id || null;
      patch.category_slug = result.category?.slug || "outros";
      patch.priority = result.priority;
      patch.ai_confidence = result.confidence;
      patch.ai_reason = result.reason;
    }

    await supabase.update("tickets", `id=eq.${ticket.id}`, patch);
    await supabase.insert("ticket_events", [
      {
        ticket_id: ticket.id,
        actor_name: message.senderName,
        type: "message",
        note: message.text || "[anexo]",
      },
    ]);
    await supabase.update("raw_messages", `id=eq.${raw.id}`, {
      ticket_id: ticket.id,
      processed: true,
    });

    logger.info(`Mensagem anexada ao chamado ${ticket.protocol}: "${preview}"`);
    return;
  }

  // 3. classifica e cria um novo chamado
  const result = await classifier.classify(message.text);
  const slaDue = new Date(
    Date.now() + (Number(runtime.sla_hours) || config.slaHours) * 3_600_000,
  ).toISOString();

  const tickets = await supabase.insert("tickets", [
    {
      group_id: message.groupId,
      group_name: message.groupName,
      wa_message_id: message.waMessageId,
      requester_id: message.senderId,
      requester_name: message.senderName,
      requester_phone: message.senderPhone,
      content: message.text || "[anexo]",
      summary: result.summary || message.text.slice(0, 150),
      category_id: result.category?.id || null,
      category_slug: result.category?.slug || "outros",
      priority: result.priority,
      status: "pending",
      ai_confidence: result.confidence,
      ai_reason: result.reason,
      source: "whatsapp",
      media: message.media,
      sla_due_at: slaDue,
    },
  ]);

  const ticket = tickets?.[0];
  if (!ticket) throw new Error("Supabase não retornou o chamado criado.");

  await supabase.insert("ticket_events", [
    {
      ticket_id: ticket.id,
      actor_name: message.senderName,
      type: "created",
      note: "Recebido pelo grupo de WhatsApp.",
    },
  ]);
  await supabase.update("raw_messages", `id=eq.${raw.id}`, {
    ticket_id: ticket.id,
    processed: true,
  });

  logger.info(
    `Chamado ${ticket.protocol} criado · ${result.category?.name || "Outros"} · ` +
      `${result.priority} · ${Math.round(result.confidence * 100)}% · "${preview}"`,
  );
}

// ------------------------------------------------------------ main
async function main() {
  const errors = validateConfig();
  if (errors.length) {
    for (const error of errors) logger.error(error);
    logger.error("Edite connector/.env. Use .env.example como base.");
    process.exitCode = 1;
    return;
  }

  logger.info("Conector de suporte de TI iniciando…");
  logger.info(`Supabase: ${config.supabaseUrl}`);

  try {
    await supabase.select("categories", "select=id&limit=1");
    logger.info("Conexão com o Supabase OK.");
  } catch (error) {
    logger.error("Não consegui falar com o Supabase:", error.message);
    logger.error("Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no connector/.env.");
    process.exitCode = 1;
    return;
  }

  await loadSettings(true);
  await classifier.refresh(true);

  if (config.monitorAllGroups) {
    logger.warn("MONITOR_ALL_GROUPS=true: todos os grupos serão processados.");
  } else if (runtime.group_ids?.length) {
    logger.info(`Grupos configurados no dashboard: ${runtime.group_ids.join(", ")}`);
  } else {
    logger.info(
      `Grupos no .env: ${config.groupIds.join(", ") || "(por nome)"} ${config.groupMatch.join(", ")}`,
    );
  }

  logger.info(
    `Regras: janela de agrupamento ${runtime.merge_window_minutes} min · SLA ${runtime.sla_hours} h · ` +
      `auto-create ${runtime.auto_create ? "on" : "off"} · IA ${config.ai.enabled ? "on" : "off"}`,
  );

  const connection = await connect({
    config,
    logger,
    shouldAccept: acceptsGroup,
    onMessage: (message) => enqueue(message),
  });

  const shutdown = async (signal) => {
    logger.info(`Recebido ${signal}; encerrando…`);
    connection.stop();
    try {
      await queue;
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => logger.error("Promise rejeitada:", error));

  if (config.ai.enabled) {
    logger.info(`IA: ${config.ai.model} em ${config.ai.baseUrl}`);
  }
}

main().catch((error) => {
  logger.error("Falha fatal:", error);
  process.exitCode = 1;
});
