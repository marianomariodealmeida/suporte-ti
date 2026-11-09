// Classificador de mensagens: regras por palavra-chave + IA opcional
// (qualquer endpoint compatível com OpenAI: Groq, Gemini, OpenRouter, etc.).

const URGENT = [
  "urgente",
  "emergencia",
  "critico",
  "parado",
  "parada",
  "parou",
  "fora do ar",
  "queda",
  "caiu",
  "todos pararam",
  "nada funciona",
  "nao funciona nada",
  "imediato",
  "asap",
  "socorro",
  "desespero",
];

const HIGH = [
  "rapido",
  "hoje",
  "atrasado",
  "importante",
  "bloqueado",
  "bloqueada",
  "nao consigo trabalhar",
  "preciso urgente",
  "cliente esperando",
  "reuniao",
  "apresentacao",
  "prazo",
];

const LOW = [
  "quando puder",
  "sem pressa",
  "duvida",
  "sugestao",
  "ideia",
  "melhoria",
  "curiosidade",
  "nao urgente",
];

const GREETINGS = new Set([
  "bom dia",
  "boa tarde",
  "boa noite",
  "oi",
  "ola",
  "opa",
  "eai",
  "e ai",
  "tudo bem",
  "tudo bom",
  "como vai",
  "obrigado",
  "obrigada",
  "valeu",
  "vlw",
  "ok",
  "okay",
  "beleza",
  "blz",
  "certo",
  "sim",
  "nao",
  "de nada",
  "disponha",
  "bom fim de semana",
  "boa semana",
  "ate mais",
  "tchau",
  "falo",
  "teste",
  "testando",
]);

const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s.,!?~-]+$/u;

export function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanForGreeting(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(text, max = 150) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function priorityOf(text) {
  const value = normalize(text);
  if (URGENT.some((word) => value.includes(word))) return "urgent";
  if (HIGH.some((word) => value.includes(word))) return "high";
  if (LOW.some((word) => value.includes(word))) return "low";
  return "medium";
}

export function createClassifier({ supabase, config, logger }) {
  let categories = [];
  let lastLoad = 0;
  let loading = null;

  async function refresh(force = false) {
    if (!force && categories.length && Date.now() - lastLoad < 5 * 60_000) return categories;
    if (loading) return loading;
    loading = (async () => {
      const data = await supabase.select(
        "categories",
        "select=id,slug,name,color,icon,keywords,sort_order&order=sort_order.asc",
      );
      categories = Array.isArray(data) ? data : [];
      lastLoad = Date.now();
      logger.debug(`Classificador: ${categories.length} categorias carregadas.`);
      return categories;
    })()
      .catch((error) => {
        logger.warn("Falha ao carregar categorias:", error.message);
        return categories;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function fallbackCategory() {
    return (
      categories.find((item) => item.slug === "outros") ||
      categories[0] || { id: null, slug: "outros", name: "Outros" }
    );
  }

  function ruleClassify(text) {
    const value = normalize(text);
    let best = null;

    for (const category of categories) {
      let score = 0;
      for (const keyword of category.keywords || []) {
        const key = normalize(keyword);
        if (!key || key.length < 2) continue;
        if (!value.includes(key)) continue;
        const words = key.split(/\s+/).length;
        score += (key.length >= 6 ? 2 : 1) * words;
      }
      if (score > 0 && (!best || score > best.score)) best = { category, score };
    }

    if (!best) {
      return {
        category: fallbackCategory(),
        confidence: 0.2,
        reason: "Nenhuma palavra-chave conhecida; categoria padrão.",
      };
    }

    const confidence = Math.min(0.95, 0.35 + Math.log10(1 + best.score) * 0.35);
    return {
      category: best.category,
      confidence: Number(confidence.toFixed(3)),
      reason: `Regras: ${best.score} ponto(s) em "${best.category.name}".`,
    };
  }

  async function aiClassify(text) {
    if (!config.ai.enabled || !config.ai.baseUrl || !config.ai.model) return null;

    const catalog = categories
      .map((item) => `- ${item.slug}: ${item.name}`)
      .join("\n");

    const system =
      "Você classifica mensagens de um grupo de suporte de TI em português. " +
      "Responda SOMENTE com um objeto JSON válido, sem markdown.";

    const user = [
      "Categorias disponíveis:",
      catalog,
      "",
      "Campos do JSON:",
      '{ "slug": "uma categoria acima", "priority": "low|medium|high|urgent", "confidence": 0.0-1.0, "reason": "curto" }',
      "",
      "Mensagem:",
      text,
    ].join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(config.ai.apiKey
            ? { authorization: `Bearer ${config.ai.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.ai.model,
          temperature: 0.1,
          max_tokens: 220,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!response.ok) {
        logger.warn(`IA respondeu ${response.status}; usando regras.`);
        return null;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);

      const category =
        categories.find((item) => item.slug === parsed.slug) ||
        categories.find((item) => normalize(item.name) === normalize(parsed.slug)) ||
        fallbackCategory();

      return {
        category,
        priority: ["low", "medium", "high", "urgent"].includes(parsed.priority)
          ? parsed.priority
          : null,
        confidence: Number(parsed.confidence) || 0.6,
        reason: `IA: ${String(parsed.reason || "classificação automática").slice(0, 180)}`,
        source: "ai",
      };
    } catch (error) {
      logger.warn("IA indisponível; usando regras:", error.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function isNoise(text, media = []) {
    if (media.length && !text) return false;
    const raw = String(text || "").trim();
    if (!raw) return true;
    if (raw.length < config.minMessageLength) return true;
    if (EMOJI_ONLY.test(raw)) return true;

    const clean = cleanForGreeting(raw);
    if (!clean) return true;
    if (GREETINGS.has(clean)) return true;

    // "bom dia pessoal", "obrigado a todos" etc.
    const words = clean.split(" ");
    if (words.length <= 4) {
      const joined = words.filter((word) => !["pessoal", "galera", "todos", "time", "gente"].includes(word)).join(" ");
      if (GREETINGS.has(joined)) return true;
    }

    return false;
  }

  async function classify(text) {
    await refresh();
    const rule = ruleClassify(text);

    let result = {
      category: rule.category,
      confidence: rule.confidence,
      reason: rule.reason,
      priority: priorityOf(text),
      summary: summarize(text),
      source: "rules",
    };

    if (rule.confidence < 0.55) {
      const ai = await aiClassify(text);
      if (ai) {
        result = {
          ...result,
          category: ai.category,
          confidence: ai.confidence,
          reason: ai.reason,
          priority: ai.priority || result.priority,
          source: "ai",
        };
      }
    }

    return result;
  }

  return { classify, isNoise, refresh, priorityOf, summarize, get categories() { return categories; } };
}
