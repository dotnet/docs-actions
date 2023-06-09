﻿## Onboard a repository / docset

### Create a configuration file

Complete the following steps in Visual Studio Code:

1. Create a JSON configuration file within the GitHub repository:
    - For docsets in the *azure-docs-pr* repository, the file's naming convention is *.\{SERVICE-NAME}.json*. The file should live in the repository's *.whatsnew* directory. Replace the *\{SERVICE-NAME}* placeholder with the directory name within *articles* in which the docs are stored. For example, name the file *.app-service.json* for Azure App Service docs.
    - For all other docsets, the file should be named *.whatsnew.json* and live in the repository's root directory.
1. Associate your JSON configuration file with the JSON schema by adding a `$schema` property to line 2 of the JSON configuration file. The `$schema` property's value should be set as follows:

    ```json
    "$schema": "https://github.com/dotnet/docs-tools/blob/main/WhatsNew.Infrastructure/Configuration/reposettings.schema.json",
    ```

1. Populate the various properties in the JSON file with the help of the supporting JSON schema. For more information about JSON schema support in Visual Studio Code, see [JSON schemas and settings](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings). See also the supported [configuration file settings](#configuration-file-settings).

### Request a Power BI dashboard update

Metrics for the "what's new" pages are made available at [aka.ms/whatsnewindocs](https://aka.ms/whatsnewindocs). Contact [whatsnewindocs@microsoft.com](mailto:whatsnewindocs@microsoft.com) to have your docset added to this Power BI dashboard.

## Usage

1. Clone the `dotnet/docs-tools` repository.
1. Generate a PAT per the instructions at [Creating a token](https://help.github.com/github/authenticating-to-github/creating-a-personal-access-token-for-the-command-line#creating-a-token). When selecting scopes for the PAT, check the following boxes:
    - For private repos:
      - **repo**
      - **admin:org** > **read:org**
    - For public repos:
      - **repo** > **public_repo**
      - **admin:org** > **read:org**
1. For private repos in the *MicrosoftDocs* GitHub organization, after generating the PAT, select **Enable SSO** and choose **Authorize** for both **microsoft** and **MicrosoftDocs**.
1. Store the PAT in an environment variable named `GitHubKey`.
1. Set up an OSPO personal access token
   > This step is required for versions 2.0 and above.

   The OSPO personal access token is required to access the OSPO API. This API determines community contributors and Microsoft employee and vendor contributors.
1. Request a token at [Visual Studio Online](https://ossmsft.visualstudio.com/_usersSettings/tokens). You can disable all scopes *except* read:user profile.
1. Store the token in an environment variable named "OSPO_KEY".  If you are using the GitHub Action to generate the PR automatically, add the key as a secret in your repository:
   - Go to **Settings** on your repo.
   - Select **Secrets**
   - Add "OSPO_KEY" as a **Repository Secret**.
1. Install the [.NET SDK 7.0](https://dotnet.microsoft.com/download/dotnet) or later.
1. build and publish the tool:

    ```bash
    cd WhatsNew.Cli
    dotnet build
    dotnet publish
    ```

1. Run the appropriate `dotnet whatsnew` command. See the examples below. The location of the generated Markdown file can be specified by setting the `--savedir` option:

   ```bash
   cd work/visualstudio-docs-pr
   dotnet ../docs-tools/WhatsNew.Cli/bin/Debug/net7.0/publish/WhatsNew.Cli.dll --owner MicrosoftDocs --repo visualstudio-docs-pr --savefile ./docs/ide/whats-new-visual-studio-docs.md 
   ```

### Examples

**Display the help menu:**

```bash
dotnet whatsnew -h
```

**Generate the *dotnet/AspNetCore.Docs* repo's what's new page for the period starting 5/1/2020 and ending 5/31/2020. Process PRs in the *dev* branch.**

```bash
dotnet WhatsNew.Cli.dll --owner dotnet --repo AspNetCore.Docs --branch dev --startdate 2020-05-01 --enddate 2020-05-31
```

**Generate the Cognitive Services docset's what's new page for the period starting 5/1/2020 and ending 5/31/2020. Process PRs in the repository's default branch.**

```bash
dotnet WhatsNew.Cli.dll --owner MicrosoftDocs --repo azure-docs-pr --docset cognitive-services --startdate 2020-05-01 --enddate 2020-05-31
```

**Generate the *dotnet/docs* repo's what's new page for the period starting 7/1/2020 and ending 7/5/2020. Process PRs in the repository's default branch. Save the generated Markdown file in the */Users/janedoe/docs* directory:**

```bash
dotnet WhatsNew.Cli.dll --owner dotnet --repo docs --startdate 7/1/2020 --enddate 7/5/2020 --savedir /Users/janedoe/docs
```

## Command line options

| Option                | Description | Example |
| --------------------- | ----------- | ------- |
| `owner`*| The GitHub organization name. | `--owner MicrosoftDocs` |
| `repo`*    | The name of the GitHub repository within the provided organization. | `--repo azure-docs-pr` |
| `docset` | The product name within the provided repository. Required only for monolithic repos, such as *azure-docs-pr*. | `--docset cognitive-services` |
| `branch` | The branch name within the provided repository. If not provided, the repository's default branch is used. | `--branch dev` |
| `startdate` | A range start date in a valid format. For example, "yyyy-MM-dd" or "MM/dd/yyyy". | `--startdate 7/1/2020` |
| `enddate`  | A range end date in a valid format. For example, "yyyy-MM-dd" or "MM/dd/yyyy". | `--enddate 7/15/2020` |
| `savedir`   | An absolute directory path to which the generated Markdown file should be written. | `--savedir C:\whatsnew` |
| `savefile`  | The path to an existing file that should be modified by the tool. | `--savefile ./docs/ide/whats-new-visual-studio-docs.md` |
| `reporoot`   | An absolute directory path to the root folder of your repository. Default is "./" | `--reporoot C:\source\dotnet\docs`|
| `localconfig` | An absolute file path for a local JSON configuration file. Intended for local testing only. | `--localconfig C:\configs\.whatsnew.json` |

*Indicates a required option

When the `startdate` or `enddate` arguments are omitted, they default to the first and last days of the previous month, respectively.

The `reporoot` setting is used to read the titles from changed files. If you run the tool from a folder other than the root of your repo, you must set this option to point to the local copy of your repo.

## Configuration file settings

The following properties are supported in the JSON configuration file.

### Top-level properties

| Property            | Description | Example |
| --------------------| ----------- | ------- |
| `areas`*            | A list of key-value pairs used to specify the directories within `rootDirectory` to process. The `names` property is an array that represents the directory name(s). The `heading` property represents the heading text to appear in the generated Markdown file. | `"areas": [{ "names": [ "getting-started", "quickstarts" ], "heading": "Getting started"}]` |
| `docLinkSettings`*  | Settings to control the construction of links to docs in the generated Markdown. See [docLinkSettings properties](#doclinksettings-properties). | `"docLinkSettings": { "linkFormat": "relative", "relativeLinkPrefix": "/dotnet/" }` |
| `docSetProductName`*| The name of the product supported by this docset. This value is used in the H1 heading and other locations in the generated Markdown file. | `"docSetProductName": ".NET"` |
| `rootDirectory`*    | The GitHub repository's root directory path containing the docs. | `"rootDirectory": "docs/"` |
| `inclusionCriteria` | Settings to control the inclusion/exclusion of PRs and community contributors. See [inclusionCriteria properties](#inclusioncriteria-properties). | `"inclusionCriteria": { "additionalMicrosoftOrgs": [ "ASP.NET" ], "minAdditionsToFile": 60 }` |
| `navigationOptions` | Settings used to update the index.yml and toc.yml files. If null, those files aren't updated. | `"navigationOptions": { "maximumNumberOfArticles": 3, "tocParentNode": "What's new", "repoTocFolder": "docs/whats-new", "indexParentNode": "Find .NET updates", "repoIndexFolder": "docs/whats-new" }` |

*Indicates a required property

### `inclusionCriteria` properties

| Property              | Description | Example |
| --------------------- | ----------- | ------- |
| `omitPullRequestTitles` | A flag indicating whether to display pull request titles in the generated Markdown file. Default value: `false` | `"omitPullRequestTitles": true` |
| `labels` | A list of GitHub label filters to apply. The label filters will be converted to a space-delimited string. Default value: `[]` | `"labels": [ "label:cognitive-services/svc" ]` |
| `maxFilesChanged` | The maximum number of changed files that a pull request can contain before being ignored. Default value: `75` | `"maxFilesChanged": 50` |
| `minAdditionsToFile` | The minimum number of lines changed that a pull request file must contain before being included. Default value: `75` | `"minAdditionsToFile": 62` |
| `pullRequestTitlesToIgnore` | A comma-delimited list of regular expressions matching pull request titles to ignore. | `"pullRequestTitlesToIgnore": [ "^Confirm merge from repo_sync_working_branch", "^Repo sync for protected CLA branch" ]` |

### `docLinkSettings` properties

| Property              | Description | Example |
| --------------------- | ----------- | ------- |
| `linkFormat`* | The Markdown format to use when creating links to docs. Possible values: `relative`, `siteRelative`, `xref`.<br><br>`siteRelative` links don't include file extensions; `relative` links do. | `"linkFormat": "relative"` |
| `relativeLinkPrefix` | The path that prefixes the doc link. Required when `linkFormat` is set to `relative` or `siteRelative`. | `"relativeLinkPrefix": "/dotnet/"` |

*Indicates a required property
