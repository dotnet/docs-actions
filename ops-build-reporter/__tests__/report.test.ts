import { describe, expect, it } from "@jest/globals";
import {
    BuildReport,
    mergeReportIntoBody,
    PREVIEW_TABLE_START,
    PREVIEW_TABLE_END,
    validateReport,
} from "../src/report";

export function reportFixture(): BuildReport {
    return {
        version: 1,
        repository: "dotnet/docs",
        pullNumber: 7,
        headSha: "a".repeat(40),
        runId: 123,
        runAttempt: 1,
        buildReportUrl:
            "https://buildapi.docs.microsoft.com/Output/BuildReport?accessString=test",
        previewLinks: [
            {
                path: "docs/a.md",
                url: "https://review.learn.microsoft.com/dotnet/a",
            },
        ],
        diagnostics: [
            {
                path: "docs/a.md",
                line: 2,
                severity: "Warning",
                message: "Fix this.",
            },
        ],
        collapsibleAfter: 12,
        maxRowCount: 50,
    };
}

describe("artifact schema", () => {
    it("round trips all diagnostic severities, including those outside changed lines", () => {
        const report = reportFixture();
        report.diagnostics = [
            {
                path: "docs/a.md",
                line: 1,
                severity: "Error",
                message: "Error.",
            },
            {
                path: "docs/b.md",
                line: 90,
                severity: "Warning",
                message: "Warning.",
            },
            {
                path: "docs/c.md",
                line: 10,
                severity: "Suggestion",
                message: "Suggestion.",
            },
        ];
        expect(validateReport(JSON.parse(JSON.stringify(report)))).toEqual(
            report,
        );
    });

    it.each([
        ["version", 2],
        ["pullNumber", -1],
        ["pullNumber", 1.5],
        ["runId", "123"],
        ["runAttempt", 0],
        ["headSha", "not-a-sha"],
        ["repository", "../other"],
        ["maxRowCount", 1001],
        ["collapsibleAfter", -1],
        ["diagnostics", {}],
    ])("rejects invalid %s metadata (%s)", (key, value) => {
        expect(() =>
            validateReport({ ...reportFixture(), [key]: value }),
        ).toThrow();
    });

    it.each([
        "../docs/a.md",
        "/docs/a.md",
        "C:\\a.md",
        "docs/../a.md",
        "docs/\na.md",
    ])("rejects unsafe paths: %s", (path) => {
        const report = reportFixture();
        report.diagnostics[0].path = path;
        expect(() => validateReport(report)).toThrow(
            "Invalid build diagnostic",
        );
    });

    it.each([
        "javascript:alert(1)",
        "http://review.learn.microsoft.com/a",
        "https://review.learn.microsoft.com.evil.example/a",
        "https://user:pass@review.learn.microsoft.com/a",
        "https://review.learn.microsoft.com:8443/a",
        "https://review.learn.microsoft.com/a\n",
    ])("rejects untrusted preview URLs: %s", (url) => {
        const report = reportFixture();
        report.previewLinks[0].url = url;
        expect(() => validateReport(report)).toThrow();
    });

    it("rejects untrusted report links, oversized arrays and invalid diagnostic fields", () => {
        expect(() =>
            validateReport({
                ...reportFixture(),
                buildReportUrl: "https://example.com",
            }),
        ).toThrow();
        expect(() =>
            validateReport({
                ...reportFixture(),
                previewLinks: Array(10001).fill({}),
            }),
        ).toThrow();
        for (const change of [
            { line: 0 },
            { severity: "Notice" },
            { message: "" },
            { message: "a".repeat(8001) },
        ]) {
            const report = reportFixture();
            expect(() =>
                validateReport({
                    ...report,
                    diagnostics: [{ ...report.diagnostics[0], ...change }],
                }),
            ).toThrow();
        }
    });
});

describe("PR description merge", () => {
    it("applies the exact collapse and row-count thresholds, sorting before truncation", () => {
        const report = reportFixture();
        report.previewLinks = [
            { path: "docs/z.md", url: "https://review.learn.microsoft.com/z" },
            { path: "docs/a.md", url: "https://review.learn.microsoft.com/a" },
        ];
        report.collapsibleAfter = 2;
        report.maxRowCount = 1;
        const result = mergeReportIntoBody("", report);
        expect(result).not.toContain("<details>");
        expect(result).toContain("[docs/a.md]");
        expect(result).not.toContain("[docs/z.md]");
        expect(result).toContain("first 1 preview links");
        report.collapsibleAfter = 1;
        expect(mergeReportIntoBody("", report)).toContain("<details>");
    });
    it("preserves user text before and after the generated section and is idempotent", () => {
        const report = reportFixture();
        const body = `User edits.\n${PREVIEW_TABLE_START}\nOld previews\n${PREVIEW_TABLE_END}\nMore user edits.`;
        const updated = mergeReportIntoBody(body, report);
        expect(updated).toMatch(/^User edits\.\n/);
        expect(updated).toMatch(/\nMore user edits\.$/);
        expect(updated).not.toContain("Old previews");
        expect(updated).toContain(report.previewLinks[0].url);
        expect(mergeReportIntoBody(updated, report)).toBe(updated);
    });

    it("publishes error-only reports and removes stale previews", () => {
        const report = reportFixture();
        const old = mergeReportIntoBody("", report);
        report.previewLinks = [];
        const updated = mergeReportIntoBody(old, report);
        expect(updated).toContain("[Build report]");
        expect(updated).not.toContain("Learn preview");
    });

    it("migrates the legacy report link without changing other user links", () => {
        const report = reportFixture();
        const body = `Intro\n${PREVIEW_TABLE_START}old${PREVIEW_TABLE_END}\n\n[Build report](https://buildapi.docs.microsoft.com/old)\nUser [link](https://example.com).`;
        const result = mergeReportIntoBody(body, report);
        expect(result.match(/\[Build report\]/g)).toHaveLength(1);
        expect(result).toContain("\nUser [link](https://example.com).");
    });

    it.each([
        PREVIEW_TABLE_START,
        PREVIEW_TABLE_END,
        `${PREVIEW_TABLE_END}${PREVIEW_TABLE_START}`,
        `${PREVIEW_TABLE_START}${PREVIEW_TABLE_START}${PREVIEW_TABLE_END}`,
        `${PREVIEW_TABLE_START}${PREVIEW_TABLE_END}${PREVIEW_TABLE_END}`,
    ])("fails explicitly on ambiguous markers", (body) => {
        expect(() => mergeReportIntoBody(body, reportFixture())).toThrow(
            "Malformed",
        );
    });

    it("escapes untrusted Markdown and URL delimiters", () => {
        const report = reportFixture();
        report.previewLinks = [
            {
                path: "docs/<img>[x]|a.md",
                url: "https://review.learn.microsoft.com/a(b)|c",
            },
        ];
        const body = mergeReportIntoBody("", validateReport(report));
        expect(body).not.toContain("<img>");
        expect(body).toContain("&lt;img&gt;&#91;x&#93;&#124;a.md");
        expect(body).toContain("/docs/%3Cimg%3E%5Bx%5D%7Ca.md");
        expect(body).toContain("/a%28b%29%7Cc");
    });
});
