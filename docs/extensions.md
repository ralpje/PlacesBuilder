# Extension point

The core can load one extension at start. It exists so that a hosting provider can add tools that do not belong in the open-source app (the hosted edition's operator tools live in a private repository) without a fork and without copying core code.

## Switching it on

Set `EXTENSION_MODULE` to the path of a JavaScript module (absolute, or relative to the working directory). Without it nothing is loaded, and every request to `/api/ext/*` answers 404.

The module's default export is called once at start with a context and returns an object with a `handle` function:

```js
export default (ctx) => ({
  async handle({ req, url, user, path }) {
    // path: the part after /api/ext/, split and decoded
    if (path[0] !== 'hello') return null;            // null = not mine, the core answers 404
    if (!isAllowed(user)) throw new ctx.HttpError(403, 'Not allowed.');
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hi: user.name }) };
  },
});
```

## What the extension gets

| Field | Meaning |
| --- | --- |
| `cfg` | The parsed configuration. |
| `storage` | The storage the app uses (all tenants, no prefix). |
| `workspaces` | The workspace resolver. |
| `operator` | Hosted edition only: list tenants, members, file names and sizes, invite, remove, transfer ownership, delete a tenant. `undefined` in the self-host edition. |
| `audit(user, what, target?)` | Writes an audit line with the caller's `tid`; `target` is the tenant acted on. |
| `HttpError` | Throw it to answer with a status code. |

## What the core does before the extension

The request has been authenticated (Easy Auth, tenant rules, access policy), rate limited, and for changing requests has passed the `X-Requested-With` check. **Who may call an extension route is the extension's decision**: it receives the signed-in user and must check for itself (for example tenant id and a role claim). The core does not tie extension routes to a workspace.

## Trust

The extension is code that runs in the same process with the same storage access as the app. Only load a module you control. Every audit line carries the `tid` of the caller.

## Operator operations

`operator.deleteTenant` removes every file of the tenant that the storage interface can see. Blob versions kept by soft delete or versioning are not reachable through that interface; removing them is up to the extension or the hosting setup. `listTenants` lists all blobs under `tenants/` and is meant for dozens of tenants, not thousands.
