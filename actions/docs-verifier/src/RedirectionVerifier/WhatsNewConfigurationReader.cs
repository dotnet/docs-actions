﻿using System;
using System.IO;
using System.Text.Json;

namespace RedirectionVerifier
{
    public static class WhatsNewConfigurationReader
    {
        private static readonly JsonSerializerOptions s_options = new() { AllowTrailingCommas = true };
        private static WhatsNewConfiguration s_cachedWhatsNewConfiguration = null!;
        private const string WhatsNewConfigurationFileName = ".whatsnew.json";

        /// <summary>
        /// Retrieves the configured "What's new" directory from <c>.whatsnew.json</c>.
        /// </summary>
        /// <exception cref="InvalidOperationException">Failed to read <c>.whatsnew.json</c>.</exception>
        public static string? GetWhatsNewPath()
        {
            // If there are cached configuration values for "What's new", use 'em.
            if (s_cachedWhatsNewConfiguration?.NavigationOptions?.WhatsNewPath is not null)
            {
                return s_cachedWhatsNewConfiguration.NavigationOptions.WhatsNewPath;
            }

            if (File.Exists(WhatsNewConfigurationFileName))
            {
                string json = File.ReadAllText(WhatsNewConfigurationFileName);
                WhatsNewConfiguration? configuration = JsonSerializer.Deserialize<WhatsNewConfiguration>(json, s_options);
                if (configuration is null)
                {
                    throw new InvalidOperationException($"Failed to read '{WhatsNewConfigurationFileName}'.");
                }

                s_cachedWhatsNewConfiguration = configuration;
            }

            return s_cachedWhatsNewConfiguration?.NavigationOptions?.WhatsNewPath;
        }
    }
}
