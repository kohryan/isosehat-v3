import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import http from "node:http";

const port = Number(process.env.PORT || 8080);
const distDir = join(process.cwd(), "dist");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendFile(res, filePath) {
  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const requestUrl = req.url || "/";
  const requestPath = requestUrl.split("?")[0];
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const relativePath = safePath === "/" ? "index.html" : safePath.replace(/^[/\\]+/, "");
  let filePath = join(distDir, relativePath);

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const fallbackFile = join(distDir, "index.html");
  if (existsSync(fallbackFile)) {
    sendFile(res, fallbackFile);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Build output not found.");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Frontend server running on http://0.0.0.0:${port}`);
});
