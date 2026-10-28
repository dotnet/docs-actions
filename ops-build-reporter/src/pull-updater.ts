import { info, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import * as https from "https";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
    BuildDiagnostic,
    MAX_REPORT_BYTES,
    PREVIEW_TABLE_START,
    PREVIEW_TABLE_END,
    mergeReportIntoBody,
    renderPreviewTable,
    validateReport,
    validateUrl,
} from "./report";
import { workflowInput } from "./types/WorkflowInput";

const OPS_CHECK_NAME = "OpenPublishing.Build";
const OPS_POLL_DELAY_MS = 30_000;

type StatusCheck = {
    name: string;
    status: string;
    detailsUrl: string | null;
};

export async function createBuildReport(token: string): Promise<void> {
    if (context.eventName !== "pull_request") {
        throw new Error("The artifact producer requires a pull_request event.");
    }
    const commitOid = context.payload.pull_request?.head.sha;
    const pullNumber = context.payload.pull_request?.number;
    if (!commitOid || !pullNumber) {
        throw new Error("Unable to resolve PR number and head commit SHA.");
    }

    const opsCheck = await waitForStatusCheck(
        token,
        commitOid,
        OPS_CHECK_NAME,
        calculateMaxPollAttempts(
            workflowInput.maxWaitTimeMinutes,
            OPS_POLL_DELAY_MS,
        ),
        OPS_POLL_DELAY_MS,
    );

    if (!opsCheck || !opsCheck.detailsUrl) {
        throw new Error(
            `Unable to find a completed ${OPS_CHECK_NAME} status with a report URL.`,
        );
    }

    validateUrl(opsCheck.detailsUrl, "report");
    const buildReportHtml = await downloadUrl(opsCheck.detailsUrl);
    if (!buildReportHtml) {
        throw new Error("OPS build report HTML was empty.");
    }

    const previewLinks = extractPreviewLinksFromBuildReport(buildReportHtml);
    const report = validateReport({
        version: 1,
        repository: `${context.repo.owner}/${context.repo.repo}`,
        pullNumber,
        headSha: commitOid,
        runId: context.runId,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        buildReportUrl: opsCheck.detailsUrl,
        previewLinks: [...previewLinks].map(([path, url]) => ({ path, url })),
        diagnostics: extractDiagnosticsFromBuildReport(buildReportHtml),
        collapsibleAfter: workflowInput.collapsibleAfter,
        maxRowCount: workflowInput.maxRowCount,
    });
    const json = JSON.stringify(report);
    if (Buffer.byteLength(json) > MAX_REPORT_BYTES) {
        throw new Error("OPS report exceeds the 10 MiB artifact limit.");
    }
    await mkdir(workflowInput.outputDirectory, { recursive: true });
    await writeFile(
        join(workflowInput.outputDirectory, "report.json"),
        json,
        "utf8",
    );
    await writeFile(
        join(workflowInput.outputDirectory, "preview.md"),
        mergeReportIntoBody("", report).trim(),
        "utf8",
    );
    setOutput("artifact_path", workflowInput.outputDirectory);
    info(
        `Prepared ${report.previewLinks.length} previews and ${report.diagnostics.length} diagnostics.`,
    );
}

async function waitForStatusCheck(
    token: string,
    commitSha: string,
    checkName: string,
    maxAttempts: number,
    pollDelayMs: number,
): Promise<StatusCheck | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const check = await getSpecificStatusCheck(token, commitSha, checkName);
        if (check) {
            info(
                `Found ${checkName} status check (${check.status}) on attempt ${attempt}/${maxAttempts}.`,
            );

            if (check.status === "success") {
                return check;
            }

            if (check.status === "failure" || check.status === "error") {
                return check;
            }
        } else {
            info(
                `${checkName} status check not found on attempt ${attempt}/${maxAttempts}.`,
            );
        }

        if (attempt < maxAttempts) {
            await delay(pollDelayMs);
        }
    }

    return null;
}

async function getSpecificStatusCheck(
    token: string,
    commitSha: string,
    checkName: string,
): Promise<StatusCheck | null> {
    const octokit = getOctokit(token);
    const response = await octokit.rest.repos.getCombinedStatusForRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: commitSha,
    });

    const exactMatch = response.data.statuses.find(
        (status) => status.context === checkName,
    );

    if (!exactMatch) {
        return null;
    }

    return {
        name: exactMatch.context,
        status: exactMatch.state,
        detailsUrl: exactMatch.target_url,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateMaxPollAttempts(
    maxWaitTimeMinutes: number,
    pollDelayMs: number,
): number {
    return pollDelayMs > 0
        ? Math.max(
              1,
              Math.floor((maxWaitTimeMinutes * 60_000) / pollDelayMs) + 1,
          )
        : 1;
}

async function downloadUrl(url: string, redirects = 0): Promise<string> {
    const parsed = new URL(url);
    if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        redirects > 5
    ) {
        throw new Error("Invalid OPS report redirect.");
    }
    return await new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            const statusCode = response.statusCode ?? 0;

            if (
                statusCode >= 300 &&
                statusCode < 400 &&
                response.headers.location
            ) {
                response.resume();
                downloadUrl(
                    new URL(response.headers.location, url).href,
                    redirects + 1,
                )
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(
                    new Error(
                        `OPS report download failed with HTTP ${statusCode}.`,
                    ),
                );
                return;
            }

            let data = "";
            let bytes = 0;
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                bytes += Buffer.byteLength(chunk);
                if (bytes > MAX_REPORT_BYTES) {
                    response.destroy(
                        new Error("OPS report HTML exceeds 10 MiB."),
                    );
                    return;
                }
                data += chunk;
            });
            response.on("end", () => resolve(data));
            response.on("error", reject);
        });

        request.setTimeout(30000, () =>
            request.destroy(new Error("OPS report download timed out.")),
        );
        request.on("error", reject);
    });
}

