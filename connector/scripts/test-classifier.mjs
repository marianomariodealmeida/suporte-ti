import { createClassifier } from "../src/classifier.mjs";

const categories = [
  {
    id: "1",
    slug: "rede",
    name: "Rede e Internet",
    keywords: ["rede", "internet", "wifi", "cabo", "vpn", "sem rede", "caiu a rede"],
  },
  {
    id: "2",
    slug: "impressora",
    name: "Impressoras",
    keywords: ["impressora", "imprimir", "toner", "papel", "atolado"],
  },
  {
    id: "3",
    slug: "acesso",
    name: "Acessos e Senhas",
    keywords: ["senha", "acesso", "login", "bloqueado", "desbloquear"],
  },
  {
    id: "4",
    slug: "email",
    name: "E-mail",
    keywords: ["email", "e-mail", "outlook", "spam", "anexo"],
  },
  {
    id: "5",
    slug: "hardware",
    name: "Computadores e Hardware",
    keywords: ["computador", "notebook", "monitor", "teclado", "mouse", "nao liga"],
  },
  {
    id: "6",
    slug: "outros",
    name: "Outros",
    keywords: [],
  },
];

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const supabase = { select: async () => categories };
const config = { minMessageLength: 6, ai: { enabled: false } };

const classifier = createClassifier({ supabase, config, logger: silent });

const samples = [
  "Bom dia",
  "Obrigado!",
  "👍",
  "A impressora do financeiro está atolada de novo",
  "URGENTE: ninguém está conseguindo acessar a internet na sala 3",
  "Esqueci minha senha do sistema, pode desbloquear?",
  "O Outlook não está recebendo e-mails com anexo",
  "Meu notebook não liga de jeito nenhum",
  "Quando puderem, queria uma melhoria no sistema de ponto",
  "Preciso instalar o Office no computador novo",
];

console.log("Teste do classificador (sem IA, somente regras)\n");
for (const text of samples) {
  const noise = classifier.isNoise(text, []);
  if (noise) {
    console.log(`IGNORADA  "${text}"`);
    continue;
  }
  const result = await classifier.classify(text);
  console.log(
    `${result.category.name.padEnd(24)} ${result.priority.padEnd(7)} ` +
      `${String(Math.round(result.confidence * 100)).padStart(3)}%  "${text}"`,
  );
}
