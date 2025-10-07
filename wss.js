import * as ws from "ws";
import Logger from "./logger.js";

/**
 * @param {ws.WebSocketServer} server
 * @param {ws.WebSocket} client
 * @param {Logger} wssLogger
 */
function handleClient(_server, client, _wssLogger) {
    client.on("message", data => {
        // Validation
        {
            if (typeof data !== "string") return;
            let valid = true;
            try {
                JSON.parse(data);
            } catch (e) {
                valid = false;
            }
            if (!valid) return;
            if (typeof data.type !== "string") return;
        }

        switch (data.type) {
            case "":
                break;
            default:
                break;
        }
    });
}

export default function wss(port = 3001) {
    const wssLogger = new Logger("wss");
    const server = new ws.WebSocketServer({ port });
    server.on("listening", _ => wssLogger.log(`Listening on port ${port}`));
    server.on("connection", client => {
        wssLogger.log("Client connected");
        handleClient(server, client, wssLogger);
        client.on("close", _ => {
            wssLogger.log("Client disconnected");
        });
    });
    return server;
}
