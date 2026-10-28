import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PassThrough } from "stream";
import { mkdir, writeFile } from "fs/promises";
import { getInput, setOutput } from "@actions/core";
import { context } from "@actions/github";
import { createBuildReport } from "../src/pull-updater";

jest.mock(
    "@actions/core",
    () => ({ getInput: jest.fn(), setOutput: jest.fn(), info: jest.fn() }),
    { virtual: true },
);
jest.mock(
    "@actions/github",
    () => ({
        context: {
            repo: { owner: "dotnet", repo: "docs" },
            eventName: "pull_request",
            payload: {
                pull_request: { number: 7, head: { sha: "a".repeat(40) } },
            },
            runId: 123,
        },
        getOctokit: () => mockOctokit,
    }),
    { virtual: true },
);
jest.mock("fs/promises", () => ({ mkdir: jest.fn(), writeFile: jest.fn() }));
jest.mock("https", () => ({ get: (...args: unknown[]) => mockGet(...args) }));

const status = jest.fn<
    (...args: unknown[]) => Promise<{
        data: {
            statuses: {
                context: string;
                state: string;
                target_url: string;
            }[];
        };
    }>
>();
const updatePull = jest.fn();
const createCheck = jest.fn();
const mockOctokit = {
    rest: {
        repos: { getCombinedStatusForRef: status },
        pulls: { update: updatePull },
        checks: { create: createCheck },
    },
};
const mockGet = jest.fn<(...args: unknown[]) => PassThrough>();

describe("artifact producer", () => {
    let response: PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
    };
    let request: PassThrough & { setTimeout: ReturnType<typeof jest.fn> };

    beforeEach(() => {
        context.eventName = "pull_request";
        process.env.GITHUB_RUN_ATTEMPT = "1";
        jest.mocked(getInput).mockImplementation(
            (name) =>
                ({
                    output_directory: "reports",
                    max_wait_time_minutes: "1",
                })[name] ?? "",
        );
        status.mockResolvedValue({
            data: {
                statuses: [
                    {
                        context: "OpenPublishing.Build",
                        state: "failure",
                        target_url:
                            "https://buildapi.docs.microsoft.com/Output/BuildReport",
                    },
                ],
            },
        });
        response = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: {},
        });
        request = Object.assign(new PassThrough(), { setTimeout: jest.fn() });
        mockGet.mockImplementation((_url, onResponse) => {
            if (typeof onResponse !== "function") {
                throw new Error("Missing response callback.");
            }
            onResponse(response);
            const currentResponse = response;
            process.nextTick(() =>
                currentResponse.end(`
                <table><tr><td>File</td><td>Status</td><td>Details</td></tr>
                <tr><td>docs/a.md</td><td>Error</td>
                <td>Line 2: [Error] Fix this. Line 90: [Suggestion] Add metadata.</td></tr></table>`),
            );
            return request;
        });
    });

    it("writes all diagnostics from failed builds even without preview links, and never writes to GitHub", async () => {
        await createBuildReport("read-only-token");
        expect(status).toHaveBeenCalledWith({
            owner: "dotnet",
            repo: "docs",
            ref: "a".repeat(40),
        });
        expect(mkdir).toHaveBeenCalledWith("reports", { recursive: true });
        const json = jest
            .mocked(writeFile)
            .mock.calls.find(([path]) =>
                String(path).endsWith("report.json"),
            )?.[1];
        expect(typeof json).toBe("string");
        const report = JSON.parse(String(json));
        expect(report).toMatchObject({
            version: 1,
            pullNumber: 7,
            headSha: "a".repeat(40),
            runId: 123,
            runAttempt: 1,
            previewLinks: [],
        });
        expect(report.diagnostics).toEqual([
            {
                path: "docs/a.md",
                line: 2,
                severity: "Error",
                message: "Fix this.",
            },
            {
                path: "docs/a.md",
                line: 90,
                severity: "Suggestion",
                message: "Add metadata.",
            },
        ]);
        expect(writeFile).toHaveBeenCalledWith(
            expect.stringMatching(/preview\.md$/),
            expect.stringContaining("[Build report]"),
            "utf8",
        );
        expect(setOutput).toHaveBeenCalledWith("artifact_path", "reports");
        expect(updatePull).not.toHaveBeenCalled();
        expect(createCheck).not.toHaveBeenCalled();
    });

    it.each(["pull_request_target", "workflow_run", "push"])(
        "rejects the %s context",
        async (event) => {
            context.eventName = event;
            await expect(createBuildReport("token")).rejects.toThrow(
                "pull_request",
            );
            expect(writeFile).not.toHaveBeenCalled();
        },
    );

    it("fails explicitly for HTTP errors rather than emitting success-shaped artifacts", async () => {
        response.statusCode = 403;
        await expect(createBuildReport("token")).rejects.toThrow("HTTP 403");
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("propagates status API failures", async () => {
        status.mockRejectedValueOnce(new Error("status forbidden"));
        await expect(createBuildReport("token")).rejects.toThrow(
            "status forbidden",
        );
        expect(setOutput).not.toHaveBeenCalled();
    });

    it("propagates filesystem failures", async () => {
        jest.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
        await expect(createBuildReport("token")).rejects.toThrow("disk full");
        expect(setOutput).not.toHaveBeenCalled();
    });

    it("fails with a clear timeout if OPS never reports a completed status", async () => {
        jest.useFakeTimers();
        status.mockResolvedValue({ data: { statuses: [] } });
        const result = expect(createBuildReport("token")).rejects.toThrow(
            "Unable to find a completed",
        );
        await jest.runAllTimersAsync();
        await result;
        expect(status).toHaveBeenCalledTimes(3);
        expect(writeFile).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
