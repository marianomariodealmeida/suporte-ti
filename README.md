# Suporte TI · WhatsApp → Dashboard

Central de chamados de TI que lê um **grupo de WhatsApp**, classifica cada
solicitação, evita duplicidades e mostra tudo em um dashboard com quadro de
tarefas, SLA e estatísticas.

```
Grupo de WhatsApp
      │  (Baileys + QR Code)
      ▼
Conector Node.js ──► Supabase (Postgres + Auth + Realtime)
(Oracle Free / PC)              │
                                ▼
                    GitHub Pages (dashboard)
```

Todo o stack pode rodar **de graça**:

| Camada | Serviço | Plano |
|---|---|---|
| Frontend | GitHub Pages | grátis |
| Banco, Auth e Realtime | Supabase | Free (500 MB, 50k usuários) |
| Conector WhatsApp | Baileys (open source) | grátis |
| Hospedagem 24/7 | Oracle Cloud Always Free (VM ARM) ou seu PC | grátis |
| IA opcional | Groq / Gemini / OpenRouter free tier | grátis |

> **Aviso:** o Baileys é uma integração **não oficial** do WhatsApp. Use um
> **número secundário/dedicado**, nunca o número principal da empresa. Há risco
> de bloqueio pelo WhatsApp.

---

## 1. Estrutura

```
suporte-ti/
  web/                    # dashboard estático (GitHub Pages)
    index.html
    app.js
    styles.css
    config.js             # URL + chave publishable do Supabase
  supabase/
    migrations/
      20261109000000_init.sql
      20261109000100_seed.sql
  connector/              # conector Baileys → Supabase
    src/
      index.mjs           # pipeline: mensagem → classificação → chamado
      whatsapp.mjs        # conexão, QR, grupos e mídia
      classifier.mjs      # regras + IA opcional
      supabase.mjs        # cliente REST
      config.mjs
      logger.mjs
    scripts/
      list-groups.mjs     # descobre o JID do grupo
      test-classifier.mjs
      selftest.mjs
    .env.example
  .github/workflows/pages.yml
```

---

## 2. Criar o projeto no Supabase

1. Acesse <https://supabase.com/dashboard> e crie um projeto novo.
   - Região sugerida: **South America (São Paulo)**.
   - Guarde a senha do banco.
2. Abra **SQL Editor** e rode, nesta ordem, o conteúdo de:
   1. `supabase/migrations/20261109000000_init.sql`
   2. `supabase/migrations/20261109000100_seed.sql`

   > Alternativa com CLI: `supabase link --project-ref SEU_REF` e
   > `supabase db push`.

3. Em **Authentication → Users → Add user**, crie o primeiro usuário da equipe
   (marque *Auto Confirm User*). Depois, no SQL Editor, promova-o a admin:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'voce@empresa.com');
   ```

4. Em **Project Settings → API**, copie:
   - **Project URL** → `SUPABASE_URL`
   - **publishable key** (ou `anon` key) → vai no frontend
   - **service_role key** → **somente** no conector (nunca no frontend)

---

## 3. Configurar e publicar o dashboard

Edite `web/config.js`:

```js
export const SUPABASE_URL = "https://SEU-REF.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_..."; // ou a anon key
```

A chave publishable/anon é pública por design; a proteção real vem das
**políticas RLS** criadas na migration.

No GitHub:

1. Crie o repositório e envie o código para a branch `main`.
2. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
3. O workflow `.github/workflows/pages.yml` publica `web/` a cada push.
4. Acesse `https://SEU-USUARIO.github.io/SEU-REPO/` e entre com o usuário criado.

---

## 4. Rodar o conector

Pré-requisito: **Node.js 20+**.

```powershell
cd suporte-ti

npm run connector:install

copy connector\.env.example connector\.env
notepad connector\.env
```

Preencha no `connector/.env`:

```ini
SUPABASE_URL=https://SEU-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role, NUNCA a anon
```

Descubra o grupo e escaneie o QR:

```powershell
npm run connector:groups
```

O comando imprime todos os grupos com o respectivo `jid` (algo como
`1203630...@g.us`). Copie o do grupo de suporte para o `.env`:

```ini
WHATSAPP_GROUP_IDS=1203630...@g.us
```

Ou, se preferir, deixe vazio e use parte do nome:

```ini
WHATSAPP_GROUP_MATCH=suporte ti
```

Agora inicie:

```powershell
npm run connector:start
```

Na primeira vez aparece um QR Code no terminal. No celular do número dedicado:
**WhatsApp → Aparelhos conectados → Conectar aparelho** e escaneie.

Teste a conexão com o banco antes, se quiser:

```powershell
npm run connector:selftest
```

### Windows: iniciar em segundo plano / no logon

```powershell
.\connector\start-connector-background.ps1
.\connector\install-autostart.ps1
.\connector\stop-connector.ps1
```

Logs em `connector/logs/connector.log`.

---

## 5. Hospedar 24/7 de graça (Oracle Cloud)

O conector precisa ficar online para receber mensagens. A VM **Always Free** da
Oracle é a opção gratuita mais estável:

1. Crie uma conta em <https://www.oracle.com/cloud/free/> (pede cartão só para
   verificação; os recursos *Always Free* não são cobrados).
