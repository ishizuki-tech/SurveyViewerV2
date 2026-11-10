# Survey Viewer V2

A read-only browser for the Survey2026 V2 export repositories. The Vite and TypeScript app runs as a static site.

## Run locally

Use Node.js 24.10 or newer.

```sh
npm ci
npm run index
npm run dev
```

`npm run index` uses the public GitHub API. Set `SURVEY_GITHUB_TOKEN` or `GITHUB_TOKEN` in the generator's environment if the anonymous API rate limit is exhausted. The generator sends the token only to the GitHub API and keeps it out of the index and browser bundle.

## Data flow

- `scripts/github-index.ts` resolves the latest `main` commit of each export repository independently and discovers V2 survey JSON under `YYYY-MM-DD/survey/`. It validates the date and UTC stamp against the UUIDv7 in each filename. If the recursive Git tree is truncated, discovery walks the dated survey directories.
- `scripts/generate-index.ts` atomically writes the ignored `public/survey-index.json`. Each source carries its commit SHA, and each survey entry contains only its path, completion status and optional export time. Generation keeps the previous index if either source fails.
- The browser fetches the selected JSON and individual WAVs from the source's pinned commit on `raw.githubusercontent.com`. WAV references must match the survey's date, device and UUID, the recording ID, and the exporter's question segment or SHA-256 fallback. A newly uploaded WAV or survey appears after the index is refreshed.
- Each WAV has its own player, recording ID, prompt association and transcription result when those fields are available. Follow-up positions are one-based. Early V2 records can expose the recording UUID in the WAV filename while omitting prompt kind and transcription fields. The viewer displays those fields as unavailable and preserves the JSON as supplied for inspection.

The contract was verified against [Survey2026 main at d6951dd](https://github.com/ishizuki-tech/Survey2026/tree/d6951dd2af491fab443139a750cfd228b5632303), including `V2ArtifactPaths.kt`, `SurveyExportJsonBuilder.kt`, `RecordingPrompt.kt`, and `SurveyRecordings.kt`. The data sources are [Production](https://github.com/ishizuki-tech/SurveyExports) and [Development](https://github.com/ishizuki-tech/SurveyExports-Dev).

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:live
```

The browser tests serve the production bundle at `/SurveyViewerV2/` and intercept requests with synthetic JSON and WAV fixtures. Set `SURVEY_CHROME_CHANNEL=chrome` to use an installed Google Chrome. Live tests read both public repositories and verify referenced WAV signatures and CORS headers.

## GitHub Pages

`.github/workflows/pages.yml` runs from `main` every 15 minutes at minutes 07, 22, 37, and 52 UTC. It also supports manual dispatch. Set the repository's Pages source to **GitHub Actions**. Each run checks the code, regenerates the index, and builds the static site. The Vite bundle uses relative asset paths for project-site URLs. See [GitHub's custom workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow compares the new build with a fingerprint served by the published site. A change to either source commit or the built site triggers publication. The index generation timestamp alone leaves the current release in place. A missing fingerprint allows the first deployment. Other lookup failures stop the run so the next refresh can retry against the published site.

A survey JSON may arrive before its WAVs. The viewer keeps reading both from the same pinned commit and shows an unavailable message when playback fails. Once a later commit contains the WAV, the next successful refresh publishes the new source revision. Reload the viewer to pick up that snapshot. GitHub may delay or drop scheduled runs, so the 15-minute interval is a target. See [GitHub's schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
