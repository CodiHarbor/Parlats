# @parlats/cli

CLI for syncing translations between your project and [Parlats](https://parlats.com).

## Install

```bash
npm i -g @parlats/cli
```

## Quick Start

1. Create an API key in your Parlats project settings
2. Set your key:
   ```bash
   export PARLATS_API_KEY=trad_...
   ```
3. Initialize your project:
   ```bash
   parlats init
   ```
4. Pull translations:
   ```bash
   parlats pull
   ```

## Commands

### `parlats init`

Set up `.parlats.yml` in your project. Walks you through selecting a preset, project, and file pattern.

```bash
parlats init
parlats init --preset next-intl --host https://parlats.com
```

**Presets:** `next-intl`, `i18next`, `next-i18next`, `react-intl`, `vue-i18n`

### `parlats pull`

Download translations from Parlats and write them to your local files.

```bash
parlats pull
parlats pull --locale es,fr
parlats pull --namespace common
parlats pull --dry-run
```

### `parlats push`

Upload local translation files to Parlats.

```bash
parlats push
parlats push --locale en
parlats push --add-only        # only push new keys, don't overwrite
parlats push --force           # skip confirmation for changed values
parlats push --dry-run
```

### `parlats status`

Show translation progress per locale.

```bash
parlats status
parlats status --json          # machine-readable output
```

## Configuration

`parlats init` creates a `.parlats.yml` file:

```yaml
host: "https://parlats.com"
project_id: "your-project-uuid"
api_key_env: "PARLATS_API_KEY"
source_locale: "en"
files:
  path: "messages/{locale}.json"
  format: "json-nested"
```

The API key is read from the environment variable specified in `api_key_env` (default: `PARLATS_API_KEY`). Add it to your `.env` file or set it in your shell.

## File Patterns

Use `{locale}` and `{namespace}` placeholders in `files.path`:

| Pattern | Example |
|---------|---------|
| `messages/{locale}.json` | `messages/en.json` |
| `public/locales/{locale}/{namespace}.json` | `public/locales/en/common.json` |
| `lang/{locale}.json` | `lang/en.json` |
| `src/locales/{locale}.json` | `src/locales/en.json` |

## License

MIT
