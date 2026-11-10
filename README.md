# YouTrack for Orca

An Orca plugin that shows your YouTrack issues in the right sidebar and starts a coding agent on any
of them: in a new worktree or in the workspace you are in, with a prompt built from the issue.

This is an unofficial plugin.

![The issue list for a YouTrack query, with saved searches, sortable columns and the actions of the selected issue](images/issues.png)

| Issue details | Start work on an issue |
| --- | --- |
| ![The detail of an issue: its fields, description and comments, with Apply command and Add comment](images/issue-detail.png) | ![The Start view: run in a new worktree, project, branch name, base branch, agent, prompt template and the prompt](images/start.png) |

## Install

[Open in Orca](https://onorca.dev/plugins/maxfedorov.youtrack-for-orca?catalog=community) from the
[Orca plugin directory](https://onorca.dev/plugins), or run:

    orca plugin install maxfedorov/youtrack-for-orca

Orca shows what the plugin asks access to before you approve it (see [Permissions](#permissions)).
Then open the panel from the right sidebar, the `YT` item in the status bar, or the command palette
("YouTrack: Open panel").

## Requirements

- Orca 1.4.248 or newer.
- The [YouTrack CLI](https://github.com/JetBrains/youtrack-cli) (`youtrack`):

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
- Status bar item with the number of issues matching the panel's current query on the selected server
  (`YT: 13`); `YT: !` means signed out, `YT: ?` a query that does not parse, `YT: –` a server that
  cannot be reached. The tooltip says why. It is counted when Orca starts the plugin and after searches
  and changes in the panel, never on a timer, so the plugin sends no requests while you do not use it.
- Desktop notification when an agent started from an issue finishes.
- Command palette: "YouTrack: Open panel".

## Permissions

| Permission           | Used for                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `settings:own`       | Reading the plugin's settings below.                                                     |
| `storage:own`        | The chosen server, the last query of each server, prompt templates, which workspace was started for which issue, and the project remembered for each YouTrack project. |
| `workspace:read`     | Listing workspaces for Start and Open, finding the focused one, and forgetting links to removed workspaces. |
| `workspace:write`    | The Open button (switches to the issue's workspace) and opening the right sidebar.        |
| `agent:read`         | Noticing when an agent started from an issue has finished.                               |
| `agent:launch`       | Starting an agent in the current workspace when the Orca CLI cannot.                     |
| `notifications:show` | The "Agent finished" notification.                                                       |

The plugin runs code in Orca (`trusted-worker`), because it starts the `youtrack` and `orca` command
line tools.

## What the plugin runs

Only two programs, always with an argument list and never through a shell:

- `youtrack`, to read issues, comments and saved searches, save a search, apply a command, add a
  comment, add a server through the browser and remove a server;
- `orca`, to list projects and branches, create worktrees and launch agents.

The plugin makes no network requests of its own, stores no tokens and collects no data about you;
everything that talks to YouTrack goes through the CLI.

## Security notes

- The plugin works through the YouTrack CLI and the token you signed it in with. The CLI keeps the
  token; the plugin never sees it.
- An agent that has shell access can run `youtrack` and so use the CLI's stored credentials. Start agents
  only where that is acceptable, and review the prompt before sending it.
- Issue text and comments are untrusted input. The default prompt tells the agent to treat them as data,
  not instructions, and the description is only included if you ask for it.

## Settings

| Setting                 | Default                                | Meaning                                                                 |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Default query           | `for: me #Unresolved`                  | Query used on first open of each server.                                 |
| Branch name template    | `{{id_lower}}-{{summary_slug}}`        | Name of the new workspace and branch.                                   |
| Default agent           | `claude`                               | Agent preselected in the Start view; empty means terminal only.         |
| Default launch mode     | New worktree                           | `New worktree` or `Current workspace`.                                  |
| Start agents without a prompt | off                              | Initial state of the "Start without a prompt" switch in the Start view. |
| Include issue description | off                                  | Initial state of the switch in the Start view.                          |
| YouTrack CLI path       | empty (auto-detect)                    | Full path to the `youtrack` executable if it is not found.              |

Placeholders for the prompt templates and the branch name template: `{{id}}`, `{{id_lower}}`, `{{summary}}`,
`{{summary_slug}}`, `{{url}}`, `{{project}}`, `{{server}}`, `{{state}}`, `{{priority}}`, `{{assignee}}`,
`{{description}}`, `{{branch}}`.

## Tip

Run `youtrack skill install` to give your agents the CLI's own skill, so they know how to use `youtrack`
beyond the commands in the prompt.

## Development

No build step and no dependencies: the panel is TSX that Orca loads as it is, and the worker is plain
JavaScript modules.

    orca plugin dev load ./     # load this folder into Orca and reload on changes
    orca plugin test ./         # unit and panel tests
    orca plugin check ./        # type-check and render the panel scenarios
    orca plugin validate ./     # manifest and file checks

## License

[MIT](LICENSE)
