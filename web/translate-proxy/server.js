// server.js — LibreTranslate Proxy (CommonJS, Node.js v22+)

const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 8787;
const UPSTREAM = process.env.UPSTREAM_URL || "https://libretranslate.com/translate";
const LIBRE_KEY = process.env.LIBRE_KEY || ""; // optional

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function send(res, status, body, extra = {}) {
  const headers = { "Content-Type": "application/json", ...CORS, ...extra };
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, upstream: UPSTREAM, key: !!LIBRE_KEY });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method !== "POST" || url.pathname !== "/translate") {
    return send(res, 405, { error: "Use POST /translate" });
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    console.log("📩 Raw body:", raw);

    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error("❌ Invalid JSON:", e.message);
      return send(res, 400, { error: "Invalid JSON", detail: String(e) });
    }

    if (!payload.q) {
      return send(res, 400, { error: "Missing 'q' field in request" });
    }

    if (!payload.api_key && LIBRE_KEY) payload.api_key = LIBRE_KEY;

    try {
      const upstreamRes = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await upstreamRes.text();
      console.log("✅ Upstream response:", text);
      return send(res, upstreamRes.status, text);
    } catch (e) {
      console.error("❌ Upstream error:", e.message);
      return send(res, 502, { error: "Upstream failed", detail: String(e) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Proxy running at http://localhost:${PORT}/translate → ${UPSTREAM}`);
});
