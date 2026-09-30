# Release preference

The user tests this app on Windows and cannot check local changes. After completing and validating user-requested app changes, publish a new patch release automatically unless the user explicitly asks to hold the release. No additional release confirmation is needed.

Release workflow:

1. Increment the version in `desktop/package.json` and `desktop/package-lock.json` with `npm version X.Y.Z --no-git-tag-version` from `desktop`.
2. Commit the changes with a single imperative subject and no attribution trailers.
3. Push `main` and an annotated matching `vX.Y.Z` tag.
4. Monitor `.github/workflows/windows.yml` until the Windows build and release publication succeed.
5. Verify the public latest release includes the installer, blockmap, and `latest.yml`, then tell the user the version is available through Settings → General → Update → Restart.
