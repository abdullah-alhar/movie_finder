# AfterShow project rules

These rules apply to the lead and every subagent.

## Git and delivery

Leave changes in the working tree for the owner to review. Never stage, commit, amend, merge, rebase, tag, push, force-push, create pull requests, publish releases or deploy. This includes scripts, Git aliases, GitHub CLI, APIs, connectors and delegated actions. Use git status, git diff, git log and git show for inspection. Preserve existing user edits. Run the project’s local checks after reviewing what their scripts do.

## Parallel work

The lead assigns one owner per file and records the shared interface before parallel edits. Each specialist reports changed paths, checks actually run, results and unresolved dependencies. If another agent edits an assigned file, pause edits to that file and coordinate with the lead. Use the smallest team the task needs.

## AfterShow implementation

Inspect the existing stack before making changes. Follow existing movie IDs, routes, data sources and component conventions. Keep credentials out of client bundles and logs. Preserve stored user data through migrations. For performance changes, capture a comparable baseline and repeat the same measurement after the change. Verify the requested flow and its most relevant failure case.
