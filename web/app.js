import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// ============================================================ constantes
const STATUS = {
  pending: { label: "Pendente", className: "badge-pending" },
  in_progress: { label: "Em andamento", className: "badge-in_progress" },
  done: { label: "Concluído", className: "badge-done" },
  cancelled: { label: "Cancelado", className: "badge-cancelled" },
};
const PRIORITY = {
  urgent: { label: "Urgente", className: "priority-urgent" },
  high: { label: "Alta", className: "priority-high" },
  medium: { label: "Média", className: "priority-medium" },
  low: { label: "Baixa", className: "priority-low" },
};
const BOARD = [
  { id: "pending", title: "Pendentes" },
  { id: "in_progress", title: "Em andamento" },
  { id: "done", title: "Concluídos" },
  { id: "cancelled", title: "Cancelados" },
];
const VIEW_TITLES = {
  overview: ["Visão geral", "Acompanhe os chamados abertos no grupo de WhatsApp"],
  board: ["Chamados", "Arraste os cartões para mudar o status"],
  stats: ["Estatísticas", "Volume, categorias e tempo de resolução"],
  settings: ["Configurações", "Grupos monitorados, SLA e equipe"],
};
const STATUS_COLORS = {
  pending: "#f59e0b",
  in_progress: "#3b82f6",
  done: "#10b981",
  cancelled: "#94a3b8",
};

// ============================================================ helpers DOM
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") node.innerHTML = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function toast(message, type = "") {
  const node = h("div", { class: `toast ${type}` }, message);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

function fmtDate(value) {
  if (!value) return "—";
  try {
    return dateFmt.format(new Date(value));
  } catch {
    return "—";
  }
}

function timeAgo(value) {
  if (!value) return "";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  return `${Math.floor(days / 30)} mês(es)`;
}

function fmtHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  if (hours < 1) return "<1 h";
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

const norm = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// ============================================================ estado
const state = {
  userId: null,
  user: null,
  profile: null,
  categories: [],
  profiles: [],
  settings: null,
  tickets: [],
  stats: null,
  events: [],
  view: "overview",
  filters: { q: "", category: "all", priority: "all", assignee: "all" },
  selectedId: null,
  charts: {},
  channel: null,
  reloadTimer: null,
  lastSync: null,
};

let sb = null;

const configured =
  SUPABASE_URL &&
  !SUPABASE_URL.includes("SEU-PROJETO") &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_ANON_KEY.includes("SUA-ANON");

// ============================================================ boot
function boot() {
  if (!configured) {
    $("#config-error").classList.remove("hidden");
    return;
  }

  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  bindStatic();

  sb.auth.getSession().then(({ data }) => {
    if (data.session?.user) onSignedIn(data.session.user);
    else showLogin();
  });

  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) onSignedIn(session.user);
    else if (state.userId) showLogin();
  });
}

function showLogin() {
  state.userId = null;
  $("#app").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  $("#login-error").textContent = "";
}

async function onSignedIn(user) {
  if (state.userId === user.id) return;
  state.userId = user.id;
  state.user = user;
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#login-password").value = "";

  try {
    await loadReference();
    await loadTickets();
    subscribe();
    switchView(state.view);
    updateLive(true);
  } catch (error) {
    console.error(error);
    toast(`Falha ao carregar dados: ${error.message}`, "error");
  }
}

