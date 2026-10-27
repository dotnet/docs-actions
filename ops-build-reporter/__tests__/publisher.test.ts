import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
    publishBuildReport,
    validatePublicationIdentity,
} from "../src/publisher";
import { BuildReport, MAX_REPORT_BYTES } from "../src/report";

jest.mock(
    "@actions/core",
    () => ({
        getInput: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
    }),
    { virtual: true },
);
jest.mock(
    "@actions/github",
    () => ({
        context: {
            repo: { owner: "dotnet", repo: "docs" },
            payload: { workflow_run: { id: 123 } },
            eventName: "workflow_run",
        },
        getOctokit: () => mockOctokit,
    }),
    { virtual: true },
);
jest.mock("fs/promises", () => ({ lstat: jest.fn(), readFile: jest.fn() }));
jest.mock("../src/pull-updater", () => ({ annotateChangedLines: jest.fn() }));

import { getInput, warning } from "@actions/core";
import { context } from "@actions/github";
import { lstat, readFile } from "fs/promises";
import { annotateChangedLines } from "../src/pull-updater";

const workflowFile = ".github/workflows/ops-build-reporter.yml";
const sha = "a".repeat(40);
const makeReport = (): BuildReport => ({
    version: 1,
    repository: "dotnet/docs",
    pullNumber: 7,
    headSha: sha,
    runId: 123,
    runAttempt: 1,
    buildReportUrl: "https://buildapi.docs.microsoft.com/Output/BuildReport",
    previewLinks: [],
    diagnostics: [
        { path: "docs/a.md", line: 2, severity: "Warning", message: "Fix." },
    ],
    collapsibleAfter: 12,
    maxRowCount: 50,
});
const makeRun = () => ({
    id: 123,
    run_attempt: 1,
    event: "pull_request",
    status: "completed",
    conclusion: "failure",
    path: workflowFile,
    head_sha: sha,
    head_branch: "feature",
    repository: { full_name: "dotnet/docs" },
    head_repository: { full_name: "contributor/docs", id: 42 },
    pull_requests: [] as { number: number }[],
});
const makePull = () => ({
    number: 7,
    state: "open",
    body: "Latest user edit.",
    base: { repo: { full_name: "dotnet/docs" } },
    head: { sha, ref: "feature", repo: { id: 42 } },
});

const getRun =
    jest.fn<
        (...args: unknown[]) => Promise<{ data: ReturnType<typeof makeRun> }>
    >();
const getPull =
    jest.fn<
        (...args: unknown[]) => Promise<{ data: ReturnType<typeof makePull> }>
    >();
const updatePull = jest.fn<(...args: unknown[]) => Promise<void>>();
const paginate =
    jest.fn<(...args: unknown[]) => Promise<ReturnType<typeof makePull>[]>>();
const mockOctokit = {
    rest: {
        actions: { getWorkflowRun: getRun },
        pulls: { get: getPull, update: updatePull, list: jest.fn() },
    },
    paginate,
};

describe("publication identity", () => {
    it("accepts failed validation runs from an associated fork PR", () => {
        expect(
            validatePublicationIdentity(
                makeReport(),
                makeRun(),
                makePull(),
                "dotnet/docs",
                workflowFile,
                [7],
            ),
        ).toBe(true);
    });
    it.each([
        { event: "push" },
        { path: ".github/workflows/evil.yml" },
        { repository: { full_name: "attacker/docs" } },
        { conclusion: "cancelled" },
        { status: "in_progress" },
        { head_sha: "b".repeat(40) },
        { run_attempt: 2 },
        { head_repository: { id: 99, full_name: "attacker/docs" } },
        { head_branch: "other" },
    ])("rejects forged or unauthorized run metadata: %j", (change) => {
        expect(() =>
            validatePublicationIdentity(
                makeReport(),
                { ...makeRun(), ...change },
                makePull(),
                "dotnet/docs",
                workflowFile,
                [7],
            ),
        ).toThrow();
    });
    it("rejects forged PR and run IDs and repository targets", () => {
        for (const change of [
            { pullNumber: 8 },
            { runId: 999 },
            { repository: "attacker/docs" },
        ]) {
            expect(() =>
                validatePublicationIdentity(
                    { ...makeReport(), ...change },
                    makeRun(),
                    makePull(),
                    "dotnet/docs",
                    workflowFile,
                    [7],
                ),
            ).toThrow();
        }
        expect(() =>
            validatePublicationIdentity(
                makeReport(),
                makeRun(),
                makePull(),
                "dotnet/docs",
                workflowFile,
                [8],
            ),
        ).toThrow();
    });
    it("skips closed PRs and superseded SHAs", () => {
        for (const pull of [
            { ...makePull(), state: "closed" },
            {
                ...makePull(),
                head: { ...makePull().head, sha: "b".repeat(40) },
            },
        ]) {
            expect(
                validatePublicationIdentity(
                    makeReport(),
                    makeRun(),
                    pull,
                    "dotnet/docs",
                    workflowFile,
                    [7],
                ),
            ).toBe(false);
        }
    });
});

