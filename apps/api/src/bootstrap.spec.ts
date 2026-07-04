import { resolveCorsOrigin, validateEnvironment } from "./bootstrap";

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
});
