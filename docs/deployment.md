# Deployment

Euler deploys natively with
[deployctl](https://github.com/NickAwrist/deployctl), which supervises it with
systemd.

```bash
deployctl create git@github.com:NickAwrist/euler.git --name euler
deployctl deploy euler --build
```

In production one backend process serves the built UI and the API on
`EULER_BACKEND_HOST:EULER_BACKEND_PORT`, by default `127.0.0.1:3000`.

## Environment

Set variables with `deployctl env set`, then restart:

```bash
deployctl env set euler EULER_BACKEND_PORT=3100
deployctl restart euler
```

[Configuration](configuration.md) lists the variables.

## HTTPS

Leave the backend on loopback and reach it through
[Tailscale Serve](https://tailscale.com/kb/1312/serve):

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
deployctl env set euler EULER_PUBLIC_URL=https://<machine>.<tailnet>.ts.net
deployctl restart euler
```

Open Euler at that address in the browser and in the iPhone app.
`EULER_PUBLIC_URL` sets the HTTPS callback for MCP
[OAuth](customization.md#oauth).

- **Reveal file** stays limited to a browser on the server's own machine.
- A browser keeps its user UUID per address, so the first visit at the new
  address starts as a new user. Copy the UUID from **Settings > General** at
  the old address and paste it into **Switch UUID** at the new one.

Plain HTTP still works: set `EULER_BACKEND_HOST=0.0.0.0` and open
`http://<host>:<port>` (see [OAuth](customization.md#oauth) for MCP sign-in
limits over HTTP).

## Updating

```bash
deployctl update euler --build
deployctl deploy euler
deployctl status euler
```

`update --build` prepares a release and `deploy` applies it. `status` shows the
applied release and its source SHA.

## Build and data

[deployctl.yaml](../deployctl.yaml) installs dependencies, builds the UI into
`dist/`, and runs `bun run src/server.ts`.

The SQLite database, workspaces, workspace trash, and ChatGPT credentials live
in `DEPLOYCTL_DATA_DIR`, which deployctl provides and keeps across releases.
`EULER_DB_PATH` and `EULER_DATA_ROOT` override it, so leave both unset under
deployctl.
