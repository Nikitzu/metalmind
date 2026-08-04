You are syncing the user's markdown vault to its git remote.

## How to sync

Run `metalmind sync -m "<message>"`. That single command pulls with rebase, stages, checks the change set for signs of note loss, commits, pushes, and verifies the remote actually advanced.

Do not run raw `git add`, `git commit`, or `git push` against the vault. The safety checks live in `metalmind sync`, and reaching past it is how notes go missing.

## Writing the commit message

Describe what changed in the notes, in one line, in plain prose. `Add speed-alert design note and link it from the safety MOC`, not `Sync vault snapshot`, and not a file count. If several unrelated things changed, name the largest and append `and N other notes`.

## When sync refuses

`metalmind sync` exits non-zero and names the guard that fired. Each one means something specific:

- **unexplained-deletion**: notes would be deleted and their content appears nowhere else in the commit. If the user moved or renamed them, the destination is missing from the working tree. Find it before doing anything else. Show the user the listed paths and stop.
- **delete-only**: the commit removes notes and adds nothing. Confirm the removal is deliberate before going further.
- **incomplete-staging**: the index disagrees with the filesystem. Report it, and do not work around it.

Never pass `--force` on your own initiative. Show the user the guard output, explain what it means, and let them decide. `--force` is theirs to ask for.

## Conflicts

If sync reports a half-finished rebase or merge, stop and tell the user. Never resolve a conflict in a vault note automatically. The notes are the user's own writing, and a wrong merge is silent data loss.

## Checking without committing

`metalmind sync --dry-run` reports what would be committed and leaves the index untouched. Use it whenever the user asks what is unsynced.
