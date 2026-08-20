# Working in a Vibeco2 chat

Each chat here runs in its own isolated git worktree/branch (`chat/<id>`) and
only reaches the team's shared branch when someone clicks **Render Preview**
— nothing merges automatically. A chat that never gets rendered just sits on
its own branch; if it's later deleted, anything only committed there (specs,
scope docs, implementation plans, decisions) is gone for good.

## Suggest wrapping up, on your own initiative

Don't wait to be asked. When you notice a natural stopping point — one large
feature landed, or several smaller fixes/features have piled up in this one
chat — say so and suggest the user:

1. Click **Render Preview** to merge this chat's work into `team` now,
   rather than leaving it stranded on an unmerged branch.
2. Start a fresh chat for the next piece of work, instead of continuing to
   pile unrelated work onto this one.

A short line is enough — e.g. "That's the sync feature done. Want to render
this to team and start a new chat for the next one?" Don't insist if the
user wants to keep going in the same chat; this is a nudge, not a gate.

This mirrors why: a chat that keeps growing past one coherent chunk of work
is both harder to hand off cleanly and more exposed to the deletion risk
above — the fix is rendering early and often, not one giant chat at the end.
