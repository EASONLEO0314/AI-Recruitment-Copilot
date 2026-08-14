# Server Deployment And Plugin Use

This document records the beta server deployment shape. It is intentionally
minimal: the Chrome extension talks to one FastAPI service, and the service
uses the bundled SQLite knowledge base plus optional DeepSeek enhancement.

## Server Runtime

- Target service URL: `http://182.92.180.136:8765`
- Health check: `GET /healthz`
- API token: required when `ARC_API_TOKEN` is set on the server.
- Runtime env file on server: `/etc/ai-recruitment-copilot.env`
- App directory on server: `/opt/ai-recruitment-copilot`
- systemd service: `ai-recruitment-copilot.service`

The token is not committed. The packaged extension is built with:

```bash
VITE_ARC_API_BASE_URL=http://182.92.180.136:8765 \
VITE_ARC_API_TOKEN=<shared-token> \
npm run build:extension
```

## User Installation

For the current beta, users install the unpacked Chrome extension:

1. Receive the packaged extension ZIP from the project owner.
2. Unzip it to a local folder.
3. Open Chrome and visit `chrome://extensions`.
4. Enable Developer mode.
5. Click "Load unpacked" and select the unzipped `dist` folder.
6. Open an authorized BOSS candidate page and confirm the floating panel shows
   "评分服务在线".

Users do not need Node.js, Python, SQLite, or a local `.env` for the server
build. They only need Chrome, network access to the service, and access to
candidate pages they are allowed to view.

## Update Flow

After code or server-token changes:

1. Rebuild the extension with the server URL and token.
2. Repackage the new `extension/dist` folder.
3. Ask users to remove or reload the old unpacked extension.
4. Users load the new unzipped `dist` folder.

The current beta token is a shared bearer token embedded in the extension
bundle. It is good enough to avoid a completely open public API, but it is not
account-level authentication. Before broader rollout, replace it with per-user
auth, HTTPS, rate limits, and log retention controls.
