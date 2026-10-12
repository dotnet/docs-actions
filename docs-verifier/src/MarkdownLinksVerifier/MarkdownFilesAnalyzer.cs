using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using MarkdownLinksVerifier.Configuration;
using MarkdownLinksVerifier.LinkClassifier;
using MarkdownLinksVerifier.LinkValidator;

namespace MarkdownLinksVerifier;

/// <summary>
/// Represents an error in a local link, ie, <c>[Text](./path/to/file.md)</c> where <c>file.md</c> doesn't exist.
/// </summary>
/// <param name="File">The file that contains the link, relative to the program current directory (the repository root)</param>
/// <param name="Link">The link that is invalid</param>
/// <param name="RelativeTo"></param>
/// <param name="AbsolutePath"></param>
public record LinkError(string File, string Link, string AbsolutePath, SourceSpan UrlSpan = default);

public static class MarkdownFilesAnalyzer
{
    private readonly static MarkdownPipeline s_pipeline = new MarkdownPipelineBuilder().UsePreciseSourceLocation().Build();

    public static async Task<List<LinkError>> GetResultsAsync(
        MarkdownLinksVerifierConfiguration? config)
    {
        var result = new List<LinkError>();
        string rootDirectory = Directory.GetCurrentDirectory();
        foreach (string file in Directory.EnumerateFiles(rootDirectory, "*.md", SearchOption.AllDirectories))
        {
            string relativeFile = Path.GetRelativePath(rootDirectory, file);
            string? relativeDirectory = Path.GetDirectoryName(relativeFile);
            if (relativeDirectory is not null && config?.IsDirectoryExcluded(relativeDirectory) is true)
            {
                continue;
            }

            string? directory = Path.GetDirectoryName(file) ??
                throw new InvalidOperationException($"Cannot get directory for '{file}'.");

            MarkdownDocument document = Markdown.Parse(await File.ReadAllTextAsync(file), s_pipeline);
            foreach (LinkInline link in
                document.Descendants<LinkInline>().Where(link => link.Url is not null))
            {
                string url = link.Url!;
                LinkClassification classification = Classifier.Classify(url);
                ILinkValidator validator = LinkValidatorCreator.Create(classification, directory);
                if (!IsLinkExcluded(config, url) && validator.Validate(url, file) is { State: not ValidationState.Valid, AbsolutePathWithoutHeading: var absolutePath })
                {
                    result.Add(new LinkError(
                        relativeFile, url, absolutePath, link.UrlSpan!));
                }
            }
        }

        return result;

        static bool IsLinkExcluded(MarkdownLinksVerifierConfiguration? config, string url)
        {
            if (config is null)
            {
                return false;
            }

            return config.IsLinkExcluded(url);
        }
    }
}
