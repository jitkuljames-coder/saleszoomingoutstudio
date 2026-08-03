// Cloudflare Pages Function.
// Route: /api/state   (file lives at /functions/api/state.js)
//
// Talks to a D1 database bound as DB, and (optionally) forwards booking
// changes to a Google Apps Script web app for calendar sync.
//
// GET  /api/state  -> { "rows": [ { key, value, updated_at }, ... ] }
// POST /api/state  body { "rows": [ ... ] }  -> { "ok": true, "written": n }

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" }
  });
}

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

    // --- optional: forward booking changes to Google Calendar sync ---
    try {
      const hook = context.env.CALENDAR_HOOK_URL;
      if (hook) {
        const bookingRow = rows.find(function (r) { return String(r.key) === "szo.bookings.v1"; });
        if (bookingRow) {
          let bookings = [];
          try { bookings = JSON.parse(bookingRow.value || "[]"); } catch (e) { bookings = []; }
          const p = fetch(hook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: context.env.CALENDAR_TOKEN || "", bookings: bookings })
          }).catch(function () {});
          if (context.waitUntil) context.waitUntil(p);
        }
      }
    } catch (e) { /* never let calendar sync break the save */ }

    return json({ ok: true, written: rows.length });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
