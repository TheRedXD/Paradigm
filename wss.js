import * as ws from "ws";
import Logger from "./logger.js";

export default function wss(port = 3001) {
    const wssLogger = new Logger("wss");
    const server = new ws.WebSocketServer({ port });
    server.on("listening", _ => wssLogger.log(`Listening on port ${port}`));
    server.on("connection", client => {
        wssLogger.log("Client connected");
    });
    return server;
}
