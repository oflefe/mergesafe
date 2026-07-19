import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PolicyConfigError, PolicyLoader } from "../../../src/verification/policy-loader";

describe("PolicyLoader", () => {
  it("returns the default policy when no repository policy is provided", () => {
    const policy = new PolicyLoader().load(undefined);

    expect(policy).toEqual(
      expect.objectContaining({
        version: 1,
        rules: [],
      }),
    );
  });

  it("returns the default policy for whitespace-only repository policy content", () => {
    const policy = new PolicyLoader().load(" \n\t ");

    expect(policy.rules).toEqual([]);
  });

  it("loads the checked-in policy file when its contents are provided", () => {
    const policyText = readFileSync(
      resolve(process.cwd(), "../../.agent-pr-verifier.yml"),
      "utf8",
    );
    const policy = new PolicyLoader().load(policyText);

    expect(policy.version).toBe(1);
    expect(policy.rules.length).toBeGreaterThan(0);
  });

  it("rejects invalid repository policy content", () => {
    expect(() =>
      new PolicyLoader().load("version: 2\nrules: []\n"),
    ).toThrow(PolicyConfigError);
  });
});
