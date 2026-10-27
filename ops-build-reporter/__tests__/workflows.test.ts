import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

const { load }: { load: (text: string) => unknown } = require("js-yaml");
const workflow = (name: string) =>
    load(
        readFileSync(
            resolve(__dirname, "..", "..", ".github", "workflows", name),
            "utf8",
        ),
    );

describe("reusable workflow contracts", () => {
    it("collects artifacts and validates independently using only read permissions", () => {
        expect(workflow("ops-build-report.yml")).toMatchObject({
            on: { workflow_call: expect.anything() },
            permissions: { statuses: "read" },
            jobs: {
                collect: {
                    steps: expect.arrayContaining([
                        expect.objectContaining({
                            uses: "dotnet/docs-actions/ops-build-reporter@main",
                        }),
                        expect.objectContaining({
                            with: expect.objectContaining({
                                name: "ops-build-report",
                                path: "${{ steps.report.outputs.artifact_path }}",
                                "if-no-files-found": "error",
                                overwrite: true,
                            }),
                        }),
                    ]),
                },
                validate: {
                    steps: expect.arrayContaining([
                        expect.objectContaining({
                            uses: "dotnet/docs-actions/status-checker@main",
                        }),
                    ]),
                },
            },
        });
        const producer = workflow("ops-build-report.yml");
        expect(producer).not.toHaveProperty("jobs.collect.needs");
        expect(producer).not.toHaveProperty("jobs.validate.needs");
        expect(producer).not.toHaveProperty("permissions.checks");
        expect(producer).not.toHaveProperty("permissions.pull-requests");
    });

    it("publishes failed validation results from the exact triggering run without checking out PR code", () => {
        const publisher = workflow("ops-build-publish.yml");
        expect(publisher).toMatchObject({
            permissions: {
                actions: "read",
                "pull-requests": "write",
                checks: "write",
            },
            jobs: {
                publish: {
                    if: expect.stringContaining(
                        "github.event.workflow_run.conclusion == 'failure'",
                    ),
                    concurrency: { "cancel-in-progress": false },
                    steps: [
                        expect.objectContaining({
                            with: { "egress-policy": "audit" },
                        }),
                        expect.objectContaining({
                            with: {
                                name: "ops-build-report",
                                path: "${{ runner.temp }}/ops-build-report-download",
                                "run-id": "${{ github.event.workflow_run.id }}",
                                "github-token": "${{ github.token }}",
                            },
                        }),
                        expect.objectContaining({
                            uses: "dotnet/docs-actions/ops-build-reporter/publish@main",
                            with: expect.objectContaining({
                                producer_workflow_file:
                                    "${{ inputs.producer_workflow_file }}",
                                annotate_file_warnings:
                                    "${{ inputs.annotate_file_warnings }}",
                            }),
                        }),
                    ],
                },
            },
        });
        expect(JSON.stringify(publisher)).not.toContain("actions/checkout");
        expect(JSON.stringify(publisher)).not.toContain("secrets: inherit");
    });

    it("runs generated producer, publisher and checker entrypoints under Node 24", () => {
        for (const [file, entrypoint] of [
            ["action.yml", "dist/index.js"],
            ["publish/action.yml", "../dist/publish/index.js"],
            ["../status-checker/action.yml", "dist/index.js"],
        ]) {
            const metadata = load(
                readFileSync(
                    resolve(__dirname, "..", ...file.split("/")),
                    "utf8",
                ),
            );
            expect(metadata).toHaveProperty("runs", {
                using: "node24",
                main: entrypoint,
            });
        }
    });
});
