# OPS build reporting

OPS reporting uses an unprivileged `pull_request` producer and a trusted `workflow_run` publisher. Fork PRs retain preview links, a build-report link, and optional changed-line diagnostics without granting PR code write access.

## Migration (breaking change)

`ops-build-reporter` is now **artifact-only**. It no longer updates PR descriptions or creates check runs, and it rejects `pull_request_target`. Move `annotate_file_warnings` to the publisher. Replace existing callers with the two workflows below. Remove a separate `status-checker` workflow if using the reusable producer, which already runs validation.

The publisher workflow must be merged into the consuming repository's **default branch** before `workflow_run` can trigger it. Update branch protection/rulesets to require the producer's `Look for build warnings` job under its new reusable-workflow job name, rather than the old standalone job. Do not require the neutral annotation check as the validation gate.

### Producer: `.github/workflows/ops-build-reporter.yml`

```yaml
name: OPS build reporter
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  statuses: read
jobs:
  report:
    uses: dotnet/docs-actions/.github/workflows/ops-build-report.yml@main
    with:
      max_wait_time_minutes: 20
      collapsible_after: 12
      max_row_count: 50
```

Artifact collection and `status-checker` run in independent jobs. Warnings/errors may fail validation while collection succeeds and uploads results. Suggestions alone do not fail validation. No checkout, repository secrets, or write permissions are needed. GitHub's fork-workflow approval requirements still apply.

### Publisher: `.github/workflows/ops-build-publisher.yml`

```yaml
name: Publish OPS build report
on:
  workflow_run:
    workflows: [OPS build reporter]
    types: [completed]
permissions:
  actions: read
  pull-requests: write
  checks: write
jobs:
  publish:
    uses: dotnet/docs-actions/.github/workflows/ops-build-publish.yml@main
    with:
      producer_workflow_file: .github/workflows/ops-build-reporter.yml
      annotate_file_warnings: true
```

`producer_workflow_file` is the path of the **calling workflow in the consuming repository**. `annotate_file_warnings` defaults to `false`. When enabled, errors, warnings, and suggestions on added/modified PR lines become failure, warning, and notice annotations in a **neutral** check; all extracted diagnostics remain in the artifact. Diagnostics are published even when no preview links exist.

These examples reference `main` for readability and become usable after the new actions and reusable workflows are published there. For production, pin the reusable workflow references **and their internal action references** to reviewed release commit SHAs.

## Artifact contract and trust boundary

The producer action writes:

- `report.json`: version 1 metadata (repository, PR number, PR head SHA, source run ID/attempt), build-report URL, all extracted diagnostics, preview links, and table options.
- `preview.md`: the generated description section for inspection. It is not a complete PR-body snapshot and the publisher never executes or trusts it.

The `artifact_path` output identifies the directory to upload as `ops-build-report`. The reusable producer retains it for seven days and replaces it on reruns. Custom callers can use `output_directory` to select the output directory. Table options accept `collapsible_after` from 0 to 1000 and `max_row_count` from 1 to 1000; `max_wait_time_minutes` accepts 1 to 60.

The publisher downloads only the named artifact from the triggering run into runner temporary storage. It uses trusted action code, never checks out the PR, and never executes artifact contents or restores PR caches. It validates the JSON schema, size (10 MiB), URLs, paths, run ID/attempt, originating workflow path/event/repository, and PR association against GitHub APIs. Empty fork-run PR associations are resolved by listing open PRs from the source run's head owner/branch, then requiring an exact match of head repository ID, branch, and SHA. The commit-to-PR API is not used as a fallback because it can also return an empty list for open fork PRs. Supported report URLs use `https://buildapi.docs.microsoft.com`; previews use `https://review.learn.microsoft.com` or `https://review.docs.microsoft.com`.

Completed runs with `success` or `failure` conclusions can publish; cancelled or incomplete runs cannot. Missing/malformed artifacts and unexpected run identities fail explicitly. Closed PRs and superseded head SHAs are skipped with a warning. Publisher runs for the same source branch are serialized, and successful annotation publication is idempotent for a source run attempt.

The publisher regenerates safe Markdown from validated structured data and merges only its marked section into the latest PR body. User content outside the section is preserved (apart from migrating the legacy reporter's trailing build-report link). Invalid/ambiguous section markers fail rather than risk erasing user content. PR-body edits are read immediately before publishing, but GitHub's PR-update API does not provide an atomic compare-and-swap against concurrent human edits.

To use the actions without reusable workflows, run `dotnet/docs-actions/ops-build-reporter@main` under `pull_request`, upload its `artifact_path`, then download the artifact with `run-id: ${{ github.event.workflow_run.id }}` in a separate `workflow_run` workflow and call `dotnet/docs-actions/ops-build-reporter/publish@main`. The publisher requires `repo_token`, `artifact_directory`, and `producer_workflow_file`; never take these inputs from artifact contents.

## Development

TypeScript is the source of truth. Run `npm run build`, `npm test`, and `npm run package` in this directory. Tests are type-checked before Jest runs; their separate configuration supports the existing CommonJS test harness while production imports remain ESM for bundling. Packaging generates both action bundles from TypeScript; do not hand-edit `dist`.
