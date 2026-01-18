---
name: github-release
description: Create a GitHub release after pnpm publish with clear feature updates.
---

Use this skill after running `pnpm publish`.

1. Read the current version from `package.json` and set the tag name to `v<version>`.
2. Summarize changes from git commits since the last tag, or if no tags exist, from the current conversation and latest commits.
3. Draft release notes with a "## Features" section using those changes, and confirm with the user.
4. Create the GitHub release with `gh release create v<version> --title "v<version>" --notes "<notes>"`.
5. Confirm the release appears on GitHub and share the URL.