2. Crie uma instância **Ampere A1 (ARM)** com Ubuntu 22.04/24.04.
3. Libere a porta 22 no Security List e conecte por SSH.
4. Instale Node.js 20+ e clone o repositório:

   ```bash
   sudo apt update && sudo apt install -y git
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   git clone https://github.com/SEU-USUARIO/SEU-REPO.git
   cd SEU-REPO
   npm run connector:install
   cp connector/.env.example connector/.env
   nano connector/.env
   ```

5. Rode com `pm2` para reiniciar sozinho:

   ```bash
   sudo npm i -g pm2
   pm2 start connector/src/index.mjs --name suporte-ti
   pm2 save
   pm2 startup
   ```

6. Para escanear o QR, rode `npm run connector:groups` em primeiro plano e leia
   o QR no terminal (ou use `pm2 logs`).

> A pasta `connector/data/auth` guarda a sessão do WhatsApp. Faça backup dela e
> nunca a versione.

---

## 6. Como funciona a classificação

1. **Regras**: cada categoria tem palavras-chave (editáveis na tabela
   `categories`). O texto é normalizado (sem acentos, minúsculo) e pontuado.
2. **Prioridade**: palavras como “urgente”, “parado”, “fora do ar” viram
   `urgent`; “hoje”, “bloqueado” viram `high`; “quando puder” vira `low`.
3. **Agrupamento**: mensagens do mesmo solicitante no mesmo grupo, dentro da
   janela configurada (padrão **15 min**), entram no mesmo chamado.
4. **Ruído**: “bom dia”, “obrigado”, emojis e mensagens muito curtas são
   registradas em `raw_messages`, mas não viram chamado.
5. **IA opcional**: com `AI_ENABLED=true`, casos com baixa confiança vão para um
   endpoint compatível com OpenAI (Groq, Gemini, OpenRouter etc.).

### IA grátis (exemplo com Groq)

```ini
AI_ENABLED=true
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_...
AI_MODEL=llama-3.3-70b-versatile
```

### IA grátis (exemplo com Gemini, endpoint compatível)

```ini
AI_ENABLED=true
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=SUA_CHAVE
AI_MODEL=gemini-2.0-flash
```

Sem IA, tudo funciona com as regras.

---

## 7. Dashboard

- **Visão geral**: pendentes, em andamento, concluídos, SLA estourado, tempo
  médio, chamados por categoria, SLA em risco e últimos chamados.
- **Chamados**: quadro com arrastar-e-soltar entre *Pendentes → Em andamento →
  Concluídos*, filtros por texto, categoria, prioridade e responsável.
- **Detalhes**: conteúdo original, solicitante, grupo, datas, SLA, categoria,
  prioridade, responsável, histórico e observações internas.
- **Estatísticas**: status, categorias, volume de 14 dias, top solicitantes e
  prioridades.
- **Configurações** (admin): grupos monitorados, SLA, janela de agrupamento,
  auto-criação, IA e equipe.

Tudo atualiza em tempo real via Supabase Realtime.

---

## 8. Segurança

- `service_role` **só** no `connector/.env`. Nunca no `web/` nem no Git.
- `.env`, `connector/data/` e logs já estão no `.gitignore`.
- O dashboard exige login (Supabase Auth) e o RLS limita o acesso.
- Em repositório público, o **código** fica visível; os **dados** não.
- Crie usuários apenas para a equipe de TI.
- Se o número for banido, apague `connector/data/auth`, troque o número e
  escaneie novamente.

---

## 9. Solução de problemas

**“Nenhum grupo configurado”**
Rode `npm run connector:groups`, copie o JID e preencha `WHATSAPP_GROUP_IDS`
(ou use `MONITOR_ALL_GROUPS=true` temporariamente).

**QR não aparece / sessão inválida**
Apague `connector/data/auth` e rode de novo.

**Mensagens não viram chamados**
- Confira se o grupo está no `WHATSAPP_GROUP_IDS`.
- Veja `raw_messages` no Supabase: se estiverem com `processed=false` ou `error`,
  o pipeline parou antes de criar o chamado.
- Verifique os logs em `connector/logs/connector.log`.

**Supabase pausado**
Projetos Free pausam após 7 dias sem atividade. Como o conector grava sempre que
há mensagem, isso tende a não acontecer; se pausar, reative no dashboard.

**Erro 401/403 no conector**
`SUPABASE_SERVICE_ROLE_KEY` errada ou ausente.

**Dashboard sem dados**
Confira `web/config.js`, se o usuário está autenticado e se as migrations foram
aplicadas. Abra o console do navegador (F12).

**WhatsApp desconecta sozinho**
O `connector/src/whatsapp.mjs` reconecta automaticamente; se o celular remover o
dispositivo, será preciso escanear o QR de novo.

---

## 10. Próximos passos possíveis

- Auto-fechar chamados quando o solicitante escrever “resolvido”.
- Enviar uma mensagem de confirmação no grupo com o protocolo do chamado.
- Download de imagens/áudios para o Supabase Storage.
- Notificações por e-mail/Telegram para chamados urgentes.
- Relatórios exportáveis em CSV.
- Múltiplos grupos e regras por grupo.
