using MarkdownLinksVerifier.LinkClassifier;

namespace MarkdownLinksVerifier.LinkValidator;

internal static class LinkValidatorCreator
{
    private static readonly OnlineLinkValidator s_onlineValidator = new();
    private static readonly MailtoLinkValidator s_mailtoValidator = new();
    private static readonly Dictionary<(string BaseDirectory, string DocfxConfigurationDirectory), LocalLinkValidator> s_localValidatorDictionary = new();

    internal static ILinkValidator Create(
        LinkClassification classification,
        string baseDirectory,
        string docfxConfigurationDirectory)
        => classification switch
        {
            LinkClassification.Online => s_onlineValidator,
            LinkClassification.Local => GetLocalLinkValidator(baseDirectory, docfxConfigurationDirectory),
            LinkClassification.Mailto => s_mailtoValidator,
            _ => throw new ArgumentException($"Invalid {nameof(classification)}.", nameof(classification))
        };

    private static LocalLinkValidator GetLocalLinkValidator(string baseDirectory, string docfxConfigurationDirectory)
    {
        var key = (baseDirectory, docfxConfigurationDirectory);
        if (s_localValidatorDictionary.TryGetValue(key, out LocalLinkValidator? cachedValidator))
        {
            return cachedValidator;
        }

        var validator = new LocalLinkValidator(baseDirectory, docfxConfigurationDirectory);
        s_localValidatorDictionary.Add(key, validator);
        return validator;
    }
}
