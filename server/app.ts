import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { getIronSession } from "iron-session";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { ApiError, Frappe, type Credentials } from "./frappe.ts";
import type { ProductInput } from "../shared/contracts.ts";

export interface Config {
  frappeUrl: string;
  origin: string;
  sessionSecret: string;
  catalogSecret?: string;
  catalogToken?: string;
  publicGroup: string;
  production: boolean;
  enableLocalSetup?: boolean;
  storefrontUrl?: string;
}
interface SessionData {
  sid?: string;
  csrf?: string;
  user?: string;
  localCsrf?: string;
}
const querySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    group: z.string().max(140).default(""),
    status: z.enum(["all", "active", "disabled"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    sort: z.enum(["name", "-modified", "code"]).default("-modified"),
  })
  .strict();
const image = z
  .string()
  .max(2048)
  .refine(
    (v) => !v || /^https:\/\//.test(v) || /^\/files\//.test(v),
    "Görsel HTTPS adresi veya herkese açık dosya yolu olmalı.",
  )
  .nullable();
const productSchema = z
  .object({
    code: z.string().trim().min(1).max(140),
    name: z.string().trim().min(1).max(140),
    description: z.string().max(20000).default(""),
    group: z.string().trim().min(1).max(140),
    uom: z.string().trim().min(1).max(140),
    image: image.default(null),
    disabled: z.boolean().default(false),
    isStockItem: z.boolean().default(true),
  })
  .strict();
const updateSchema = productSchema
  .partial()
  .extend({ modified: z.string().min(1).max(80) })
  .strict();
