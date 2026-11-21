# Zoora's files

This folder is Zoora's identity. The brain reads it on each tick.

| File | Who may change it |
| --- | --- |
| `SOUL.md` | The owner, in the repo. Zoora reads it and cannot write it. The IMMUTABLE BOUNDARIES section is also enforced in code. |
| `GOALS.md` | The owner seeds the long, medium, and current lists. Zoora does not rewrite those bullets. |
| `STYLE.md` | The owner writes the starting taste. Remembered work can drift later. The file stays as the owner left it. |
| `RELATIONSHIPS.md` | The owner. Zoora reads it. |
| `GOALS.md` lived section | Generated from the database when the process can write this folder. The database is the record if the write fails. |

Evolving goals are rows in `zoora_goals`, with history in `zoora_goal_history`. Zoora may propose, complete, or retire a goal. The keeper approves or reverts. One Zoora goal change is allowed per Chicago day. Visitor text cannot become a goal. A flagged visitor note may inspire a goal that does not contain the note.

Active goals are shown on the world page. They bias what Zoora builds, researches, sells, and says. They cannot override the soul boundaries.
