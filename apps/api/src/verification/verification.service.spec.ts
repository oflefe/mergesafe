import { VerificationService } from "./verification.service";
import { PolicyConfigError, PolicyLoader } from "./policy-loader";
import { Verdict } from "../domain/types";
import { safeDocsPr } from "../../test/fixtures/pull-request.fixtures";

describe("VerificationService", () => {
  it("does not return policy-config-invalid for the checked-in policy file", () => {
    const service = new VerificationService(new PolicyLoader());

    const result = service.verify({
      ...safeDocsPr,
    });

    expect(result.policyFailures.map((failure) => failure.code)).not.toContain(
      "policy-config-invalid",
    );
  });

  it("fails safely when the policy config is invalid", () => {
    const policyLoader = {
      load: () => {
        throw new PolicyConfigError(
          "Invalid policy config: version must be 1.",
        );
      },
    } as unknown as PolicyLoader;
    const service = new VerificationService(policyLoader);

    const result = service.verify({
      ...safeDocsPr,
      policyText: "version: 2\nrules: []\n",
    });

    expect(result.verdict).toBe(Verdict.FAIL);
    expect(result.checkConclusion).toBe("failure");
    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "policy-config-invalid",
          verdict: Verdict.FAIL,
          message: "Invalid policy config: version must be 1.",
        }),
      ]),
    );
    expect(result.commentBody).toContain(
      "Invalid policy config: version must be 1.",
    );
  });
});
