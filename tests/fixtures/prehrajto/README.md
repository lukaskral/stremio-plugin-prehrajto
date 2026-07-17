# PrehrajTo HTML fixtures

These snapshots were captured on 2026-07-17 from the public PrehrajTo search and detail pages. They are used only as local parser inputs; the tests never contact PrehrajTo.

## Fixtures

### Movie

- Search URL: `https://prehraj.to/hledej/harry%20potter?vp-page=0`
- Detail URL: `https://prehraj.to/harry-potter-2-tajemna-komnata-cz-dabing-topkvalita/db75e654a52cf8d1`
- Search fixture: `search-movie.html`
- Detail fixture: `detail-movie.html`
- Expected first result: resolver ID `/harry-potter-2-tajemna-komnata-cz-dabing-topkvalita/db75e654a52cf8d1`, title `Harry Potter  2 -  Tajemná komnata CZ Dabing TOPKVALITA`, duration `9656` seconds, size `1.65 * 1073741824` bytes, and format `HD`.
- Expected detail result: `https://pf-storage4.premiumcdn.net/169834207/GjDSXMFgaiPRT8at2eSj9F58IWEtnkuBOhzxiWjCK5heXu3pSQPikWIW2uVbu9esjbCZ7CpBu3dUMZHVqiXWixbIXpUZpukPcEduZJUYet2msjQiK1ImV.mp4` from the `var sources` array and no subtitles.

### Subtitle-bearing episode

- Search URL: `https://prehraj.to/hledej/avatar%20titulky?vp-page=0`
- Detail URL: `https://prehraj.to/avatar-legenda-o-aangovi-s01e07-cz-titulky-1080p-fullhd/65d760fdf1b83`
- Search fixture: `search-series.html`
- Detail fixture: `detail-series.html`
- Expected first result: resolver ID `/avatar-legenda-o-aangovi-s01e07-cz-titulky-1080p-fullhd/65d760fdf1b83`, title `Avatar Legenda o Aangovi S01E07 CZ Titulky 1080p (FullHD)`, duration `2827` seconds, size `2.25 * 1073741824` bytes, and format `HD`.
- Expected detail result: `https://pf-storage4.premiumcdn.net/73809587/rZpHqPUPjSyaSLmtWBh6NUwqh0ZFbMFPefvzFoAuqETxJt3yhR4fvVtBjtV9H26sBdCvkuvMtqEfe1FDeH3mfgAtqzTzbFqVt4MCM2C9qTQxtrDIBEh6v.mp4` from the `videos` fallback and 37 caption tracks whose language is `cs`; the first parsed caption is `CS - 4036422 - eng`.

Signed media and subtitle query parameters were removed from the detail snapshots because they are short-lived access tokens. The media paths and parser-relevant JavaScript structure remain intact. No cookies, login responses, credentials, or authorization headers are stored.

Refresh these fixtures only when the upstream markup changes. Update this file’s source date and expected values in the same change, review the complete HTML diff, and run `npm test` before committing.