const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();
function compare(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createApp(
  config: Config,
  frappe = new Frappe(config.frappeUrl),
) {
  if (config.sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters.");
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: config.production
            ? ["'self'"]
            : ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "https:", "data:"],
          connectSrc: config.production
            ? ["'self'"]
            : ["'self'", "ws:", "http://localhost:*"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  app.use(
    "/api/",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new ApiError(
            429,
            "RATE_LIMITED",
            "Çok fazla istek. Bir dakika sonra tekrar deneyin.",
          ),
        ),
    }),
  );
  const session = (req: Request, res: Response) =>
    getIronSession<SessionData>(req, res, {
      cookieName: "mf_admin_session",
      password: config.sessionSecret,
      ttl: 8 * 3600,
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
        path: "/",
      },
    });
  const requireOrigin = (req: Request) => {
    if (req.get("Origin") !== config.origin)
      throw new ApiError(
        403,
        "ORIGIN_DENIED",
        "İstek kaynağı doğrulanamadı. Sayfayı yenileyin.",
      );
  };
  async function auth(
    req: Request,
    res: Response,
    mutate = false,
  ): Promise<Credentials> {
    const current = await session(req, res);
    if (!current.sid || !current.csrf || !current.user)
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Lütfen giriş yapın.");
    if (mutate) {
      requireOrigin(req);
      if (
        !current.localCsrf ||
        !compare(req.get("X-CSRF-Token") || "", current.localCsrf)
      )
        throw new ApiError(
          403,
          "CSRF_DENIED",
          "Oturum güvenlik bilgisi geçersiz. Sayfayı yenileyin.",
        );
    }
    const credentials = { sid: current.sid, csrf: current.csrf };
    try {
      await frappe.user(credentials);
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status)) {
        current.destroy();
        throw new ApiError(
          401,
          "SESSION_EXPIRED",
          "Oturumunuz sona erdi. Tekrar giriş yapın.",
        );
      }
      throw err;
    }
    return credentials;
  }
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      service: "metaframer-admin",
      catalogConfigured: Boolean(config.catalogToken && config.catalogSecret),
    }),
  );
  app.post(
    "/api/v1/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new ApiError(
            429,
            "LOGIN_RATE_LIMITED",
            "Çok fazla giriş denemesi. Daha sonra tekrar deneyin.",
          ),
        ),
    }),
    async (req, res) => {
      requireOrigin(req);
      const { username, password } = loginSchema.parse(req.body);
      const login = await frappe.login(username, password);
      const current = await session(req, res);
      current.sid = login.sid;
      current.csrf = login.csrf;
      current.user = login.user;
      current.localCsrf = randomBytes(32).toString("hex");
      await current.save();
      res.json({ data: { user: login.user, csrfToken: current.localCsrf } });
    },
  );
  app.get("/api/v1/auth/session", async (req, res) => {
    await auth(req, res);
    const current = await session(req, res);
    res.json({ data: { user: current.user, csrfToken: current.localCsrf } });
  });
  app.post("/api/v1/auth/logout", async (req, res) => {
    const credentials = await auth(req, res, true);
    const current = await session(req, res);
    try {
      await frappe.request("/api/method/logout", credentials, {
        method: "POST",
      });
    } finally {
      current.destroy();
    }
    res.status(204).end();
  });
  app.get("/api/v1/products", async (req, res) =>
    res.json(
      await frappe.list(await auth(req, res), querySchema.parse(req.query)),
    ),
  );
  app.get("/api/v1/products/:id/variants", async (req, res) =>
    res.json(
      await frappe.variants(
        z.string().max(140).parse(req.params.id),
        await auth(req, res),
        querySchema.parse(req.query),
      ),
    ),
  );
  app.get("/api/v1/products/:id", async (req, res) =>
    res.json(
      await frappe.detail(
        z.string().max(140).parse(req.params.id),
        await auth(req, res),
      ),
    ),
  );
  app.get("/api/v1/product-options", async (req, res) =>
    res.json(await frappe.options(await auth(req, res), config.publicGroup)),
  );
  app.post("/api/v1/products", async (req, res) => {
    const credentials = await auth(req, res, true);
    const input = productSchema.parse(req.body);
    const result = await frappe.save(input as ProductInput, credentials);
    res
      .location(`/api/v1/products/${encodeURIComponent(result.data.id)}`)
      .status(201)
      .json(result);
  });
  app.patch("/api/v1/products/:id", async (req, res) => {
    const credentials = await auth(req, res, true);
    res.json(
      await frappe.save(
        updateSchema.parse(req.body),
        credentials,
        z.string().max(140).parse(req.params.id),
      ),
    );
  });
  app.delete("/api/v1/products/:id", async (req, res) => {
    const credentials = await auth(req, res, true);
    await frappe.remove(z.string().max(140).parse(req.params.id), credentials);
    res.status(204).end();
  });
  const apps = [
    ["frappe", "Frappe Framework", "/desk/system-settings"],
    ["erpnext", "ERPNext", "/desk"],
    ["payments", "Payments", "/desk/payment-gateway"],
    ["hrms", "Frappe HR", "/desk/people"],
    ["erpnext_shipping", "ERPNext Shipping", "/desk/shipment"],
    ["insights", "Insights", "/insights"],
    ["wiki", "Wiki", "/wiki-app"],
    ["crm", "Frappe CRM", "/crm"],
    ["telephony", "Telephony", "/desk/tp-call-log"],
    ["helpdesk", "Helpdesk", "/helpdesk"],
    ["gameplan", "Gameplan", "/g"],
    ["raven", "Raven", "/raven"],
    ["print_designer", "Print Designer", "/desk/print-designer"],
    ["drive", "Frappe Drive", "/drive"],
    ["tiger_integration", "LOGO Tiger", "/desk/logo-object-service-settings"],
    ["yurtici_kargo_erpnext", "Yurtiçi Kargo", "/desk/yurtici-kargo-ayarlari"],
    ["erpnextturkish", "Turkish Delight", "/desk/erpnext-turkish-settings"],
    ["metabase_integration", "Metabase", "/desk/metabase-settings"],
    [
      "ecommerce_integrations",
      "Ecommerce Integrations",
      "/desk/ecommerce-integration-log",
    ],
    ["pdf_on_submit", "PDF on Submit", "/desk/pdf-on-submit-settings"],
    [
      "dhl_ecommerce_integration",
      "DHL / MNG Cargo",
      "/desk/dhl-cargo-settings",
    ],
  ];
  app.get("/api/v1/apps", async (req, res) => {
    await auth(req, res);
    res.json({
      data: apps.map(([id, name, path]) => ({
        id,
        name,
        url: `${frappe.base}${path}`,
        mode: "native",
      })),
    });
  });
  function catalogAuth(req: Request): Credentials {
    if (!config.catalogSecret || !config.catalogToken || !config.publicGroup)
      throw new ApiError(
        503,
        "CATALOG_NOT_CONFIGURED",
        "Katalog bağlantısı henüz yapılandırılmadı.",
      );
    if (
      !compare(req.get("Authorization") || "", `Bearer ${config.catalogSecret}`)
    )
      throw new ApiError(
        401,
        "CATALOG_UNAUTHORIZED",
        "Katalog sunucusu doğrulanamadı.",
      );
    return { token: config.catalogToken };
  }
  app.get("/api/v1/catalog/products", async (req, res) => {
    const credentials = catalogAuth(req);
    const query = querySchema.parse(req.query);
    if (query.group && query.group !== config.publicGroup)
      return res.json({
        data: [],
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
          source: "frappe",
        },
      });
    res.json(await frappe.list(credentials, query, config.publicGroup));
  });
  app.get("/api/v1/catalog/products/:id/variants", async (req, res) =>
    res.json(
      await frappe.variants(
        z.string().max(140).parse(req.params.id),
        catalogAuth(req),
        querySchema.parse(req.query),
        config.publicGroup,
      ),
    ),
  );
  app.get("/api/v1/catalog/products/:id", async (req, res) =>
    res.json(
      await frappe.detail(
        z.string().max(140).parse(req.params.id),
        catalogAuth(req),
        config.publicGroup,
      ),
    ),
  );
  if (config.enableLocalSetup && !config.production) {
    app.post("/api/v1/local-setup/catalog", async (req, res) => {
      const credentials = await auth(req, res, true);
      const { provisionCatalog } = await import(
        "../scripts/provision-catalog.ts"
      );
      const result = await provisionCatalog(frappe, credentials);
      if (result.catalogToken) config.catalogToken = result.catalogToken;
      config.publicGroup = result.group;
      res.json({
        data: {
          steps: [
            `Katalog grubu: ${result.group}`,
            `Salt okunur hesap: ${result.user}`,
            `API erişimi: ${result.tokenStatus === "generated" ? "oluşturuldu" : "mevcut bağlantı"}`,
            ...result.created.map((name: string) => `Oluşturuldu: ${name}`),
          ],
        },
      });
    });
    app.post("/api/v1/local-setup/seed", async (req, res) => {
      const credentials = await auth(req, res, true);
      const { seedDemo } = await import("../scripts/seed-demo.ts");
      const result = await seedDemo(frappe, credentials);
      res.json({
        data: {
          steps: [
            `Yeni kayıt: ${result.created.length}`,
            `Mevcut örnek kayıt: ${result.existing.length}`,
            `Varyant şablonu: ${result.templateId}`,
            `Varyantlar: ${result.variantIds.join(", ")}`,
          ],
        },
      });
    });
    app.post("/api/v1/local-setup/verify", async (req, res) => {
      const credentials = await auth(req, res, true);
      if (!config.catalogToken)
        throw new ApiError(
          503,
          "CATALOG_NOT_CONFIGURED",
          "Önce katalog bağlantısını kurun.",
        );
      const { verifyLive } = await import("./live-verification.ts");
      const localOrigin = new URL(config.origin);
      if (!["localhost", "127.0.0.1"].includes(localOrigin.hostname))
        throw new ApiError(
          403,
          "LOCAL_ORIGIN_REQUIRED",
          "Doğrulama yalnızca yerel sunucuda çalışır.",
        );
      const adminCookie =
        (req.headers.cookie || "")
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith("mf_admin_session=")) || "";
      const transport = async (
        method: string,
        path: string,
        body?: unknown,
      ) => {
        const response = await fetch(new URL(path, config.origin), {
          method,
          headers: {
            Cookie: adminCookie,
            Origin: config.origin,
            "X-CSRF-Token": req.get("X-CSRF-Token") || "",
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
          redirect: "manual",
        });
        if (response.status === 204) return undefined;
        const result = (await response.json()) as any;
        if (!response.ok)
          throw new ApiError(
            response.status,
            "LIVE_ADMIN_ERROR",
            typeof result.detail === "string"
              ? result.detail
              : "Yönetim API işlemi başarısız.",
          );
        return result;
      };
      res.json({
        data: await verifyLive(
          frappe,
          credentials,
          config.publicGroup,
          config.storefrontUrl,
          transport,
        ),
      });
    });
  }
  app.use("/api/", (_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "API yolu bulunamadı.")),
  );
  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      const err =
        error instanceof ApiError
          ? error
          : error instanceof ZodError
            ? new ApiError(
                422,
                "VALIDATION_ERROR",
                error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; "),
              )
            : error instanceof SyntaxError
              ? new ApiError(
                  400,
                  "INVALID_JSON",
                  "İstek gövdesi geçerli JSON olmalı.",
                )
              : new ApiError(
                  500,
                  "INTERNAL_ERROR",
                  "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
                );
      console.info(
        JSON.stringify({
          requestId: res.locals.requestId,
          method: req.method,
          status: err.status,
          code: err.code,
        }),
      );
      res
        .status(err.status)
        .type("application/problem+json")
        .json({
          type: `urn:metaframer:error:${err.code.toLowerCase()}`,
          title: err.code,
          status: err.status,
          detail: err.message,
          requestId: res.locals.requestId,
        });
    },
  );
  return app;
}
