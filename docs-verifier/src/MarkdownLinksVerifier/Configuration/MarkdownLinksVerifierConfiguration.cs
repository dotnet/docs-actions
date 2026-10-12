using System.Collections.Immutable;
using System.Text.Json.Serialization;

namespace MarkdownLinksVerifier.Configuration;

public record MarkdownLinksVerifierConfiguration(
    [property: JsonPropertyName("excludeStartingWith")] ImmutableArray<string> ExcludeStartingWith,
    [property: JsonPropertyName("excludeDirectories")] ImmutableArray<string> ExcludeDirectories = default)
{
    public bool IsLinkExcluded(string link)
        => !ExcludeStartingWith.IsDefaultOrEmpty
        && ExcludeStartingWith.Any(excludedPrefix => link.StartsWith(excludedPrefix, StringComparison.Ordinal));

    public bool IsDirectoryExcluded(string directory)
    {
        ArgumentNullException.ThrowIfNull(directory);

        if (ExcludeDirectories.IsDefaultOrEmpty)
        {
            return false;
        }

        string normalizedDirectory = NormalizePath(directory).TrimEnd('/');
        return ExcludeDirectories.Any(excludedDirectory =>
        {
            string normalizedExcludedDirectory = NormalizePath(excludedDirectory).TrimEnd('/');
            return normalizedDirectory.Equals(normalizedExcludedDirectory, StringComparison.Ordinal)
                || normalizedDirectory.StartsWith($"{normalizedExcludedDirectory}/", StringComparison.Ordinal);
        });
    }

    private static string NormalizePath(string path) => path.Replace('\\', '/');
}
