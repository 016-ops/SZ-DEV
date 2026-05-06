const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");
const { ROOT, createStore } = require("./lib/store");

const PUBLIC_DIR = path.join(__dirname, "public");
const store = createStore();
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function send(res, statusCode, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function resolvePublicFile(requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, normalized));
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return fullPath;
}

function resolveMediaFile(requestPath) {
  const fileName = decodeURIComponent(requestPath.replace(/^\/media\//, ""));
  const fullPath = path.normalize(path.join(ROOT, fileName));
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, 200, store.dashboard());
    }

    if (pathname === "/api/profile" && req.method === "POST") {
      return sendJson(res, 200, store.updateProfile(await readBody(req)));
    }

    if (pathname === "/api/targets" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, store.replaceTargets(Array.isArray(body) ? body : body.targets || []));
    }

    if (pathname === "/api/workflow" && req.method === "POST") {
      return sendJson(res, 200, store.updateWorkflow(await readBody(req)));
    }

    if (pathname === "/api/simulate/refresh" && req.method === "POST") {
      return sendJson(res, 200, store.simulateRefresh());
    }

    if (pathname === "/api/simulate/run" && req.method === "POST") {
      return sendJson(res, 200, store.simulateRun());
    }

    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";

  if (pathname.startsWith("/api/")) {
    return handleApi(req, res, pathname);
  }

  if (pathname.startsWith("/media/")) {
    const filePath = resolveMediaFile(pathname);
    if (!filePath || !fs.existsSync(filePath)) return sendJson(res, 404, { error: "Not found" });
    const ext = path.extname(filePath).toLowerCase();
    return send(res, 200, fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
  }

  const filePath = resolvePublicFile(pathname);
  if (!filePath || !fs.existsSync(filePath)) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  return send(res, 200, fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Preview server listening on http://127.0.0.1:${PORT}`);
});
