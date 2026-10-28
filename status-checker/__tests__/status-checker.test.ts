import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { setFailed } from "@actions/core";
import { context } from "@actions/github";
import { isSuccessStatus } from "../src/status-checker";
import { wait } from "../src/wait";

jest.mock("@actions/core", () => ({ setFailed: jest.fn() }), { virtual: true });
jest.mock(
    "@actions/github",
    () => ({
        context: {
            repo: { owner: "dotnet", repo: "docs" },
            eventName: "pull_request",
            payload: {
                number: 7,
                action: "opened",
                pull_request: { head: { sha: "a".repeat(40) } },
            },
        },
        getOctokit: () => mockOctokit,
    }),
    { virtual: true },
);
jest.mock("../src/wait", () => ({
    MILLISECONDS_PER_MINUTE: 60000,
    MILLISECONDS_PER_SECOND: 1000,
    POLLING_INTERVAL_MILLISECONDS: 15000,
    wait: jest.fn(),
}));

type Status = { context: string; state: string; description: string };
const paginate = jest.fn<(...args: unknown[]) => Promise<Status[]>>();
const statuses = jest.fn();
const mockOctokit = {
    rest: { repos: { listCommitStatusesForRef: statuses } },
    paginate,
};

describe("read-only build validation", () => {
    const ops = (
        state: string,
        description = "Validation status: passed",
    ): Status[] => [{ context: "OpenPublishing.Build", state, description }];

    beforeEach(() => {
        context.eventName = "pull_request";
        paginate.mockResolvedValue(ops("success"));
    });

    it("uses the PR head SHA, not the merge-context SHA, and only reads statuses", async () => {
        expect(await isSuccessStatus("read-only-token")).toBe(true);
        expect(paginate).toHaveBeenCalledWith(statuses, {
            owner: "dotnet",
            repo: "docs",
            ref: "a".repeat(40),
            per_page: 100,
        });
        expect(setFailed).not.toHaveBeenCalled();
    });
    it("fails on warnings but not on suggestions alone", async () => {
        paginate.mockResolvedValueOnce(
            ops("success", "Validation status: warnings"),
        );
        expect(await isSuccessStatus("token")).toBe(false);
        expect(setFailed).toHaveBeenCalledWith(
            expect.stringContaining("Please fix OPS build warnings"),
        );
        paginate.mockResolvedValueOnce(
            ops("success", "Validation status: suggestions"),
        );
        expect(await isSuccessStatus("token")).toBe(true);
    });
    it.each(["error", "failure"])("fails on build %s", async (state) => {
        paginate.mockResolvedValue(ops(state));
        expect(await isSuccessStatus("token")).toBe(false);
        expect(setFailed).toHaveBeenCalledWith(
            "OpenPublishing.Build status is either failure or error.",
        );
    });
    it("polls until a pending build completes", async () => {
        paginate
            .mockResolvedValueOnce(ops("pending"))
            .mockResolvedValueOnce(ops("success"));
        expect(await isSuccessStatus("token")).toBe(true);
        expect(wait).toHaveBeenCalledTimes(1);
    });
    it("reports missing OPS status explicitly without dereferencing undefined", async () => {
        paginate.mockResolvedValue([]);
        expect(await isSuccessStatus("token")).toBe(false);
        expect(paginate).toHaveBeenCalledTimes(31);
        expect(setFailed).toHaveBeenCalledWith(
            expect.stringContaining("Did not find OPS status check"),
        );
    });
    it("propagates status API errors", async () => {
        paginate.mockRejectedValueOnce(new Error("forbidden"));
        await expect(isSuccessStatus("token")).rejects.toThrow("forbidden");
    });
});
