// Cloudflare Pages Function.
// Route: /api/state   (file lives at /functions/api/state.js)

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" }
  });
}

// GET: return every stored row.
export async function onRequestGet(context) {
  try {
    const result = await context.env.DB
      .prepare("SELECT key, value, updated_at FROM app_state")
      .all();
    return json({ rows: result.results || [] });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

// POST: insert or update each row by its key.
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const rows = (body && Array.isArray(body.rows)) ? body.rows : [];
    if (!rows.length) return json({ ok: true, written: 0 });

    const stmt = context.env.DB.prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    const batch = rows.map(function (r) {
      return stmt.bind(
        String(r.key),
        r.value == null ? "" : String(r.value),
        r.updated_at || new Date().toISOString()
      );
    });

    await context.env.DB.batch(batch);
    return json({ ok: true, written: rows.length });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
