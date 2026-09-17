import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 4300);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const app = createApp({
  frappeUrl: process.env.FRAPPE_URL || "https://erp-test.metaframer.net",
  origin,
  sessionSecret: process.env.SESSION_SECRET || "",
  catalogSecret: process.env.CATALOG_SHARED_SECRET,
  catalogToken:
    process.env.FRAPPE_CATALOG_TOKEN ||
    (process.env.FRAPPE_CATALOG_API_KEY && process.env.FRAPPE_CATALOG_API_SECRET
      ? `${process.env.FRAPPE_CATALOG_API_KEY}:${process.env.FRAPPE_CATALOG_API_SECRET}`
      : undefined),
  enableLocalSetup: process.env.ENABLE_LOCAL_SETUP === "1",
  storefrontUrl: process.env.LOCAL_STOREFRONT_URL || "http://localhost:4301",
  publicGroup: process.env.CATALOG_ITEM_GROUP || "Metaframer Demo",
  production,
});
if (production) {
  app.use(express.static(path.join(root, "dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist/client/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { port: 24300 } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.info(`Metaframer admin: ${origin}`),
);
