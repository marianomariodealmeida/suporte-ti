import { config } from "../src/config.mjs";
import { createLogger } from "../src/logger.mjs";
import { connect } from "../src/whatsapp.mjs";

const logger = createLogger(config.logDir, config.logLevel);

async function main() {
  logger.info("Conectando ao WhatsApp para listar grupos…");
  const connection = await connect({
    config,
    logger,
    shouldAccept: () => true,
    onMessage: async () => {},
  });

  const socket = await connection.opened;
  const groups = await socket.groupFetchAllParticipating();

  const rows = Object.entries(groups)
    .map(([jid, meta]) => ({
      jid,
      name: meta.subject || "(sem nome)",
      size: meta.size || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  console.log("\n============================================================");
  console.log("Grupos encontrados");
  console.log("============================================================\n");
  if (!rows.length) {
    console.log("Nenhum grupo encontrado nesta conta.");
  } else {
    for (const row of rows) {
      console.log(`${row.name}`);
      console.log(`  jid: ${row.jid}`);
      console.log(`  participantes: ${row.size}\n`);
    }
  }
  console.log("============================================================");
  console.log("Copie o JID desejado para WHATSAPP_GROUP_IDS no connector/.env");
  console.log("(separe vários por vírgula) ou cole em Configurações no dashboard.");
  console.log("============================================================\n");

  connection.stop();
  process.exit(0);
}

main().catch((error) => {
  logger.error("Falha ao listar grupos:", error);
  process.exit(1);
});
