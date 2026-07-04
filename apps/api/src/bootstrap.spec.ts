import {
  loadEnvironment,
  resolveCorsOrigin,
  validateEnvironment,
} from "./bootstrap";

describe("bootstrap security configuration", () => {
  it("GIVEN DASHBOARD_ORIGIN is configured WHEN resolving CORS origin THEN it uses that exact origin", () => {
    const origin = resolveCorsOrigin({
      DASHBOARD_ORIGIN: "https://dashboard.example.com",
    });

    expect(origin).toBe("https://dashboard.example.com");
  });

  it("GIVEN production mode with missing required secrets WHEN validating environment THEN startup fails", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DASHBOARD_ORIGIN: "https://dashboard.example.com",
        ADMIN_API_TOKEN: "token",
      }),
    ).toThrow(
      "Missing required environment variables in production: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET",
    );
  });

  it("GIVEN existing env files with duplicates WHEN loading environment THEN each existing file is loaded once", () => {
    const loadedPaths: string[] = [];

    loadEnvironment({
      envFileCandidates: ["/tmp/.env", "/tmp/.env", "/tmp/.env.local"],
      envFileExists: (envFilePath) => envFilePath !== "/tmp/.env.local",
      envFileLoader: (envFilePath) => {
        loadedPaths.push(envFilePath);
      },
    });

    expect(loadedPaths).toEqual(["/tmp/.env"]);
  });

  it("GIVEN no env files exist WHEN loading environment THEN it safely does nothing", () => {
    expect(() =>
      loadEnvironment({
        envFileCandidates: ["/tmp/.env"],
        envFileExists: () => false,
      }),
    ).not.toThrow();
  });
});
