# Google Scholar OA Status

A Chrome extension that displays open access (OA) status badges on Google Scholar search results, helping researchers quickly identify articles that are legally available to everyone (e.g. for inclusion in reading lists, or use as examples in research software).

## Features

- **OA Status Badges**: Colored lock icons indicate the open access status of each article
- **DOI Detection**: Extracts DOIs directly from Google Scholar pages, with OpenAlex API fallback
- **Clickable Badges**: Lock icons link directly to the open access version when available
- **Info Popups**: Click the DOI indicator (●) to see details and copy DOI/OA links
- **Configurable**: Choose which OA types to display, set your email for API access

## OA Status Types

| Status | Color | Description |
|--------|-------|-------------|
| **Gold OA** | Yellow (#D2C152) | Published open access in an OA journal |
| **Green OA** | Green (#4CAF50) | Repository/preprint version available |
| **Bronze OA** | Bronze (#BB8A21) | Free to read but no open license |
| **Hybrid OA** | Blue (#2196F3) | OA article in a subscription journal |
| **Closed** | Gray (#9E9E9E) | Subscription required (optional display) |
| **Unknown** | — | DOI not found in Unpaywall (no badge) |

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `gs_oa_status` folder

### Configuration

On first install, the options page opens automatically. Configure:

- **Email Address** (required): Used for API access to OpenAlex and Unpaywall
- **Display Options**: Choose which OA status types to show
- **Cache**: View statistics and clear cached data

## How It Works

1. **DOI Extraction**: The extension first attempts to extract DOIs directly from links within each Google Scholar result
2. **OpenAlex Fallback**: For articles without DOIs in the page, queries the OpenAlex API to resolve titles to DOIs
3. **OA Status Lookup**: Sends DOIs to the Unpaywall API (via background worker) to retrieve open access status
4. **Badge Display**: Shows colored lock icons next to article titles, linking to OA versions when available

## APIs Used

- **[OpenAlex](https://openalex.org/)** - Free scholarly metadata API for DOI resolution
- **[Unpaywall](https://unpaywall.org/)** - Free API for open access status lookup

Unpaywall requires an email address for access; OpenAlex uses an email address to grant access to their "polite pool" (faster rate limits).

## Privacy

- Your email is only sent to OpenAlex and Unpaywall APIs as required for their terms of service
- DOI lookups and OA status are cached locally in your browser
- No data is sent to any other third parties

## File Structure

```
gs_oa_status/
├── manifest.json       # Extension configuration
├── content.js          # Main content script (GS page interaction)
├── background.js       # Service worker (Unpaywall API calls)
├── styles.css          # Badge and popup styling
├── popup.html/js       # Quick toggle popup
├── options.html/js     # Settings page
└── icons/              # Extension icons
```

## Caching

- **DOI mappings**: Cached indefinitely (DOIs don't change)
- **OA status**: Cached for 7 days (OA status can change over time)
- Cache can be cleared from the options page

## Browser Support

- Chrome (Manifest V3)
- Should work on other Chromium-based browsers (Edge, Brave, etc.)

## Known Limitations

- Only works on Google Scholar search result pages
- DOI detection depends on DOIs being present in page links or OpenAlex having the title indexed
- Some articles may show "Unknown" status if the DOI isn't in Unpaywall's database

## Accuracy Note

⚠️ **DOI matching is not 100% reliable.** When DOIs cannot be extracted directly from the page, the extension uses title-based matching via OpenAlex, which may occasionally return incorrect matches. The OA status displayed should be accurate enough to facilitate quick orientation among search results, but should be verified before relying on it for critical decisions (e.g., confirming an article can be legally shared).

## License

MIT License - see [LICENSE](LICENSE) file

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

- [Unpaywall](https://unpaywall.org/) for their excellent open access database
- [OpenAlex](https://openalex.org/) for their free scholarly metadata API
