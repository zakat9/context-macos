# Parked connector (not part of the app, not verified in any client)

The connector is `node dev/workindex.js mcp`: a Model contexta Protocol server that a chat client starts as a local
process and talks to over standard input and output. It opens no network port and connects to nothing.
It can only read: list tags, list the sources linked to a tag, and read those sources as they are saved now.

- `mcp.json.example`: for clients that read an `mcpServers` block (Claude desktop app, Claude Code, Cursor and others).
- `codex-config.toml.example`: for Codex (`~/.codex/config.toml`).

Replace `/ABSOLUTE/PATH/TO/` with where this folder is. To use another index folder, add `"--home", "/path/to/folder"`
before `"mcp"`.

It has not been checked in any chat client. It has no review step: a client that calls it gets every linked source.