// ============================================================ dados
async function loadReference() {
  const [cats, profs, settings] = await Promise.all([
    sb.from("categories").select("*").order("sort_order", { ascending: true }),
    sb.from("profiles").select("id, full_name, role").order("full_name"),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (cats.error) throw cats.error;
  if (profs.error) throw profs.error;

  state.categories = cats.data || [];
  state.profiles = profs.data || [];
  state.settings = settings.data || null;
  state.profile =
    state.profiles.find((item) => item.id === state.userId) || {
      id: state.userId,
      full_name: state.user.email?.split("@")[0] || "Usuário",
      role: "agent",
    };

  renderUser();
}

async function loadTickets() {
  const [tickets, stats] = await Promise.all([
    sb.from("tickets").select("*").order("created_at", { ascending: false }).limit(500),
    sb.rpc("dashboard_stats"),
  ]);

  if (tickets.error) throw tickets.error;
  state.tickets = tickets.data || [];
  state.stats = stats.error ? null : stats.data;
  state.lastSync = new Date();

  $("#last-sync").textContent = `sincronizado ${timeAgo(state.lastSync.toISOString())}`;
  updateBadges();
  renderCurrent();
}

function scheduleReload() {
  if (state.reloadTimer) clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(async () => {
    state.reloadTimer = null;
    try {
      await loadTickets();
      if (state.selectedId) await openTicket(state.selectedId, true);
    } catch (error) {
      console.error(error);
    }
  }, 700);
}

function subscribe() {
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = sb
    .channel("suporte-ti-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_events" }, scheduleReload)
    .subscribe((status) => updateLive(status === "SUBSCRIBED"));
}

function updateLive(online) {
  const pill = $("#live-status");
  pill.classList.toggle("offline", !online);
  pill.innerHTML = "";
  pill.append(
    h("span", { class: "live-dot" }),
    document.createTextNode(online ? " ao vivo" : " offline"),
  );
}

function categoryOf(ticket) {
  return (
    state.categories.find((item) => item.id === ticket.category_id) ||
    state.categories.find((item) => item.slug === ticket.category_slug) ||
    state.categories.find((item) => item.slug === "outros") ||
    { name: "Outros", color: "#64748b", icon: "📋", slug: "outros" }
  );
}

function profileName(id) {
  if (!id) return "—";
  const profile = state.profiles.find((item) => item.id === id);
  return profile?.full_name || "—";
}

function displayName() {
  return state.profile?.full_name || state.user?.email || "Equipe";
}

function updateBadges() {
  const pending = state.tickets.filter((t) => t.status === "pending").length;
  const badge = $("#nav-pending");
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);
  $("#user-name").textContent = displayName();
  $("#user-role").textContent = state.profile?.role || "agent";
  $("#user-avatar").textContent = (displayName()[0] || "?").toUpperCase();
}

function renderUser() {
  updateBadges();
}

// ============================================================ navegação
function switchView(view) {
  state.view = view;
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $$(".view").forEach((section) => section.classList.add("hidden"));
  $(`#view-${view}`)?.classList.remove("hidden");

  const [title, subtitle] = VIEW_TITLES[view] || ["Suporte TI", ""];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;

  renderCurrent();
}

function renderCurrent() {
  if (!state.userId) return;
  if (state.view === "overview") renderOverview();
  else if (state.view === "board") renderBoard();
  else if (state.view === "stats") renderStats();
  else if (state.view === "settings") renderSettings();
}

// ============================================================ visão geral
function statCard(label, value, sub, accent) {
  return h(
    "div",
    { class: "stat-card", style: { "--accent": accent } },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value" }, value),
    h("div", { class: "stat-sub" }, sub),
  );
}

function ticketRow(ticket, showStatus = true) {
  const category = categoryOf(ticket);
  return h(
    "div",
    { class: "list-item", onClick: () => openTicket(ticket.id) },
    h("div", { class: "list-main" },
      h("div", { class: "list-title" }, ticket.summary || ticket.content?.slice(0, 90) || ticket.protocol),
      h("div", { class: "list-sub" },
        `${ticket.protocol} · ${ticket.requester_name || "desconhecido"} · ${category.icon} ${category.name}`,
      ),
    ),
    h("div", { class: "list-side" },
      showStatus ? h("span", { class: `badge ${STATUS[ticket.status]?.className || ""}` }, STATUS[ticket.status]?.label || ticket.status) : null,
      h("span", { class: "muted small" }, timeAgo(ticket.created_at)),
    ),
  );
}

