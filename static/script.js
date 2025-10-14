let wsUrl = await (await fetch("/api/server")).text();

let client = new WebSocket(wsUrl);

function handleMessage(message) {
    if (typeof message.type !== "string") return;
    switch (message.type) {
        case "":
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

establishListeners();
