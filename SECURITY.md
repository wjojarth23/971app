# Security Policy

Please report security issues privately instead of opening a public issue.

Send a clear report with reproduction steps, affected routes or files, and impact. Do not include active production secrets in the report.

## Supported Versions

Security fixes are handled on the default branch unless a maintained release branch is documented.

## Secret Handling

- Do not commit `.env` files or real credentials.
- Rotate any credential that may have been exposed.
- Keep `API_KEY_DIGEST_SECRET` stable per deployment; changing it invalidates existing API keys.