function renderOverview() {
  const stats = state.stats || {};
  const cards = $("#overview-cards");
  clear(cards);
  cards.append(
    statCard("Pendentes", stats.pending ?? 0, "aguardando atendimento", "#f59e0b"),
    statCard("Em andamento", stats.in_progress ?? 0, "em atendimento agora", "#3b82f6"),
    statCard("Concluídos", stats.done ?? 0, "chamados resolvidos", "#10b981"),
    statCard("SLA estourado", stats.sla_breached ?? 0, "passaram do prazo", "#ef4444"),
    statCard("Tempo médio", fmtHours(stats.avg_resolution_hours), "para resolver", "#8b5cf6"),
  );

  // gráfico de categorias
  const counts = new Map();
  for (const ticket of state.tickets) {
    const category = categoryOf(ticket);
    counts.set(category.name, (counts.get(category.name) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  mountChart("overviewCategory", "chart-overview-category", {
    type: "bar",
    data: {
      labels: entries.map((item) => item[0]),
      datasets: [
        {
          label: "Chamados",
          data: entries.map((item) => item[1]),
          backgroundColor: "#6366f1",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } },
        y: { grid: { display: false } },
      },
    },
  });

  // SLA em risco
  const sla = $("#overview-sla");
  clear(sla);
  const now = Date.now();
  const late = state.tickets
    .filter(
      (t) =>
        ["pending", "in_progress"].includes(t.status) &&
        t.sla_due_at &&
        new Date(t.sla_due_at).getTime() < now,
    )
    .sort((a, b) => new Date(a.sla_due_at) - new Date(b.sla_due_at))
    .slice(0, 6);
  if (!late.length) sla.append(h("div", { class: "empty" }, "Nenhum chamado fora do SLA. 🎉"));
  else sla.append(...late.map((ticket) => ticketRow(ticket)));

  // recentes
  const recent = $("#overview-recent");
  clear(recent);
  if (!state.tickets.length) {
    recent.append(h("div", { class: "empty" }, "Nenhum chamado recebido ainda."));
  } else {
    recent.append(...state.tickets.slice(0, 8).map((ticket) => ticketRow(ticket)));
  }
}

// ============================================================ chamados
function filteredTickets() {
  const { q, category, priority, assignee } = state.filters;
  const query = norm(q);
  return state.tickets.filter((ticket) => {
    if (category !== "all") {
      const cat = categoryOf(ticket);
      if (cat.id !== category && cat.slug !== category) return false;
    }
    if (priority !== "all" && ticket.priority !== priority) return false;
    if (assignee !== "all") {
      if (assignee === "none" && ticket.assignee_id) return false;
      if (assignee !== "none" && ticket.assignee_id !== assignee) return false;
    }
    if (query) {
      const haystack = norm(
        `${ticket.protocol} ${ticket.requester_name || ""} ${ticket.content || ""} ${ticket.summary || ""}`,
      );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function fillFilters() {
  const catSelect = $("#filter-category");
  const assigneeSelect = $("#filter-assignee");
  const catValue = catSelect.value || "all";
  const assigneeValue = assigneeSelect.value || "all";

  clear(catSelect);
  catSelect.append(h("option", { value: "all" }, "Todas as categorias"));
  for (const category of state.categories) {
    catSelect.append(h("option", { value: category.id }, `${category.icon} ${category.name}`));
  }
  catSelect.value = catValue;

  clear(assigneeSelect);
  assigneeSelect.append(
    h("option", { value: "all" }, "Todos os responsáveis"),
    h("option", { value: "none" }, "Sem responsável"),
  );
  for (const profile of state.profiles) {
    assigneeSelect.append(h("option", { value: profile.id }, profile.full_name || profile.id));
  }
  assigneeSelect.value = assigneeValue;
}

function ticketCard(ticket) {
  const category = categoryOf(ticket);
  return h(
    "div",
    {
      class: "ticket-card",
      draggable: true,
      dataset: { id: ticket.id },
      onClick: () => openTicket(ticket.id),
      onDragstart: (event) => {
        event.dataTransfer.setData("text/plain", ticket.id);
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.classList.add("dragging");
      },
      onDragend: (event) => event.currentTarget.classList.remove("dragging"),
    },
    h("div", { class: "ticket-top" },
      h("span", { class: "ticket-protocol" }, ticket.protocol),
      h("span", { class: `dot ${PRIORITY[ticket.priority]?.className || ""}`, style: { background: "currentColor" } }),
      h("span", { class: "muted small" }, PRIORITY[ticket.priority]?.label || ticket.priority),
    ),
    h("div", { class: "ticket-title" }, ticket.summary || ticket.content || "(sem texto)"),
    h("div", { class: "ticket-meta" },
      h("span", { class: "chip" }, `${category.icon} ${category.name}`),
      ticket.assignee_id ? h("span", { class: "chip" }, `👤 ${profileName(ticket.assignee_id)}`) : null,
    ),
    h("div", { class: "ticket-foot" },
      h("span", {}, ticket.requester_name || "desconhecido"),
      h("span", {}, timeAgo(ticket.created_at)),
    ),
  );
}

function renderBoard() {
  fillFilters();
  const tickets = filteredTickets();
  const board = $("#board");
  clear(board);

  for (const column of BOARD) {
    const items = tickets.filter((ticket) => ticket.status === column.id);
    const body = h("div", { class: "board-col-body" });
    if (!items.length) {
      body.append(h("div", { class: "empty" }, "Nada aqui."));
    } else {
      body.append(...items.map((ticket) => ticketCard(ticket)));
    }

    const col = h(
      "div",
      {
        class: "board-col",
        dataset: { status: column.id },
        onDragover: (event) => {
          event.preventDefault();
          event.currentTarget.classList.add("drag-over");
        },
        onDragleave: (event) => event.currentTarget.classList.remove("drag-over"),
        onDrop: async (event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("drag-over");
          const id = event.dataTransfer.getData("text/plain");
          const ticket = state.tickets.find((item) => item.id === id);
          if (ticket && ticket.status !== column.id) {
            await patchTicket(ticket, { status: column.id }, {
              type: "status",
              from: ticket.status,
              to: column.id,
            });
          }
        },
      },
      h("div", { class: "board-col-head" },
        h("span", { class: "dot", style: { background: STATUS_COLORS[column.id] } }),
        column.title,
        h("span", { class: "count" }, items.length),
      ),
      body,
    );
    board.append(col);
  }
}

// ============================================================ estatísticas
function mountChart(key, canvasId, config) {
  if (!window.Chart) return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  state.charts[key]?.destroy();
  state.charts[key] = new window.Chart(canvas, config);
}

function renderStats() {
  const stats = state.stats || {};
  const cards = $("#stats-cards");
  clear(cards);
  const total = stats.total ?? state.tickets.length;
  const done = stats.done ?? 0;
  const rate = total ? Math.round((done / total) * 100) : 0;
  cards.append(
    statCard("Total de chamados", total, "desde o início", "#6366f1"),
    statCard("Taxa de conclusão", `${rate}%`, `${done} concluídos`, "#10b981"),
    statCard("Tempo médio", fmtHours(stats.avg_resolution_hours), "para resolver", "#8b5cf6"),
    statCard("SLA estourado", stats.sla_breached ?? 0, "em aberto", "#ef4444"),
  );

  // status
  const statusCounts = {};
  for (const ticket of state.tickets) statusCounts[ticket.status] = (statusCounts[ticket.status] || 0) + 1;
  const statusKeys = Object.keys(STATUS).filter((key) => statusCounts[key]);
  mountChart("status", "chart-status", {
    type: "doughnut",
    data: {
      labels: statusKeys.map((key) => STATUS[key].label),
      datasets: [
        {
          data: statusKeys.map((key) => statusCounts[key]),
          backgroundColor: statusKeys.map((key) => STATUS_COLORS[key]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
    },
  });

  // categorias
  const catCounts = new Map();
  for (const ticket of state.tickets) {
    const category = categoryOf(ticket);
    catCounts.set(category.name, (catCounts.get(category.name) || 0) + 1);
  }
  const catEntries = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  mountChart("category", "chart-category", {
    type: "bar",
    data: {
      labels: catEntries.map((item) => item[0]),
      datasets: [
        {
          label: "Chamados",
          data: catEntries.map((item) => item[1]),
          backgroundColor: "#818cf8",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } },
        y: { grid: { display: false } },
      },
    },
  });

  // volume 14 dias
  const days = [];
  const createdByDay = new Map();
  const closedByDay = new Map();
  for (let index = 13; index >= 0; index -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    days.push({ key, label: dayFmt.format(date) });
    createdByDay.set(key, 0);
    closedByDay.set(key, 0);
  }
  for (const ticket of state.tickets) {
    const created = String(ticket.created_at || "").slice(0, 10);
    if (createdByDay.has(created)) createdByDay.set(created, createdByDay.get(created) + 1);
    const closed = String(ticket.closed_at || "").slice(0, 10);
    if (closedByDay.has(closed)) closedByDay.set(closed, closedByDay.get(closed) + 1);
  }
  mountChart("volume", "chart-volume", {
    type: "line",
    data: {
      labels: days.map((day) => day.label),
      datasets: [
        {
          label: "Abertos",
          data: days.map((day) => createdByDay.get(day.key)),
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.14)",
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
        {
          label: "Concluídos",
          data: days.map((day) => closedByDay.get(day.key)),
          borderColor: "#10b981",
          backgroundColor: "rgba(16,185,129,0.10)",
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } },
      },
    },
  });

  // top solicitantes
  const requesters = new Map();
  for (const ticket of state.tickets) {
    const name = ticket.requester_name || "Desconhecido";
    requesters.set(name, (requesters.get(name) || 0) + 1);
  }
  const top = [...requesters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  mountChart("requesters", "chart-requesters", {
    type: "bar",
    data: {
      labels: top.map((item) => item[0]),
      datasets: [
        {
          label: "Chamados",
          data: top.map((item) => item[1]),
          backgroundColor: "#38bdf8",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } },
        y: { grid: { display: false } },
      },
    },
  });

  // prioridade
  const priorityCounts = {};
  for (const ticket of state.tickets) priorityCounts[ticket.priority] = (priorityCounts[ticket.priority] || 0) + 1;
  const priorityKeys = Object.keys(PRIORITY).filter((key) => priorityCounts[key]);
  const priorityColors = { urgent: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#94a3b8" };
  mountChart("priority", "chart-priority", {
    type: "doughnut",
    data: {
      labels: priorityKeys.map((key) => PRIORITY[key].label),
      datasets: [
        {
          data: priorityKeys.map((key) => priorityCounts[key]),
          backgroundColor: priorityKeys.map((key) => priorityColors[key]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
    },
  });
}

// ============================================================ configurações
function renderSettings() {
  const settings = state.settings || {};
  const isAdmin = state.profile?.role === "admin";
  const form = $("#settings-form");

  $("#settings-admin-hint").textContent = isAdmin ? "" : "somente administradores podem editar";
  $$("#settings-form input, #settings-form textarea, #settings-form button").forEach((node) => {
    node.disabled = !isAdmin;
  });

  $("#set-groups").value = (settings.group_ids || []).join(", ");
  $("#set-sla").value = settings.sla_hours ?? 24;
  $("#set-merge").value = settings.merge_window_minutes ?? 15;
  $("#set-auto").checked = settings.auto_create !== false;
  $("#set-ai").checked = settings.ai_enabled !== false;
  form.dataset.ready = "1";

  const profiles = $("#settings-profiles");
  clear(profiles);
  if (!state.profiles.length) profiles.append(h("div", { class: "empty" }, "Nenhum perfil."));
  for (const profile of state.profiles) {
    profiles.append(
      h("div", { class: "list-item", style: { cursor: "default" } },
        h("div", { class: "avatar", style: { width: "32px", height: "32px", fontSize: "12px" } },
          (profile.full_name || "?")[0].toUpperCase()),
        h("div", { class: "list-main" },
          h("div", { class: "list-title" }, profile.full_name || profile.id),
          h("div", { class: "list-sub" }, profile.role),
        ),
      ),
    );
  }

  const categories = $("#settings-categories");
  clear(categories);
  for (const category of state.categories) {
    categories.append(
      h("div", { class: "category-row" },
        h("div", { class: "category-row-head" },
          h("span", { class: "dot", style: { background: category.color } }),
          h("span", {}, `${category.icon} ${category.name}`),
          h("span", { class: "muted small", style: { marginLeft: "auto" } }, category.slug),
        ),
        h("p", {}, (category.keywords || []).join(" · ") || "sem palavras-chave (categoria padrão)"),
      ),
    );
  }
}

async function saveSettings(event) {
  event.preventDefault();
  if (state.profile?.role !== "admin") return toast("Apenas administradores podem salvar.", "error");

  const groupIds = $("#set-groups")
    .value.split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const patch = {
    group_ids: groupIds,
    sla_hours: Number($("#set-sla").value) || 24,
    merge_window_minutes: Number($("#set-merge").value) || 15,
    auto_create: $("#set-auto").checked,
    ai_enabled: $("#set-ai").checked,
  };

  const { error } = await sb.from("settings").update(patch).eq("id", 1);
  if (error) return toast(error.message, "error");

  state.settings = { ...(state.settings || {}), ...patch };
  toast("Configurações salvas.", "success");
}

// ============================================================ drawer
async function openTicket(id, silent = false) {
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket) return;
  state.selectedId = id;

  const { data: events } = await sb
    .from("ticket_events")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });
  state.events = events || [];

  const category = categoryOf(ticket);
  const content = $("#drawer-content");
  clear(content);

  const statusSelect = h(
    "select",
    {
      onChange: (event) =>
        patchTicket(ticket, { status: event.target.value }, {
          type: "status",
          from: ticket.status,
          to: event.target.value,
        }),
    },
    ...Object.entries(STATUS).map(([value, info]) =>
      h("option", { value, selected: ticket.status === value }, info.label),
    ),
  );

  const prioritySelect = h(
    "select",
    {
      onChange: (event) =>
        patchTicket(ticket, { priority: event.target.value }, {
          type: "priority",
          from: ticket.priority,
          to: event.target.value,
        }),
    },
    ...Object.entries(PRIORITY).map(([value, info]) =>
      h("option", { value, selected: ticket.priority === value }, info.label),
    ),
  );

  const categorySelect = h(
    "select",
    {
      onChange: (event) => {
        const selected = state.categories.find((item) => item.id === event.target.value);
        patchTicket(
          ticket,
          { category_id: selected?.id || null, category_slug: selected?.slug || null },
          { type: "category", from: category.slug, to: selected?.slug || "" },
        );
      },
    },
    ...state.categories.map((item) =>
      h("option", { value: item.id, selected: category.id === item.id }, `${item.icon} ${item.name}`),
    ),
  );

  const assigneeSelect = h(
    "select",
    {
      onChange: (event) => {
        const id = event.target.value || null;
        patchTicket(
          ticket,
          { assignee_id: id, assignee_name: id ? profileName(id) : null },
          { type: "assignee", from: ticket.assignee_name || "", to: id ? profileName(id) : "" },
        );
      },
    },
    h("option", { value: "" }, "Sem responsável"),
    ...state.profiles.map((profile) =>
      h("option", { value: profile.id, selected: ticket.assignee_id === profile.id }, profile.full_name || profile.id),
    ),
  );

  const noteInput = h("input", { type: "text", placeholder: "Adicionar observação interna…" });
  const noteForm = h(
    "form",
    {
      class: "note-form",
      onSubmit: async (event) => {
        event.preventDefault();
        const note = noteInput.value.trim();
        if (!note) return;
        noteInput.value = "";
        await sb.from("ticket_events").insert({
          ticket_id: ticket.id,
          actor_id: state.userId,
          actor_name: displayName(),
          type: "note",
          note,
        });
        await openTicket(ticket.id, true);
        toast("Observação adicionada.", "success");
      },
    },
    noteInput,
    h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Enviar"),
  );

  content.append(
    h("div", { class: "drawer-head" },
      h("div", {},
        h("div", { class: "muted small" }, ticket.protocol),
        h("h2", {}, ticket.summary || "Chamado"),
        h("div", { style: { marginTop: "6px" } },
          h("span", { class: `badge ${STATUS[ticket.status]?.className || ""}` }, STATUS[ticket.status]?.label || ticket.status),
        ),
      ),
      h("button", { class: "btn btn-ghost btn-sm", onClick: closeDrawer, title: "Fechar" }, "✕"),
    ),
    h("div", { class: "drawer-body" },
      h("div", { class: "drawer-section" },
        h("h3", {}, "Solicitação"),
        h("div", { class: "ticket-content" }, ticket.content || "(sem texto)"),
      ),

      h("div", { class: "drawer-section" },
        h("h3", {}, "Atendimento"),
        h("div", { class: "field-grid" },
          h("div", { class: "field" }, h("label", {}, "Status"), statusSelect),
          h("div", { class: "field" }, h("label", {}, "Prioridade"), prioritySelect),
          h("div", { class: "field" }, h("label", {}, "Categoria"), categorySelect),
          h("div", { class: "field" }, h("label", {}, "Responsável"), assigneeSelect),
        ),
      ),

      h("div", { class: "drawer-section" },
        h("h3", {}, "Detalhes"),
        h("div", { class: "meta-grid" },
          metaBox("Solicitante", ticket.requester_name || "Desconhecido"),
          metaBox("Telefone", ticket.requester_phone || "—"),
          metaBox("Grupo", ticket.group_name || ticket.group_id),
          metaBox("Aberto em", fmtDate(ticket.created_at)),
          metaBox("Iniciado em", fmtDate(ticket.started_at)),
          metaBox("Concluído em", fmtDate(ticket.closed_at)),
          metaBox("SLA", ticket.sla_due_at ? fmtDate(ticket.sla_due_at) : "—"),
          metaBox("Origem", ticket.source || "whatsapp"),
        ),
        ticket.ai_reason
          ? h("p", { class: "field-hint", style: { marginTop: "10px" } }, `🤖 ${ticket.ai_reason}`)
          : null,
      ),

      h("div", { class: "drawer-section" },
        h("h3", {}, "Histórico"),
        h("div", { class: "timeline" },
          ...(state.events.length
            ? state.events.map((event) => timelineItem(event))
            : [
                h("div", { class: "timeline-item" },
                  h("span", { class: "timeline-dot" }),
                  h("div", { class: "timeline-main" },
                    h("div", { class: "timeline-title" }, "Chamado criado"),
                    h("div", { class: "timeline-sub" }, fmtDate(ticket.created_at)),
                  ),
                ),
              ]),
        ),
        noteForm,
      ),
    ),
  );

  $("#drawer").classList.remove("hidden");
  $("#drawer-overlay").classList.remove("hidden");

  if (!silent) $("#drawer").scrollTop = 0;
}

function metaBox(label, value) {
  return h("div", { class: "meta-box" }, h("span", {}, label), h("strong", {}, value));
}

function timelineItem(event) {
  const labels = {
    created: "Chamado criado",
    status: "Status alterado",
    priority: "Prioridade alterada",
    category: "Categoria alterada",
    assignee: "Responsável alterado",
    note: "Observação",
    message: "Nova mensagem no grupo",
  };
  let title = labels[event.type] || event.type;
  if (event.from_value || event.to_value) {
    title += `: ${event.from_value || "—"} → ${event.to_value || "—"}`;
  }
  return h("div", { class: "timeline-item" },
    h("span", { class: "timeline-dot" }),
    h("div", { class: "timeline-main" },
      h("div", { class: "timeline-title" }, title),
      h("div", { class: "timeline-sub" }, `${event.actor_name || "Sistema"} · ${fmtDate(event.created_at)}`),
      event.note ? h("div", { class: "timeline-note" }, event.note) : null,
    ),
  );
}

function closeDrawer() {
  state.selectedId = null;
  $("#drawer").classList.add("hidden");
  $("#drawer-overlay").classList.add("hidden");
}

// ============================================================ ações
async function patchTicket(ticket, patch, event) {
  const now = new Date().toISOString();

  if (patch.status && patch.status !== ticket.status) {
    if (patch.status === "in_progress" && !ticket.started_at) patch.started_at = now;
    if (patch.status === "done") {
      patch.closed_at = now;
      if (!ticket.started_at) patch.started_at = now;
    }
    if (patch.status !== "done") patch.closed_at = null;
  }

  const { error } = await sb.from("tickets").update(patch).eq("id", ticket.id);
  if (error) return toast(error.message, "error");

  if (event) {
    const { error: eventError } = await sb.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: state.userId,
      actor_name: displayName(),
      type: event.type,
      from_value: event.from ?? null,
      to_value: event.to ?? null,
      note: event.note ?? null,
    });
    if (eventError) console.warn(eventError.message);
  }

  toast("Chamado atualizado.", "success");
  await loadTickets();
  if (state.selectedId === ticket.id) await openTicket(ticket.id, true);
}

// ============================================================ eventos estáticos
function bindStatic() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    $("#login-error").textContent = "";
    const button = event.target.querySelector("button");
    button.disabled = true;
    button.textContent = "Entrando…";

    const { error } = await sb.auth.signInWithPassword({ email, password });

    button.disabled = false;
    button.textContent = "Entrar";
    if (error) {
      $("#login-error").textContent =
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message;
    }
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.addEventListener("click", (event) => {
    const goto = event.target.closest("[data-goto]");
    if (goto) switchView(goto.dataset.goto);
  });

  $("#refresh").addEventListener("click", async () => {
    $("#refresh").disabled = true;
    try {
      await loadTickets();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      $("#refresh").disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    if (state.channel) await sb.removeChannel(state.channel);
    await sb.auth.signOut();
    location.reload();
  });

  let filterTimer = null;
  $("#filter-q").addEventListener("input", (event) => {
    state.filters.q = event.target.value;
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(renderBoard, 180);
  });
  $("#filter-category").addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    renderBoard();
  });
  $("#filter-priority").addEventListener("change", (event) => {
    state.filters.priority = event.target.value;
    renderBoard();
  });
  $("#filter-assignee").addEventListener("change", (event) => {
    state.filters.assignee = event.target.value;
    renderBoard();
  });
  $("#filter-clear").addEventListener("click", () => {
    state.filters = { q: "", category: "all", priority: "all", assignee: "all" };
    $("#filter-q").value = "";
    $("#filter-category").value = "all";
    $("#filter-priority").value = "all";
    $("#filter-assignee").value = "all";
    renderBoard();
  });

  $("#settings-form").addEventListener("submit", saveSettings);

  $("#drawer-overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  setInterval(() => {
    if (state.lastSync) $("#last-sync").textContent = `sincronizado ${timeAgo(state.lastSync.toISOString())}`;
  }, 30000);
}

boot();
