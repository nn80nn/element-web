<div align="center">

<img src="apps/desktop/remess/build/icon.png" alt="" width="112" height="112">

# Remess

A Matrix client for people whose internet isn't very good.

</div>

Remess is a fork of [Element](https://github.com/element-hq/element-web) with a Discord-shaped
interface and a lot of attention paid to what happens when the connection drops for a few
seconds. It talks to ordinary Matrix homeservers and interoperates with ordinary Element
users — including in calls — so using it doesn't cut you off from anyone.

It installs **alongside** Element rather than upgrading over the top of it: its own app
identity, its own profile directory, its own icon. If you already run Element, both work.

---

## What's different from Element

### Surviving a bad connection

Most of this fork's weight is here. Element assumes the network is basically fine; on a
connection that stutters every few minutes, several of its timeouts turn ordinary lag into
visible breakage.

| | Element | Remess |
|---|---|---|
| Send fails because the request never left | message and everything queued behind it go red immediately | retried with backoff for ~75s |
| File upload hits the same blip | fails, pick the file again | retried with backoff, progress bar restarts |
| Lag during a call | dropped from the call after 10s | 30s of headroom before giving up |
| LiveKit media connection drops | ~45s of reconnect attempts | ~3 minutes |
| Call widget slow to answer | hangup fails at 10s, call sticks half-connected | 30s |
| Loading authenticated media | 1s to answer, or the image doesn't load | 5s |

The trade-off on the call windows is that someone who crashes or loses power keeps showing
up in the call for up to 30 seconds instead of 18. That's the intended direction: being
briefly wrong about who's present beats being ejected mid-sentence.

### Calls

- **System audio when sharing your screen** on Windows, so what you're watching is audible
  to everyone else — a checkbox in the screen-share picker.
- **Local noise suppression**, on by default (RNNoise), with an experimental DTLN
  alternative behind a second checkbox. Both run on your machine; nothing is sent anywhere.
- **See who's already in a call before you join**, as a row of avatars in the room header.
- Fixed a race where an already-running call was invisible until you restarted the client,
  and another where a transient network failure permanently disabled calls for the session.

### Look and packaging

- Discord-like purple accent throughout the call UI.
- Its own name, icon and app identity, so it doesn't collide with an Element install.
- No telemetry: Element's analytics key and crash-report endpoint are not carried over, and
  bug reports are kept local for you to download and send yourself.
- Auto-update is off. Element's update URL is deliberately absent — with it, Remess would
  quietly update itself back into Element.

## Install

Grab an installer from [Releases](https://github.com/nn80nn/element-web/releases), or build
one yourself (below).

The installer is not code-signed, so Windows SmartScreen will warn you: **More info →
Run anyway**. A self-signed certificate wouldn't help — SmartScreen judges the publisher's
reputation, not whether a signature exists.

Remess keeps its data in `%APPDATA%\Remess`, separate from Element's. It won't inherit an
existing Element login, so you'll sign in again.

## Build it yourself

You need Node 24+ and the pnpm version this repo pins, plus a checkout of the
[element-call fork](https://github.com/nn80nn/element-call) as a sibling directory.

```bash
pnpm install
```

On Windows, one script does the whole thing — call app, web app, staging, installer:

```bash
powershell -ExecutionPolicy Bypass -File apps/desktop/remess/build.ps1
```

Installers land in `apps/desktop/dist/`. `Remess Setup <version>.exe` is the one to hand to
people; there's an MSI next to it.

Pass `-SkipCall` or `-SkipWeb` to reuse the previous output of those steps while iterating.

### Linux and macOS

Those can't be cross-built from Windows — macOS packaging needs macOS tooling, and Linux
packaging needs a Linux toolchain. Run the **Build Remess** workflow from the Actions tab
instead; it builds all three platforms on GitHub's runners and attaches the results to the
run. Linux comes out as `.deb`, `.AppImage`, `.pacman` and a plain tarball; macOS as a
universal `.dmg` and `.zip`.

> The call UI is a separate app embedded as a widget, and a plain web build will happily
> copy the **stock** Element Call over the top of our fork — which is why the build script
> checks for a fork-only marker and refuses to continue if it isn't there.

## Compatibility

Nothing here changes the Matrix protocol or the call signalling. Every change is local to
this client: different retry behaviour, different timeouts, different branding. Remess users
and Element users share rooms and calls normally.

## Relationship to upstream

This tracks `element-hq/element-web` and is not affiliated with Element. Upstream's own
README, including the browser support policy and contribution guide, is preserved at
[README.upstream.md](README.upstream.md).

Licensing is unchanged from upstream — see the LICENSE files in the repository root.