function extractPreviewLinksFromBuildReport(html: string): Map<string, string> {
    const previewLinks = new Map<string, string>();
    if (!html) {
        return previewLinks;
    }

    const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
    for (const table of tables) {
        if (!tableHasPreviewHeaders(table)) {
            continue;
        }

        const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].match(/<td[\s\S]*?<\/td>/gi) ?? [];
            if (cells.length < 3) {
                continue;
            }

            const fileCell = cells[0] ?? "";
            const previewCell = cells[2] ?? "";
            const file = decodeHtmlEntities(stripTags(fileCell)).trim();
            const previewHref = extractAnchorHref(previewCell);

            if (file && previewHref) {
                previewLinks.set(file, previewHref);
            }
        }

        if (previewLinks.size > 0) {
            return previewLinks;
        }
    }

    return previewLinks;
}

function tableHasPreviewHeaders(tableHtml: string): boolean {
    const firstRow = tableHtml.match(/<tr[\s\S]*?<\/tr>/i)?.[0] ?? "";
    const headerCells = firstRow.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
    const headerValues = headerCells.map((cell) =>
        decodeHtmlEntities(stripTags(cell)).trim().toLowerCase(),
    );

    const hasFileHeader = headerValues.some((_) => _ === "file");
    const hasPreviewHeader = headerValues.some((_) =>
        _.includes("preview url"),
    );

    return hasFileHeader && hasPreviewHeader;
}

function extractAnchorHref(cellHtml: string): string {
    const hrefMatch = cellHtml.match(/<a[^>]+href=["']([^"']+)["']/i);
    return hrefMatch?.[1]?.trim() ?? "";
}

function stripTags(input: string): string {
    return input.replace(/<[^>]*>/g, " ");
}

function decodeHtmlEntities(input: string): string {
    return input
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .replace(/&amp;/g, "&");
}

function extractDiagnosticsFromBuildReport(html: string): BuildDiagnostic[] {
    const diagnostics: BuildDiagnostic[] = [];
    const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

    for (const table of tables) {
        const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
        if (rows.length === 0) {
            continue;
        }

        const headers = extractCellText(rows[0] ?? "").map((header) =>
            header.toLowerCase(),
        );
        const fileIndex = headers.indexOf("file");
        const statusIndex = headers.indexOf("status");
        const detailsIndex = headers.indexOf("details");
        if (fileIndex < 0 || statusIndex < 0 || detailsIndex < 0) {
            continue;
        }

        for (const row of rows.slice(1)) {
            const cells = extractCellText(row);
            const path = cells[fileIndex]?.trim();
            const details = cells[detailsIndex] ?? "";
            if (!path || !cells[statusIndex]) {
                continue;
            }

            const detailPattern =
                /Line\s+(\d+)\s*:\s*\[(Error|Warning|Suggestion)\]\s*([\s\S]*?)(?=\s+Line\s+\d+\s*:\s*\[(?:Error|Warning|Suggestion)\]|$)/gi;
            for (const match of details.matchAll(detailPattern)) {
                const line = Number(match[1]);
                if (line > 0) {
                    const severity = match[2].toLowerCase();
                    diagnostics.push({
                        path,
                        line,
                        severity:
                            severity === "error"
                                ? "Error"
                                : severity === "warning"
                                  ? "Warning"
                                  : "Suggestion",
                        message: match[3].trim(),
                    });
                }
            }
        }

        if (diagnostics.length > 0) {
            return diagnostics;
        }
    }

    return diagnostics;
}

function extractCellText(rowHtml: string): string[] {
    const cells = rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
    return cells.map((cell) => decodeHtmlEntities(stripTags(cell)).trim());
}

function extractChangedLinesFromPatch(patch: string): Set<number> {
    const changedLines = new Set<number>();
    let newLine = 0;

    for (const patchLine of patch.split("\n")) {
        const hunk = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            newLine = Number(hunk[1]);
            continue;
        }

        if (newLine === 0) {
            continue;
        }
        if (patchLine.startsWith("+")) {
            changedLines.add(newLine);
            newLine++;
        } else if (
            !patchLine.startsWith("-") &&
            !patchLine.startsWith("\\ No newline") &&
            newLine > 0
        ) {
            newLine++;
        }
    }

    return changedLines;
}

