let wsUrl = "";

let client = null;

async function init() {
    wsUrl = await (await fetch("/api/server")).text();
    client = new WebSocket(wsUrl);
}

let clientCode = null;

function getClientCode() {
    return clientCode;
}

function handleMessage(message) {
    if (typeof message.type !== "string") return;
    console.log(message.type);
    switch (message.type) {
        case "client_code":
            var cc = message.clientCode;
            clientCode = cc;
            break;
        case "connect":
            streamEmitter.emit("connect");
            break;
        case "err":
            streamEmitter.emit("notification", message.data.err_text);
            break;
        default:
            break;
    }
}

function establishListeners() {
    streamEmitter.on("cancel", () => {
        console.log("Stream was cancelled");
    });
    streamEmitter.on("end", () => {
        console.log("Stream ended");
    });

    client.onopen = () => {
        console.log(`Opened websocket at ${wsUrl}`);
    }

    client.onclose = () => {
        console.log(`Closed websocket`);
        streamEmitter.emit("end");
    }

    client.onmessage = event => {
        let data = event.data;
        let message = null;
        console.log(data);
        try {
            message = JSON.parse(data);
        } catch (e) {
            message = null;
        }
        if (message === null) return;

        handleMessage(message);
    }
}

(async () => {
    await init();
    establishListeners();
})();
