import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { annotateChangedLines } from "../src/pull-updater";
import { BuildDiagnostic } from "../src/report";

jest.mock("@actions/core", () => ({ info: jest.fn() }), { virtual: true });
jest.mock(
    "@actions/github",
    () => ({
        context: { repo: { owner: "dotnet", repo: "docs" } },
        getOctokit: () => mockOctokit,
    }),
    { virtual: true },
);

const create =
    jest.fn<(...args: unknown[]) => Promise<{ data: { id: number } }>>();
const update = jest.fn<(...args: unknown[]) => Promise<void>>();
const listFiles = jest.fn();
const listChecks = jest.fn();
const paginate = jest.fn<(route: unknown) => Promise<unknown[]>>();
const mockOctokit = {
    rest: {
        pulls: { listFiles },
        checks: { create, update, listForRef: listChecks },
    },
    paginate,
};

describe("changed-line annotations", () => {
    let files: { filename: string; patch?: string }[];
    let checks: {
        id: number;
        external_id: string;
        status: string;
        conclusion: string | null;
    }[];
    const externalId = "ops-build-report:7:123:1";
    const diagnostic = (
        line: number,
        severity: BuildDiagnostic["severity"] = "Warning",
    ): BuildDiagnostic => ({
        path: "docs/a.md",
        line,
        severity,
        message: `Issue at ${line}.`,
    });
    const publish = (diagnostics: BuildDiagnostic[]) =>
        annotateChangedLines(
            "token",
            7,
            "a".repeat(40),
            diagnostics,
            "https://buildapi.docs.microsoft.com/Output/BuildReport",
            externalId,
        );

    beforeEach(() => {
        files = [
            {
                filename: "docs/a.md",
                patch: "@@ -1 +1,4 @@\n unchanged\n+line2\n+line3\n+line4",
            },
        ];
        checks = [];
        create.mockResolvedValue({ data: { id: 99 } });
        paginate.mockImplementation(async (route) =>
            route === listFiles ? files : checks,
        );
    });

    it("maps all severities and excludes diagnostics outside added lines", async () => {
        await publish([
            diagnostic(1),
            diagnostic(2, "Error"),
            diagnostic(3, "Warning"),
            diagnostic(4, "Suggestion"),
            diagnostic(90),
        ]);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                head_sha: "a".repeat(40),
                status: "in_progress",
                external_id: externalId,
                output: expect.objectContaining({
                    annotations: [
                        expect.objectContaining({
                            start_line: 2,
                            annotation_level: "failure",
                        }),
                        expect.objectContaining({
                            start_line: 3,
                            annotation_level: "warning",
                        }),
                        expect.objectContaining({
                            start_line: 4,
                            annotation_level: "notice",
                        }),
                    ],
                }),
            }),
        );
        expect(update).toHaveBeenLastCalledWith(
            expect.objectContaining({
                check_run_id: 99,
                status: "completed",
                conclusion: "neutral",
            }),
        );
    });

    it("batches more than 50 annotations without losing the remainder", async () => {
        files = [
            {
                filename: "docs/a.md",
                patch:
                    "@@ -0,0 +1,51 @@\n" + Array(51).fill("+added").join("\n"),
            },
        ];
        await publish(
            Array.from({ length: 51 }, (_, index) => diagnostic(index + 1)),
        );
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                output: expect.objectContaining({
                    annotations: expect.arrayContaining([
                        expect.objectContaining({ start_line: 50 }),
                    ]),
                }),
            }),
        );
        expect(create.mock.calls[0][0]).toHaveProperty(
            "output.annotations.length",
            50,
        );
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                output: expect.objectContaining({
                    annotations: [expect.objectContaining({ start_line: 51 })],
                }),
            }),
        );
        expect(update).toHaveBeenCalledTimes(2);
    });

    it("does not duplicate successfully published annotations on publisher reruns", async () => {
        checks = [
            {
                id: 1,
                external_id: externalId,
                status: "completed",
                conclusion: "neutral",
            },
        ];
        await publish([diagnostic(2)]);
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it("retries an interrupted publication rather than silently accepting a partial check", async () => {
        checks = [
            {
                id: 1,
                external_id: externalId,
                status: "in_progress",
                conclusion: null,
            },
        ];
        await publish([diagnostic(2)]);
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                check_run_id: 1,
                status: "completed",
                conclusion: "cancelled",
            }),
        );
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("completes a neutral check with no matching diagnostics and propagates upload errors", async () => {
        await publish([diagnostic(90)]);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                output: expect.objectContaining({ annotations: [] }),
            }),
        );
        create.mockRejectedValueOnce(new Error("checks forbidden"));
        await expect(publish([diagnostic(2)])).rejects.toThrow(
            "checks forbidden",
        );
    });
});
