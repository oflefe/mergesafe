import { PolicyLoader } from "./policy-loader";

describe("PolicyLoader", () => {
  it("loads the checked-in policy file from the repo root successfully", () => {
    const policy = new PolicyLoader().load();

    expect(policy.version).toBe(1);
    expect(policy.rules.length).toBeGreaterThan(0);
  });
});
