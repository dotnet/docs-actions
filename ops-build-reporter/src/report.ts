export type BuildDiagnostic = {
    path: string;
    line: number;
    severity: "Error" | "Warning" | "Suggestion";
    message: string;
};

export type BuildReport = {
    version: 1;
    repository: string;
    pullNumber: number;
    headSha: string;
    runId: number;
    runAttempt: number;
    buildReportUrl: string;
    previewLinks: { path: string; url: string }[];
    diagnostics: BuildDiagnostic[];
    collapsibleAfter: number;
    maxRowCount: number;
};

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
export const PREVIEW_TABLE_START = "<!-- PREVIEW-TABLE-START -->";
export const PREVIEW_TABLE_END = "<!-- PREVIEW-TABLE-END -->";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(
    value: unknown,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
): value is number {
    return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= min &&
        value <= max
    );
}

function isPath(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1024 &&
        !/[\u0000-\u001f\u007f\\:]/.test(value) &&
        value
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== "..")
    );
}

export function validateUrl(
    value: unknown,
    kind: "report" | "preview",
): string {
    if (
        typeof value !== "string" ||
        value.length > 8192 ||
        /[\s<>`\\]/.test(value)
    ) {
        throw new Error(`Invalid ${kind} URL.`);
    }
    const url = new URL(value);
    const hosts =
        kind === "report"
            ? ["buildapi.docs.microsoft.com"]
            : ["review.learn.microsoft.com", "review.docs.microsoft.com"];
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !hosts.includes(url.hostname)
    ) {
        throw new Error(`Untrusted ${kind} URL host or scheme.`);
    }
    return value;
}

export function validateReport(value: unknown): BuildReport {
    if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.repository !== "string" ||
        !/^[\w-]+\/[\w.-]+$/.test(value.repository) ||
        !isInteger(value.pullNumber, 1) ||
        !isInteger(value.runId, 1) ||
        !isInteger(value.runAttempt, 1) ||
        typeof value.headSha !== "string" ||
        !/^[a-f0-9]{40}$/.test(value.headSha) ||
        !isInteger(value.collapsibleAfter, 0, 1000) ||
        !isInteger(value.maxRowCount, 1, 1000) ||
        !Array.isArray(value.previewLinks) ||
        value.previewLinks.length > 10000 ||
        !Array.isArray(value.diagnostics) ||
        value.diagnostics.length > 10000
    ) {
        throw new Error("Invalid OPS report schema or metadata.");
    }

    const previewLinks = value.previewLinks.map((link: unknown) => {
        if (!isRecord(link) || !isPath(link.path)) {
            throw new Error("Invalid preview file path.");
        }
        return { path: link.path, url: validateUrl(link.url, "preview") };
    });
    const diagnostics = value.diagnostics.map(
        (diagnostic: unknown): BuildDiagnostic => {
            if (
                !isRecord(diagnostic) ||
                !isPath(diagnostic.path) ||
                !isInteger(diagnostic.line, 1, 2147483647) ||
                (diagnostic.severity !== "Error" &&
                    diagnostic.severity !== "Warning" &&
                    diagnostic.severity !== "Suggestion") ||
                typeof diagnostic.message !== "string" ||
                !diagnostic.message.trim() ||
                diagnostic.message.length > 8000 ||
                diagnostic.message.includes("\u0000")
            ) {
                throw new Error("Invalid build diagnostic.");
            }
            return {
                path: diagnostic.path,
                line: diagnostic.line,
                severity: diagnostic.severity,
                message: diagnostic.message,
            };
        },
    );
    return {
        version: 1,
        repository: value.repository,
        pullNumber: value.pullNumber,
        headSha: value.headSha,
        runId: value.runId,
        runAttempt: value.runAttempt,
        buildReportUrl: validateUrl(value.buildReportUrl, "report"),
        previewLinks,
        diagnostics,
        collapsibleAfter: value.collapsibleAfter,
        maxRowCount: value.maxRowCount,
    };
}

function escapeText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(
            /[\\`*_[\]{}()!|]/g,
            (character) => `&#${character.charCodeAt(0)};`,
        );
}

function linkUrl(value: string): string {
    return value
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29")
        .replace(/\|/g, "%7C");
}

export function renderPreviewTable(
    links: Map<string, string>,
    repository: string,
    headSha: string,
    checksUrl: string,
    collapsibleAfter: number,
    maxRowCount: number,
): string {
    let table = "#### Internal previews\n\n";
    const collapsible = links.size > collapsibleAfter;
    if (collapsible) {
        table +=
            "<details><summary><strong>Toggle expand/collapse</strong></summary><br/>\n\n";
    }
    table += "| File | Preview link |\n|:--|:--|\n";
    const sorted = [...links.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [file, url] of sorted.slice(0, maxRowCount)) {
        const path = file.split("/").map(encodeURIComponent).join("/");
        table += `| [${escapeText(file)}](${linkUrl(`https://github.com/${repository}/blob/${headSha}/${path}`)}) | [Learn preview](${linkUrl(url)}) |\n`;
    }
    if (collapsible) {
        table += "\n</details>\n";
    }
    if (sorted.length > maxRowCount) {
        table += `\n> [!NOTE]\n> This table shows the first ${maxRowCount} preview links (sorted alphabetically by file path) found in the OPS build report. For the full list, select <strong>OpenPublishing.Build Details</strong> within [checks](${checksUrl}).\n`;
    }
    return table;
}

export function mergeReportIntoBody(body: string, report: BuildReport): string {
    const table = report.previewLinks.length
        ? renderPreviewTable(
              new Map(report.previewLinks.map((link) => [link.path, link.url])),
              report.repository,
              report.headSha,
              `https://github.com/${report.repository}/pull/${report.pullNumber}/checks`,
              report.collapsibleAfter,
              report.maxRowCount,
          )
        : "";
    const section = `${PREVIEW_TABLE_START}\n\n---\n\n${table}\n\n[Build report](${linkUrl(report.buildReportUrl)})\n${PREVIEW_TABLE_END}`;
    const start = body.indexOf(PREVIEW_TABLE_START);
    const end = body.indexOf(PREVIEW_TABLE_END);
    if (
        (start === -1) !== (end === -1) ||
        (start !== -1 &&
            (end < start ||
                body.indexOf(PREVIEW_TABLE_START, start + 1) !== -1 ||
                body.indexOf(PREVIEW_TABLE_END, end + 1) !== -1))
    ) {
        throw new Error(
            "Malformed preview section markers in the PR description.",
        );
    }
    if (start !== -1) {
        const tail = body
            .slice(end + PREVIEW_TABLE_END.length)
            // Migrate the report link appended outside the section by the old reporter.
            .replace(
                /^\s*\[Build report\]\(https:\/\/buildapi\.docs\.microsoft\.com\/[^)\r\n]*\)/,
                "",
            );
        return body.slice(0, start) + section + tail;
    }
    return `${body}\n\n${section}`;
}
