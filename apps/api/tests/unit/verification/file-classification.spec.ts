import { ChangedFile } from "../domain/types";
import {
  classifyChangedFile,
  classifyChangedFiles,
} from "./file-classification";

describe("classifyChangedFile", () => {
  it("GIVEN a TypeScript source file WHEN classified THEN it is source", () => {
    expect(classifyChangedFile({ path: "src/app.ts", additions: 3, deletions: 1 })).toEqual({
      path: "src/app.ts",
      kind: "source",
      additions: 3,
      deletions: 1,
      lineDelta: 4,
    });
  });

  it("GIVEN a Python source file WHEN classified THEN it is source", () => {
    expect(classifyChangedFile({ path: "src/app.py" }).kind).toBe("source");
  });

  it("GIVEN a test file WHEN classified THEN test priority wins", () => {
    expect(classifyChangedFile({ path: "src/app.spec.ts" }).kind).toBe("test");
  });

  it("GIVEN Markdown documentation WHEN classified THEN it is documentation", () => {
    expect(classifyChangedFile({ path: "docs/README.md" }).kind).toBe(
      "documentation",
    );
  });

  it.each([
    "Dockerfile",
    "docker-compose.yml",
    ".github/workflows/ci.yml",
    ".env.example",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
  ])(
    "GIVEN %s WHEN classified THEN it is configuration",
    (path) => {
      expect(classifyChangedFile({ path }).kind).toBe("configuration");
    },
  );

  it("GIVEN an unrelated asset WHEN classified THEN it is other", () => {
    expect(classifyChangedFile({ path: "public/logo.svg" }).kind).toBe("other");
  });

  it("GIVEN Windows separators and missing counts WHEN classified THEN the result is normalized and zero-filled", () => {
    expect(classifyChangedFile({ path: "src\\app.ts" })).toEqual({
      path: "src/app.ts",
      kind: "source",
      additions: 0,
      deletions: 0,
      lineDelta: 0,
    });
  });

  it("GIVEN multiple files WHEN classified THEN results are deterministic", () => {
    const files: ChangedFile[] = [
      { path: "z.ts" },
      { path: "a.md" },
      { path: "b.spec.ts" },
    ];

    expect(classifyChangedFiles(files).map((file) => file.path)).toEqual([
      "a.md",
      "b.spec.ts",
      "z.ts",
    ]);
  });
});
