# Contributing to Parlats

Thanks for your interest in contributing to Parlats! Here's how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `bun install`
4. Start the database: `podman compose up -d db`
5. Run migrations: `bun run migrate`
6. Start the dev server: `bun run dev`

## Development

- **Runtime:** Bun (not Node.js)
- **Database:** PostgreSQL via `Bun.sql` (runs in a Podman/Docker container)
- **Templates:** Nunjucks (server-rendered HTML)
- **Interactivity:** HTMX + vanilla JS
- **CSS:** Tailwind CSS v4

See the README for the full development guide.

## Submitting Changes

1. Create a branch for your change
2. Submit a pull request with a clear description

## Code of Conduct

Be respectful and constructive. We're building something together.

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.
