# Configuration file

Starting with v0.0.8, a configuration file *markdown-links-verifier-config.json* support was added.

## `excludeStartingWith`

Starting with v0.0.8, the configuration file can contain an `excludeStartingWith` array used to exclude links starting with given prefixes.

### Example

Given the following *markdown-links-verifier-config.json* file in the repository root, it will disallow links starting with `xref:` or `~/` from being verified:

```json
{
  "excludeStartingWith": [
    "xref:",
    "~/",
  ]
}
```

### Rationale (use case)

Some repositories may be using specific markdown extensions that shouldn't be flagged. For example, Microsoft Docs has "xref:" for API links. The workflow shouldn't attempt to analyze them.

See [issue #63](https://github.com/Youssef1313/markdown-links-verifier/issues/63) for more information.

## `excludeDirectories`

The configuration file can contain an `excludeDirectories` array of directories, relative to the repository root, that the Markdown link verifier should not scan. Each excluded directory also excludes all of its subdirectories. Use `/` as the path separator; a trailing slash is optional.

```json
{
  "excludeDirectories": [
    "docs/archive",
    "samples/legacy"
  ]
}
```

An excluded directory is matched as a complete path, so excluding `docs/archive` does not exclude a sibling such as `docs/archived`.