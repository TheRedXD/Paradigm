let wsUrl = "";

let client = null;

async function init() {
    wsUrl = await (await fetch("/api/server")).text();
    client = new WebSocket(wsUrl);
}

let clientCode = null;

let streamingConfiguration = {
    fps: 30,
    microphone: false,
    forceAV1: false,
}

function getClientCode() {
    return clientCode;
}

function handleMessage(message) {
    if (typeof message.type !== "string") return;
    switch (message.type) {
        case "client_code":
            var cc = message.clientCode;
            clientCode = cc;
            break;
        default:
            break;
    }
}

function establishListeners() {
    client.onopen = () => {
        console.log(`Opened websocket at ${wsUrl}`);
    }

    client.onclose = () => {
        console.log(`Closed websocket`);
    }

    client.onmessage = event => {
        let data = event.data;
        let message = null;
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
