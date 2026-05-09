# AIStemSplitter GitHub Action

Create an AIStemSplitter audio split from a direct audio URL in GitHub Actions.

- Homepage: https://aistemsplitter.org
- API docs: https://aistemsplitter.org/developers/api
- API base: `https://api.aistemsplitter.org/v1`

## Usage

```yaml
jobs:
  split-audio:
    runs-on: ubuntu-latest
    steps:
      - uses: aistemsplitter/aistemsplitter-action@v0.1.0
        id: split
        with:
          api-key: ${{ secrets.AISTEMSPLITTER_API_KEY }}
          audio-url: https://example.com/song.mp3
          stem-model: 6s
          wait: 'true'

      - run: echo "Split ${{ steps.split.outputs.split-id }} is ${{ steps.split.outputs.status }}"
```

## Credits

```yaml
- uses: aistemsplitter/aistemsplitter-action@v0.1.0
  id: credits
  with:
    operation: credits
    api-key: ${{ secrets.AISTEMSPLITTER_API_KEY }}
```

## Development

```sh
npm test
```
