import { config, validateConfig } from "../src/config.mjs";
import { createLogger } from "../src/logger.mjs";
import { SupabaseRest } from "../src/supabase.mjs";

const logger = createLogger(config.logDir, config.logLevel);

async function main() {
  const errors = validateConfig().filter(
    (error) => !error.includes("grupo") && !error.includes("WHATSAPP_GROUP"),
  );
  if (errors.length) {
    for (const error of errors) logger.error(error);
    process.exitCode = 1;
    return;
  }

  const supabase = new SupabaseRest({
    url: config.supabaseUrl,
    key: config.serviceKey,
    logger,
  });

  logger.info(`Testando Supabase em ${config.supabaseUrl}…`);

  const categories = await supabase.select("categories", "select=slug&order=sort_order.asc");
  logger.info(`Categorias: ${categories.map((item) => item.slug).join(", ")}`);

  const settings = await supabase.select("settings", "select=*&id=eq.1");
  logger.info(`Settings: ${JSON.stringify(settings?.[0] || {})}`);

  const tickets = await supabase.select("tickets", "select=id&limit=1");
  logger.info(`Tabela de chamados OK (${tickets.length} registro(s) na amostra).`);

  logger.info("Tudo certo com o Supabase. ✅");
}

main().catch((error) => {
  logger.error("Falha no selftest:", error.message);
  process.exitCode = 1;
});
