// Records the console of a running Remess (main window and the call widget inside it) to a
// file, so that a failure which happens minutes into a call can be read afterwards.
//
// Remess must have been started with --remote-debugging-port=9222; Remess-debug.cmd does both.
// The log goes to %USERPROFILE%\remess-debug.log. Errors, warnings and anything about calls,
// widgets, LiveKit and RTC are kept; the rest of the console is skipped so the file stays small.

const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 9222;
const LOG = path.join(os.homedir(), "remess-debug.log");
const out = fs.createWriteStream(LOG, { flags: "a" });
const log = (...a) => out.write(`${new Date().toISOString()} ${a.join(" ")}\n`);
const INTERESTING = /call|widget|livekit|rtc|membership|connection|media|audio|error|fail/i;

async function attach() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("no page yet");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, sessionId }));
    const enable = (sessionId) => {
        send("Runtime.enable", {}, sessionId);
        send("Log.enable", {}, sessionId);
        send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    };
    const text = (args) => args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 1500);

    return new Promise((resolve) => {
        ws.onopen = () => {
            log("# attached to", page.url);
            enable(undefined);
        };
        ws.onmessage = (m) => {
            const d = JSON.parse(m.data);
            const tag = d.sessionId ? `[${d.sessionId.slice(0, 4)}]` : "[page]";
            if (d.method === "Target.attachedToTarget") {
                log("# target", d.params.targetInfo.type, d.params.targetInfo.url);
                enable(d.params.sessionId);
            } else if (d.method === "Runtime.consoleAPICalled") {
                const t = d.params.type;
                const body = text(d.params.args);
                if (["error", "warning", "assert"].includes(t) || INTERESTING.test(body)) log(tag, t, body);
            } else if (d.method === "Runtime.exceptionThrown") {
                const e = d.params.exceptionDetails;
                log(tag, "EXCEPTION", (e.exception?.description || e.text || "").slice(0, 2500));
            } else if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level)) {
                log(tag, "LOG", d.params.entry.level, d.params.entry.text.slice(0, 300), d.params.entry.url || "");
            }
        };
        ws.onclose = () => {
            log("# window closed");
            resolve();
        };
    });
}

(async () => {
    log("# capture started, writing to", LOG);
    for (;;) {
        try {
            await attach();
        } catch {
            // Remess not up yet, or just restarted.
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
})();
