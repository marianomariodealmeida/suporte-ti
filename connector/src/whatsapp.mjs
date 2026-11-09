import fs from "node:fs";

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

import { normalize } from "./classifier.mjs";

const silentLogger = pino({ level: "silent" });

function unwrap(message) {
  if (!message) return {};
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function extractContent(rawMessage) {
  const message = unwrap(rawMessage);
  const media = [];
  let text = "";

  if (message.conversation) {
    text = message.conversation;
  } else if (message.extendedTextMessage?.text) {
    text = message.extendedTextMessage.text;
  } else if (message.imageMessage) {
    text = message.imageMessage.caption || "";
    media.push({
      type: "image",
      mimetype: message.imageMessage.mimetype || null,
      caption: message.imageMessage.caption || null,
    });
  } else if (message.videoMessage) {
    text = message.videoMessage.caption || "";
    media.push({
      type: "video",
      mimetype: message.videoMessage.mimetype || null,
      caption: message.videoMessage.caption || null,
      seconds: message.videoMessage.seconds || null,
    });
  } else if (message.documentMessage) {
    text = message.documentMessage.caption || "";
    media.push({
      type: "document",
      mimetype: message.documentMessage.mimetype || null,
      fileName: message.documentMessage.fileName || null,
    });
  } else if (message.audioMessage) {
    media.push({
      type: "audio",
      mimetype: message.audioMessage.mimetype || null,
      seconds: message.audioMessage.seconds || null,
    });
  } else if (message.stickerMessage) {
    media.push({ type: "sticker" });
  } else if (message.locationMessage) {
    text = "[localização enviada]";
    media.push({ type: "location" });
  } else if (message.contactMessage || message.contactsArrayMessage) {
    text = "[contato enviado]";
    media.push({ type: "contact" });
  } else if (message.buttonsResponseMessage) {
    text = message.buttonsResponseMessage.selectedDisplayText || "";
  } else if (message.listResponseMessage) {
    text = message.listResponseMessage.title || "";
  } else if (message.reactionMessage) {
    // reações não viram chamado
  }

  return { text: String(text || "").trim(), media };
}

/**
 * Conecta ao WhatsApp e entrega mensagens de grupo já normalizadas.
 *
 * onMessage recebe:
 * { groupId, groupName, waMessageId, senderId, senderPhone, senderName,
 *   text, media, timestamp }
 */
export async function connect({ config, logger, onMessage, shouldAccept }) {
  fs.mkdirSync(config.sessionDir, { recursive: true });

  let socket = null;
  let stopped = false;
  let reconnectTimer = null;
  const groupCache = new Map();
  let openResolve;
  const opened = new Promise((resolve) => {
    openResolve = resolve;
  });

  function acceptsGroup(groupId, subject) {
    if (config.monitorAllGroups) return true;
    if (config.groupIds.includes("*") || config.groupIds.includes(groupId)) return true;
    if (config.groupMatch.length) {
      const name = normalize(subject || "");
      return config.groupMatch.some((match) => name.includes(normalize(match)));
    }
    return false;
  }

  async function groupSubject(sock, groupId) {
    if (groupCache.has(groupId)) return groupCache.get(groupId);
    try {
      const metadata = await sock.groupMetadata(groupId);
      const subject = metadata?.subject || groupId;
      groupCache.set(groupId, subject);
      return subject;
    } catch (error) {
      logger.warn(`Não consegui obter o nome do grupo ${groupId}:`, error.message);
      return groupId;
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      create().catch((error) => {
        logger.error("Falha ao reconectar:", error);
        scheduleReconnect();
      });
    }, 4000);
  }

  async function create() {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined;
    }

    socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      logger: silentLogger,
      browser: ["Suporte TI", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info("Escaneie o QR Code abaixo com o WhatsApp (Aparelhos conectados):");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        logger.info("WhatsApp conectado.");
        openResolve?.(socket);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        logger.warn(`Conexão encerrada (código ${statusCode ?? "?"}).`);
        if (loggedOut) {
          logger.error(
            "Sessão desconectada pelo WhatsApp. Apague a pasta de sessão e escaneie o QR novamente.",
          );
        } else {
          scheduleReconnect();
        }
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const raw of messages) {
        try {
          await handleRawMessage(raw);
        } catch (error) {
          logger.error("Erro ao processar mensagem:", error);
        }
      }
    });

    async function handleRawMessage(raw) {
      const groupId = raw.key?.remoteJid;
      if (!groupId || !groupId.endsWith("@g.us")) return;
      if (raw.key?.fromMe) return;
      if (!raw.message) return;

      const subject = await groupSubject(socket, groupId);
      const allowed = shouldAccept
        ? shouldAccept(groupId, subject)
        : acceptsGroup(groupId, subject);
      if (!allowed) return;

      const participant = raw.key.participant || raw.key.participantAlt;
      const senderId = participant ? jidNormalizedUser(participant) : groupId;
      const senderPhone = senderId.split("@")[0];
      const senderName = raw.pushName || senderPhone;
      const content = extractContent(raw.message);

      if (!content.text && !content.media.length) return;

      const timestamp =
        Number(raw.messageTimestamp) > 0 ? Number(raw.messageTimestamp) * 1000 : Date.now();

      await onMessage({
        groupId,
        groupName: subject,
        waMessageId: raw.key.id || `${groupId}:${timestamp}`,
        senderId,
        senderPhone,
        senderName,
        text: content.text,
        media: content.media,
        timestamp,
      });
    }
  }

  await create();

  return {
    get socket() {
      return socket;
    },
    opened,
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        socket?.end?.(undefined);
      } catch {}
    },
  };
}
