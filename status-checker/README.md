# Status checker GitHub Action

This action checks for Open Publishing Build system build warnings.:rocket:

Whether or not there are build warnings, you'll see a status check for this action in your pull request. If it passes, it means it ran without error and there are not build warnings or errors. If it fails, it means there are build warnings or errors, or there's a bug in this action.

## Usage

Add a workflow in your repository. The only required input is the read-only GitHub token.

For example, the following YAML example calls this status-checker Action.

```yml
on: [pull_request]

permissions:
  statuses: read

jobs:
  status_checker_job:
    runs-on: ubuntu-latest
    name: Checks the OpenPublishing.Build status check for build warnings
    steps:
    - uses: dotnet/docs-actions/status-checker@main
      with:
        repo_token: ${{ github.token }}
```

The action reads the `OpenPublishing.Build` status for the PR **head** commit, not the synthetic merge commit. It needs no write permissions and works with fork PRs. Build warnings, failures, and errors fail validation; suggestions alone do not.

For validation together with preview links and diagnostic annotations, use the two [OPS reporting workflows](../ops-build-reporter/README.md). Their producer runs this action independently of artifact collection, so failed validation does not prevent publishing diagnostics.