describe("publisher orchestration", () => {
    beforeEach(() => {
        context.eventName = "workflow_run";
        jest.mocked(getInput).mockImplementation(
            (name) =>
                ({
                    producer_workflow_file: workflowFile,
                    artifact_directory: "artifact",
                    annotate_file_warnings: "true",
                })[name] ?? "",
        );
        getRun.mockResolvedValue({ data: makeRun() });
        getPull.mockResolvedValue({ data: makePull() });
        paginate.mockResolvedValue([makePull()]);
        jest.mocked(lstat).mockResolvedValue({
            isFile: () => true,
            isSymbolicLink: () => false,
            size: 100,
        } as Awaited<ReturnType<typeof lstat>>);
        jest.mocked(readFile).mockResolvedValue(JSON.stringify(makeReport()));
    });

    it("publishes failed-build diagnostics without previews and merges the latest body", async () => {
        await publishBuildReport("token");
        expect(getRun).toHaveBeenCalledWith({
            owner: "dotnet",
            repo: "docs",
            run_id: 123,
        });
        expect(paginate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                head: "contributor:feature",
                state: "open",
            }),
        );
        expect(updatePull).toHaveBeenCalledWith(
            expect.objectContaining({
                pull_number: 7,
                body: expect.stringContaining("Latest user edit."),
            }),
        );
        expect(annotateChangedLines).toHaveBeenCalledWith(
            "token",
            7,
            sha,
            makeReport().diagnostics,
            makeReport().buildReportUrl,
            "ops-build-report:7:123:1",
        );
    });
    it("uses explicit run associations when available", async () => {
        getRun.mockResolvedValue({
            data: { ...makeRun(), pull_requests: [{ number: 7 }] },
        });
        await publishBuildReport("token");
        expect(paginate).not.toHaveBeenCalled();
        expect(updatePull).toHaveBeenCalledTimes(1);
    });

    it("rejects fallback PR candidates with a different fork, branch, or SHA", async () => {
        for (const head of [
            { ...makePull().head, repo: { id: 99 } },
            { ...makePull().head, ref: "other-branch" },
            { ...makePull().head, sha: "b".repeat(40) },
        ]) {
            paginate.mockResolvedValue([{ ...makePull(), head }]);
            await expect(publishBuildReport("token")).rejects.toThrow(
                "not associated",
            );
        }
        expect(updatePull).not.toHaveBeenCalled();
        expect(annotateChangedLines).not.toHaveBeenCalled();
    });
    it("skips annotations when disabled in trusted workflow inputs", async () => {
        jest.mocked(getInput).mockImplementation(
            (name) =>
                ({
                    producer_workflow_file: workflowFile,
                    artifact_directory: "artifact",
                })[name] ?? "",
        );
        await publishBuildReport("token");
        expect(annotateChangedLines).not.toHaveBeenCalled();
    });
    it("does not write for stale results", async () => {
        paginate.mockResolvedValue([]);
        getPull.mockResolvedValue({
            data: {
                ...makePull(),
                head: { ...makePull().head, sha: "b".repeat(40) },
            },
        });
        await publishBuildReport("token");
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("stale"));
        expect(updatePull).not.toHaveBeenCalled();
        expect(annotateChangedLines).not.toHaveBeenCalled();
    });

    it("skips closed fork PRs even when there are no open branch associations", async () => {
        paginate.mockResolvedValue([]);
        getPull.mockResolvedValue({ data: { ...makePull(), state: "closed" } });
        await publishBuildReport("token");
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("closed"));
        expect(updatePull).not.toHaveBeenCalled();
    });
    it("does not read artifacts for cancelled runs", async () => {
        getRun.mockResolvedValue({
            data: { ...makeRun(), conclusion: "cancelled" },
        });
        await publishBuildReport("token");
        expect(readFile).not.toHaveBeenCalled();
        expect(updatePull).not.toHaveBeenCalled();
    });
    it.each(["pull_request", "pull_request_target"])(
        "rejects the %s context",
        async (event) => {
            context.eventName = event;
            await expect(publishBuildReport("token")).rejects.toThrow(
                "workflow_run",
            );
            expect(updatePull).not.toHaveBeenCalled();
        },
    );
    it("fails explicitly for missing, malformed, or oversized artifacts", async () => {
        jest.mocked(readFile).mockResolvedValue("not json");
        await expect(publishBuildReport("token")).rejects.toThrow();
        jest.mocked(lstat).mockRejectedValueOnce(new Error("ENOENT"));
        await expect(publishBuildReport("token")).rejects.toThrow("ENOENT");
        jest.mocked(lstat).mockResolvedValue({
            isFile: () => true,
            isSymbolicLink: () => false,
            size: MAX_REPORT_BYTES + 1,
        } as Awaited<ReturnType<typeof lstat>>);
        await expect(publishBuildReport("token")).rejects.toThrow("10 MiB");
        expect(updatePull).not.toHaveBeenCalled();
    });
    it("propagates publishing API failures", async () => {
        updatePull.mockRejectedValueOnce(new Error("forbidden"));
        await expect(publishBuildReport("token")).rejects.toThrow("forbidden");
    });

    it("rejects oversized PR descriptions before attempting a write", async () => {
        getPull.mockResolvedValue({
            data: { ...makePull(), body: "x".repeat(65536) },
        });
        await expect(publishBuildReport("token")).rejects.toThrow(
            "65536-character",
        );
        expect(updatePull).not.toHaveBeenCalled();
    });

    it("rejects invalid annotation inputs before attempting a write", async () => {
        jest.mocked(getInput).mockReturnValue("not-a-boolean");
        await expect(publishBuildReport("token")).rejects.toThrow(
            "must be true or false",
        );
        expect(updatePull).not.toHaveBeenCalled();
    });
});
