// Cliente REST mínimo para o Supabase (PostgREST).
// Usa a service_role key, que ignora RLS. Rode APENAS no conector.

export class SupabaseRest {
  constructor({ url, key, logger }) {
    if (!url || !key) throw new Error("SupabaseRest: url e key são obrigatórios.");
    this.url = String(url).replace(/\/+$/, "");
    this.key = key;
    this.logger = logger;
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Supabase ${method} ${path} falhou (${response.status}): ${text.slice(0, 600)}`,
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  select(table, query = "select=*") {
    return this.request(`${table}?${query}`);
  }

  insert(table, rows, { onConflict } = {}) {
    const params = new URLSearchParams();
    if (onConflict) params.set("on_conflict", onConflict);
    const query = params.toString();
    const prefer = onConflict
      ? "return=representation,resolution=ignore-duplicates"
      : "return=representation";
    return this.request(`${table}${query ? `?${query}` : ""}`, {
      method: "POST",
      body: rows,
      headers: { prefer },
    });
  }

  update(table, filter, patch) {
    return this.request(`${table}?${filter}`, {
      method: "PATCH",
      body: patch,
      headers: { prefer: "return=representation" },
    });
  }

  rpc(name, args) {
    return this.request(`rpc/${name}`, { method: "POST", body: args || {} });
  }
}

export const enc = (value) => encodeURIComponent(String(value));
