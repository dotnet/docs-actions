import { getInput, info, warning } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { lstat, readFile } from "fs/promises";
import { join } from "path";
import { annotateChangedLines } from "./pull-updater";
import {
    BuildReport,
    MAX_REPORT_BYTES,
    mergeReportIntoBody,
    validateReport,
} from "./report";

type RunIdentity = {
    id: number;
    run_attempt?: number;
    event: string;
    status: string | null;
    conclusion: string | null;
    path: string;
    head_sha: string;
    head_branch: string | null;
    repository: { full_name: string };
    head_repository: { full_name: string; id: number } | null;
    pull_requests: { number: number }[] | null;
};

type PullIdentity = {
    number: number;
    state: string;
    head: { sha: string; ref: string; repo: { id: number } | null };
    base: { repo: { full_name: string } };
};

export function validatePublicationIdentity(
    report: BuildReport,
    run: RunIdentity,
    pull: PullIdentity,
    repository: string,
    workflowFile: string,
    associatedPullNumbers: number[],
): boolean {
    if (
        run.repository.full_name.toLowerCase() !== repository.toLowerCase() ||
        report.repository.toLowerCase() !== repository.toLowerCase() ||
        pull.base.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
        run.event !== "pull_request" ||
        run.path !== workflowFile ||
        run.status !== "completed" ||
        !["success", "failure"].includes(run.conclusion ?? "") ||
        report.runId !== run.id ||
        report.runAttempt !== run.run_attempt ||
        report.headSha !== run.head_sha ||
        pull.number !== report.pullNumber
    ) {
        throw new Error(
            "OPS artifact does not match the authorized producer run and pull request.",
        );
    }
    if (pull.state !== "open" || pull.head.sha !== report.headSha) {
        return false;
    }
    if (!associatedPullNumbers.includes(pull.number)) {
        throw new Error(
            "The PR is not associated with the producer's head repository, branch, and SHA.",
        );
    }
    if (
        !pull.head.repo ||
        !run.head_repository ||
        pull.head.repo.id !== run.head_repository.id ||
        pull.head.ref !== run.head_branch
    ) {
        throw new Error(
            "OPS producer run does not match the PR head repository and branch.",
        );
    }
    return true;
}

export async function publishBuildReport(token: string): Promise<void> {
    if (context.eventName !== "workflow_run") {
        throw new Error("The publisher requires a workflow_run event.");
    }
    const annotate = getInput("annotate_file_warnings").toLowerCase();
    if (!["", "true", "false"].includes(annotate)) {
        throw new Error("annotate_file_warnings must be true or false.");
    }
    const runId: unknown = context.payload.workflow_run?.id;
    if (
        typeof runId !== "number" ||
        !Number.isSafeInteger(runId) ||
        runId <= 0
    ) {
        throw new Error("Unable to resolve the triggering workflow run ID.");
    }
    const workflowFile = getInput("producer_workflow_file", { required: true });
    if (!/^\.github\/workflows\/[^/\\]+\.ya?ml$/.test(workflowFile)) {
        throw new Error(
            "producer_workflow_file must name a workflow in .github/workflows.",
        );
    }
    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;
    const repository = `${owner}/${repo}`;
    const { data: run } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
    });
    if (
        run.event !== "pull_request" ||
        run.path !== workflowFile ||
        run.repository.full_name.toLowerCase() !== repository.toLowerCase()
    ) {
        throw new Error("Unexpected producer workflow or repository.");
    }
    if (
        run.status !== "completed" ||
        !["success", "failure"].includes(run.conclusion ?? "")
    ) {
        warning(
            `Not publishing producer run with status ${run.status}/${run.conclusion}.`,
        );
        return;
    }

    const reportPath = join(
        getInput("artifact_directory", { required: true }),
        "report.json",
    );
    const stat = await lstat(reportPath);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_REPORT_BYTES
    ) {
        throw new Error(
            "OPS report must be a regular file no larger than 10 MiB.",
        );
    }
    const report = validateReport(
        JSON.parse(await readFile(reportPath, "utf8")),
    );
    // Both run.pull_requests and commit-to-PR associations can be empty for forks.
    let associatedPullNumbers = run.pull_requests?.map((pr) => pr.number) ?? [];
    if (associatedPullNumbers.length === 0) {
        if (!run.head_repository || !run.head_branch) {
            throw new Error(
                "Unable to resolve the producer's head repository and branch.",
            );
        }
        const headOwner = run.head_repository.full_name.split("/")[0];
        const candidates = await octokit.paginate(octokit.rest.pulls.list, {
            owner,
            repo,
            head: `${headOwner}:${run.head_branch}`,
            state: "open",
            per_page: 100,
        });
        associatedPullNumbers = candidates
            .filter(
                (pr) =>
                    pr.head.sha === run.head_sha &&
                    pr.head.repo?.id === run.head_repository?.id &&
                    pr.head.ref === run.head_branch,
            )
            .map((pr) => pr.number);
    }
    const { data: pull } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: report.pullNumber,
    });
    if (
        !validatePublicationIdentity(
            report,
            run,
            pull,
            repository,
            workflowFile,
            associatedPullNumbers,
        )
    ) {
        warning(
            "Not publishing stale OPS results: the PR is closed or its head commit changed.",
        );
        return;
    }

    const body = mergeReportIntoBody(pull.body ?? "", report);
    if (body.length > 65536) {
        throw new Error(
            "Updated PR description exceeds GitHub's 65536-character limit.",
        );
    }
    if (body !== (pull.body ?? "")) {
        await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: pull.number,
            body,
        });
    }
    if (annotate === "true") {
        await annotateChangedLines(
            token,
            pull.number,
            report.headSha,
            report.diagnostics,
            report.buildReportUrl,
            `ops-build-report:${report.pullNumber}:${report.runId}:${report.runAttempt}`,
        );
    }
    info(`Published OPS results for PR ${pull.number}.`);
}
