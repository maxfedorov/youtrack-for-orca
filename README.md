# YouTrack for Orca

An Orca plugin that shows your YouTrack issues in the right sidebar and
starts a coding agent on any of them.

## Requirements

- Orca 1.4.248 or newer.
- The YouTrack CLI (`youtrack`):

  | OS            | Install                                   |
  | ------------- | ----------------------------------------- |
  | macOS / Linux | `brew install jetbrains/utils/youtrack`   |
  | Windows       | `winget install JetBrains.YouTrackCLI`    |

- A YouTrack server known to the CLI. Add one with `youtrack auth login <url>`, or from the plugin's
  panel ("Add a YouTrack server"), which signs in through the browser. When a server has no browser
  sign-in for the CLI, the panel shows the command to run in a terminal instead: the CLI asks for a
  permanent token there, so the plugin never handles tokens.

If the CLI is missing, the panel shows the install command for your system to run in a terminal.

## Features

- Issue list for a YouTrack search query, with your saved searches in a drop-down.
- Star button (☆) to save the current query as a saved search.
- Sortable columns; the list reloads when you change the server or press Refresh.
- Issue details: description, fields and comments.
- **Apply command**: run a YouTrack command such as `State Done` on the selected issue or the open
  detail. It runs only when you press Apply or Enter.
- **Add comment**: write a comment in the issue detail and press Send (or Cmd+Enter, Ctrl+Enter off macOS);
  it gets the server's default visibility. Applying a command, adding a comment and saving a search are
  the plugin's only YouTrack writes.
- **Start**: begin work on an issue in a new worktree or in the current workspace. Pick the project,
  branch name, base branch, agent and prompt template, and edit the prompt before it is sent.
- **Prompt templates** (the gear button): named templates for the prompt. Five come built in —
  Implement feature, Investigate and fix bug, Cover with automated tests, Review and plan (no code
  changes), Refactor safely. Create, edit, delete and choose the default (up to 30 templates, 8000
  characters each); "Restore built-in templates" puts the five back without touching your own.
- **Project memory**: Start remembers the Orca project you chose for each YouTrack project (per server)
  and offers it next time. Otherwise it offers the server's default project, set in the settings view
  under Servers, and then the project of the current workspace.
- **Remove server**: the bin button next to the server choice removes the server from the YouTrack CLI
  (which signs the CLI out of it) after you confirm, and forgets what the plugin saved for it.
- Status bar item with the number of issues matching the default query on the selected server
  (`YT: 13`); `YT: !` means signed out, `YT: ?` an invalid default query. The tooltip says why.
- Desktop notification when an agent started from an issue finishes.
- Command palette: "YouTrack: Open panel".

## What the plugin runs

Only two programs: `youtrack` (to read issues and saved searches, save a search, apply a command, add a comment and remove a server) and `orca` (to create worktrees and
launch agents). The plugin makes no network requests of its own and stores no tokens; everything that
talks to YouTrack goes through the CLI.

## Security notes

- YouTrack permanent tokens have no scopes: a token can do whatever its user can do. The CLI keeps the
  token; the plugin never sees it.
- An agent that has shell access can run `youtrack` and so use the CLI's stored credentials. Start agents
  only where that is acceptable, and review the prompt before sending it.
- Issue text and comments are untrusted input. The default prompt tells the agent to treat them as data,
  not instructions, and the description is only included if you ask for it.

## Settings

| Setting                 | Default                                | Meaning                                                                 |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Default query           | `for: me #Unresolved`                  | Query used on first open and for the status bar count.                  |
| Branch name template    | `{{id_lower}}-{{summary_slug}}`        | Name of the new workspace and branch.                                   |
| Default agent           | `claude`                               | Agent preselected in the Start view; empty means terminal only.         |
| Default launch mode     | New worktree                           | `New worktree` or `Current workspace`.                                  |
| Include issue description | off                                  | Initial state of the checkbox in the Start view.                        |
| youtrack CLI path       | empty (auto-detect)                    | Full path to the `youtrack` executable if it is not found.              |

Placeholders for the prompt templates and the branch name template: `{{id}}`, `{{id_lower}}`, `{{summary}}`,
`{{summary_slug}}`, `{{url}}`, `{{project}}`, `{{server}}`, `{{state}}`, `{{priority}}`, `{{assignee}}`,
`{{description}}`, `{{branch}}`.

## Tip

Run `youtrack skill install` to give your agents the CLI's own skill, so they know how to use `youtrack`
beyond the commands in the prompt.

## Development

    orca plugin test ./
    orca plugin validate ./
    orca plugin check ./

## License

MIT