function filterDiagnosticsToChangedLines(
    diagnostics: BuildDiagnostic[],
    changedLinesByPath: Map<string, Set<number>>,
): BuildDiagnostic[] {
    return diagnostics.filter((diagnostic) =>
        changedLinesByPath.get(diagnostic.path)?.has(diagnostic.line),
    );
}

export async function annotateChangedLines(
    token: string,
    pullNumber: number,
    commitOid: string,
    diagnostics: BuildDiagnostic[],
    buildReportUrl: string,
    externalId: string,
): Promise<void> {
    const octokit = getOctokit(token);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pullNumber,
        per_page: 100,
    });
    const changedLinesByPath = new Map<string, Set<number>>();
    for (const file of files) {
        if (file.patch) {
            changedLinesByPath.set(
                file.filename,
                extractChangedLinesFromPatch(file.patch),
            );
        }
    }

    const filteredDiagnostics = filterDiagnosticsToChangedLines(
        diagnostics,
        changedLinesByPath,
    );
    const annotations = filteredDiagnostics.map((diagnostic) => ({
        path: diagnostic.path,
        start_line: diagnostic.line,
        end_line: diagnostic.line,
        annotation_level: (diagnostic.severity === "Error"
            ? "failure"
            : diagnostic.severity === "Warning"
              ? "warning"
              : "notice") as "failure" | "warning" | "notice",
        title: `OPS ${diagnostic.severity}`,
        message: diagnostic.message,
    }));
    const ANNOTATION_BATCH_SIZE = 50;
    const firstBatch = annotations.slice(0, ANNOTATION_BATCH_SIZE);
    const existing = await octokit.paginate(octokit.rest.checks.listForRef, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: commitOid,
        check_name: "OpenPublishing.Build annotations",
        per_page: 100,
    });
    if (
        existing.some(
            (check) =>
                check.external_id === externalId &&
                check.status === "completed" &&
                check.conclusion === "neutral",
        )
    ) {
        info("Annotations for this run attempt have already been published.");
        return;
    }
    for (const check of existing.filter(
        (check) =>
            check.external_id === externalId && check.status !== "completed",
    )) {
        await octokit.rest.checks.update({
            owner: context.repo.owner,
            repo: context.repo.repo,
            check_run_id: check.id,
            status: "completed",
            conclusion: "cancelled",
        });
    }
    const response = await octokit.rest.checks.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name: "OpenPublishing.Build annotations",
        head_sha: commitOid,
        external_id: externalId,
        status: "in_progress",
        details_url: buildReportUrl,
        output: {
            title: "OpenPublishing.Build diagnostics",
            summary: `${annotations.length} error(s), warning(s), or suggestion(s) found on changed lines.`,
            annotations: firstBatch,
        },
    });

    for (
        let index = ANNOTATION_BATCH_SIZE;
        index < annotations.length;
        index += ANNOTATION_BATCH_SIZE
    ) {
        await octokit.rest.checks.update({
            owner: context.repo.owner,
            repo: context.repo.repo,
            check_run_id: response.data.id,
            output: {
                title: "OpenPublishing.Build diagnostics",
                summary: `${annotations.length} error(s), warning(s), or suggestion(s) found on changed lines.`,
                annotations: annotations.slice(
                    index,
                    index + ANNOTATION_BATCH_SIZE,
                ),
            },
        });
    }

    await octokit.rest.checks.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        check_run_id: response.data.id,
        status: "completed",
        conclusion: "neutral",
    });
    info(`Annotated ${annotations.length} changed line(s).`);
}

function buildMarkdownPreviewTableFromExtractedLinks(
    previewLinks: Map<string, string>,
    commitOid: string,
    checksUrl: string,
): string {
    return renderPreviewTable(
        previewLinks,
        `${context.repo.owner}/${context.repo.repo}`,
        commitOid,
        checksUrl,
        workflowInput.collapsibleAfter,
        workflowInput.maxRowCount,
    );
}

function replaceExistingTable(body: string, table: string) {
    const startIndex = body.indexOf(PREVIEW_TABLE_START);
    if (startIndex === -1) {
        return "Unable to parse starting index of existing markdown table.";
    }
    const endIndex = body.lastIndexOf(PREVIEW_TABLE_END);
    if (endIndex === -1) {
        return "Unable to parse ending index of existing markdown table.";
    }
    const start = body.substring(0, startIndex + PREVIEW_TABLE_START.length);
    const tail = body.substring(endIndex);

    return `${start}\n\n---\n\n${table}\n\n${tail}`;
}

function appendTable(body: string, table: string) {
    return `${body}\n\n${PREVIEW_TABLE_START}\n\n---\n\n${table}\n${PREVIEW_TABLE_END}`;
}

export const exportedForTesting = {
    appendTable,
    buildMarkdownPreviewTableFromExtractedLinks,
    calculateMaxPollAttempts,
    extractChangedLinesFromPatch,
    extractDiagnosticsFromBuildReport,
    extractPreviewLinksFromBuildReport,
    filterDiagnosticsToChangedLines,
    PREVIEW_TABLE_END,
    PREVIEW_TABLE_START,
    replaceExistingTable,
};
