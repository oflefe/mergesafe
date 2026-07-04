import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

type Environment = NodeJS.ProcessEnv;

const REQUIRED_PRODUCTION_VARIABLES = [
  "DASHBOARD_ORIGIN",
  "ADMIN_API_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
] as const;

export function isProduction(env: Environment = process.env): boolean {
  return (env.NODE_ENV ?? "").toLowerCase() === "production";
}

export function validateEnvironment(env: Environment = process.env): void {
  if (!isProduction(env)) {
    return;
  }

  const missing = REQUIRED_PRODUCTION_VARIABLES.filter(
    (name) => !env[name] || env[name]?.trim().length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(", ")}`,
    );
  }
}

export function resolveCorsOrigin(
  env: Environment = process.env,
): string | boolean {
  const configuredOrigin = env.DASHBOARD_ORIGIN?.trim();
  if (configuredOrigin) {
    return configuredOrigin;
  }
  return isProduction(env) ? false : true;
}

function isWebhookRoute(pathname: string): boolean {
  return pathname === "/webhooks/github" || pathname === "/webhooks/github/";
}

function readAdminTokenFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const rawAdminToken = headers["x-admin-api-token"];
  if (typeof rawAdminToken === "string" && rawAdminToken.trim().length > 0) {
    return rawAdminToken;
  }

  const authorization = headers.authorization;
  if (typeof authorization !== "string") {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  return match[1].trim();
}

export function applySecurity(
  app: NestFastifyApplication,
  env: Environment = process.env,
): void {
  app.enableCors({
    origin: resolveCorsOrigin(env),
  });

  const server = app.getHttpAdapter().getInstance();
  server.addHook("onRequest", (request: any, reply: any, done: () => void) => {
    if (!isProduction(env)) {
      done();
      return;
    }

    const method = String(request.method ?? "GET").toUpperCase();
    if (method === "OPTIONS") {
      done();
      return;
    }

    const fullUrl =
      typeof request.url === "string"
        ? request.url
        : typeof request.raw?.url === "string"
          ? request.raw.url
          : "";
    const pathname = fullUrl.split("?")[0] ?? "";
    if (isWebhookRoute(pathname)) {
      done();
      return;
    }

    const expectedToken = env.ADMIN_API_TOKEN;
    const providedToken = readAdminTokenFromHeaders(
      request.headers as Record<string, string | string[] | undefined>,
    );

    if (
      !expectedToken ||
      expectedToken.trim().length === 0 ||
      providedToken !== expectedToken
    ) {
      void reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    done();
  });
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  validateEnvironment(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );

  applySecurity(app, process.env);
  await app.listen(Number(process.env.PORT ?? 3001));
  return app;
}
