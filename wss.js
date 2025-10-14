import * as ws from "ws";
import Logger from "./logger.js";

import * as packets from "./wss_packets.js";

class SimpleStorage {
    constructor() {
        this.data = {};
    }
    setEntry(key = "", value) {
        if (typeof key !== "string") return;
        if (typeof value === "undefined") {
            delete this.data[key];
            return;
        }
        this.data[key] = value;
    }
    /**
     * @param {{[key: string]: any}} obj
     */
    setEntries(obj = {}) {
        for (let key in obj) {
            if (!obj.hasOwnProperty(key)) continue;
            this.setEntry(key, obj[key]);
        }
    }
    setEntryCopy(key = "", value) {
        let newValue = structuredClone(value);
        this.setEntry(key, newValue);
    }
    /**
     * @param {{[key: string]: any}} obj
     */
    setEntriesCopy(obj = {}) {
        for (let key in obj) {
            if (!obj.hasOwnProperty(key)) continue;
            this.setEntryCopy(key, obj[key]);
        }
    }
    getEntry(key = "") {
        if (typeof key !== "string") return undefined;
        if (!this.data.hasOwnProperty(key)) return undefined;
        return this.data[key];
    }
    getEntryCopy(key = "") {
        let entryReference = this.getEntry(key);
        return structuredClone(entryReference);
    }
    /**
     * @param {string[]} keys
     * @returns {{[key: string]: any}}
     */
    getEntries(...keys) {
        if (!Array.isArray(keys)) return {};
        let values = {};
        for (let key of keys) {
            values[key] = this.getEntry(key);
        }
        return values;
    }
    /**
     * @param {string[]} keys
     * @returns {any[]}
     */
    getEntriesArr(...keys) {
        if (!Array.isArray(keys)) return [];
        let values = [];
        for (let key of keys) {
            values.push(this.getEntry(key));
        }
        return values;
    }
}

class Client {
    /**
     * @param {ws.WebSocket} ws
     */
    constructor(ws) {
        this.ws = ws;
        this.storage = new SimpleStorage();
    }
    getClient() {
        return this.ws;
    }
    init() {
        this.storage.setEntries({
            initiated: false,
            code: null,
            intent: null,
            peerCode: null,
            clientCode: null,
            preferredName: null,
        });
    }
    packetsOnJoin() {
        this.ws.send(
            JSON.stringify({
                type: "client_code",
                clientCode: this.storage.getEntry("clientCode"),
            }),
        );
    }
}
class Server {
    /**
     * @param {ws.WebSocketServer} wss
     */
    constructor(wss) {
        this.wss = wss;
        this.logger = new Logger("wss");
        this.storage = new SimpleStorage();
    }
    getServer() {
        return this.wss;
    }
    init() {
        this.storage.setEntries({
            peers: {},
            clientsByClientCode: {},
        });
    }
}

function randomDigits(num) {
    let arr = [];
    for (let i = 0; i < num; i++) {
        arr.push(Math.min(Math.floor(Math.random() * 10), 9));
    }
    let str = arr.join("");
    return parseInt(str);
}

/**
 * @param {Server} server
 * @param {Client} client
 * @param {Logger} wssLogger
 */
function handleClient(server, client) {
    client.getClient().on("message", (data) => {
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
            case "join":
                // Data validation
                if (typeof data.code !== "number") return;
                if (typeof data.intent !== "string") return;
                if (!["head", "peer"].includes(data.intent)) {
                    packets.packetErr(
                        client.ws,
                        packets.errors.InvalidIntent,
                        "The intent provided is invalid! If you're a regular user, this is an application error, and should be reported to the developers!",
                    );
                    return;
                }
                if (data.code < 0) return;
                if (!Number.isInteger(data.code)) return;

                if (client.storage.getEntry("initiated")) return;

                if (server.storage.getEntry("peers")[data.code] !== undefined && data.intent !== "peer") {
                    packets.packetErr(
                        client.ws,
                        packets.errors.CodeAlreadyInUse,
                        "The peering code is already in use! Refresh the page and try again.",
                    );
                    return;
                }
                if (data.intent === "peer" && server.storage.getEntry("peers")[data.code] === undefined) {
                    packets.packetErr(
                        client.ws,
                        packets.errors.UnknownSession,
                        "The selected session does not exist.",
                    );
                    client.ws.close();
                    return;
                }
                client.storage.setEntries({
                    initiated: true,
                    code: data.code,
                    intent: data.intent,
                });
                switch (client.storage.getEntry("intent")) {
                    case "head":
                        client.storage.setEntry("preferredName", "Host");
                        server.storage.getEntry("peers")[data.code] = {
                            head: client,
                            peerCode: 0,
                            peers: [],
                        };
                        break;
                    case "peer":
                        if (server.storage.getEntry("peers")[data.code] !== undefined) {
                            client.storage.setEntry("preferredName", `Peer (Nonce ${server.storage.getEntry("peers")[data.code].storage.getEntry("peerCode")})`);
                            client.storage.setEntry("peerCode", server.storage.getEntry("peers")[data.code]);
                            server.storage.getEntry("peers")[data.code].storage.setEntry("peerCode", server.storage.getEntry("peers")[data.code].storage.getEntry("peerCode") + 1);

                            server.storage.getEntry("peers")[data.code].head.send(JSON.stringify({
                                type: "peer_connect",
                                code: client.storage.getEntry("peerCode"),
                            }));

                            server.storage.getEntry("peers")[data.code].peers.forEach(p => {
                                p.send(JSON.stringify({
                                    type: "peer_connect",
                                    code: client.storage.getEntry("peerCode"),
                                }));
                            });

                            server.storage.getEntry("peers")[data.code].peers.push(client);
                        }
                        break;
                }
                packets.packetConnect(
                    client.ws,
                    ...client.storage.getEntriesArr("code", "intent"),
                );
                break;
            case "leave":
                if (!client.storage.getEntry("initiated")) break;
                packets.packetDisconnect(
                    client.ws,
                    client.storage.getEntry("code"),
                    packets.errors.SelfDisconnect,
                    "The client ended the connection.",
                );
                switch (client.storage.getEntry("intent")) {
                    case "head":
                        server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.forEach(peer => {
                            peer.storage.setEntries({
                                initiated: false,
                                code: null,
                                intent: null,
                                peerCode: null,
                            });
                            packets.packetDisconnect(
                                client.ws,
                                client.storage.getEntry("code"),
                                packets.errors.HostDisconnect,
                                "The host has ended the session.",
                            );
                        });
                        delete server.storage.getEntry("peers")[client.storage.getEntry("code")];
                        break;
                    case "peer":
                        if (server.storage.getEntry("peers")[client.storage.getEntry("code")] === undefined) break;

                        server.storage.getEntry("peers")[client.storage.getEntry("code")].peers = server.storage.getEntry("peers")[
                            client.storage.getEntry("code")
                        ].peers.filter(p => p !== client);

                        server.storage.getEntry("peers")[client.storage.getEntry("code")].head.send(JSON.stringify({
                            type: "peer_disconnect",
                            code: client.storage.getEntry("peerCode"),
                        }));

                        server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.forEach(p => {
                            p.send(JSON.stringify({
                                type: "peer_disconnect",
                                code: client.storage.getEntry("peerCode"),
                            }));
                        });
                        break;
                }
                client.storage.setEntries({
                    initiated: false,
                    code: null,
                    intent: null,
                    peerCode: null,
                });
                break;
            case "send":
                if (!client.storage.getEntry("initiated")) break;
                if (data.data === undefined) break;
                switch (client.storage.getEntry("intent")) {
                    case "peer":
                        server.storage.getEntry("peers")[client.storage.getEntry("code")].head.send(JSON.stringify({
                            type: "data",
                            ...client.storage.getEntries("code", "peerCode", "intent"),
                            data: data.data,
                        }));
                        break;
                    case "head":
                        if (typeof data.code !== "number") {
                            server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.forEach(p => {
                                p.send(
                                    JSON.stringify({
                                        type: "data",
                                        ...client.storage.getEntries("code", "intent"),
                                        data: data.data,
                                    }),
                                );
                            });
                        } else {
                            server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.forEach(p => {
                                if (p.peerCode == data.code) {
                                    p.send(
                                        JSON.stringify({
                                            type: "data",
                                            ...client.storage.getEntries("code", "intent"),
                                            data: data.data,
                                        }),
                                    );
                                    return;
                                }
                            });
                        }
                        break;
                }
                break;
            case "intent":
                client.ws.send(JSON.stringify({
                    type: "intent",
                    intent: client.storage.getEntry("intent"),
                }));
                break;
            case "list":
                if (!client.storage.getEntry("initiated")) break;
                client.ws.send(JSON.stringify({
                    type: "list",
                    peersLength: server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.length,
                    peers: server.storage.getEntry("peers")[client.storage.getEntry("code")].peers.map(p => p.peerCode),
                }));
                break;
            case "preferred_name":
                if (!client.storage.getEntry("initiated")) break;
                if (typeof data.name == "string") {
                    client.ws.send(JSON.stringify({
                        type: "preferred_name",
                        success: true
                    }));
                } else {
                    client.ws.send(JSON.stringify({
                        type: "preferred_name",
                        success: false
                    }));
                }
                break;
            case "call":
                if (typeof data.intent == "string" && data.intent == "head") {
                    if (typeof data.code == "number") {
                        let targetClient = server.storage.getEntry("clientsByClientCode")[data.code];
                        if (targetClient !== undefined) {
                            client.ws.send(JSON.stringify({
                                type: "call_back",
                                success: true,
                                clientCode: data.code
                            }));
                            targetClient.ws.send(JSON.stringify({
                                type: "call",
                                code: client.code,
                            }));
                        } else {
                            client.ws.send(JSON.stringify({
                                type: "call_back",
                                success: false,
                                reason: "client_code_invalid"
                            }));
                        }
                    }
                }
                break;
            default:
                break;
        }
    });

    client.ws.on("close", () => {
        if (client.storage.getEntry("initiated")) {
            let peers = server.storage.getEntry("peers");
            switch (client.storage.getEntry("intent")) {
                case "head":
                    peers[client.storage.getEntry("code")].peers.forEach(peer => {
                        peer.storage.setEntry("initiated") = false;
                        peer.storage.setEntry("code") = null;
                        peer.storage.setEntry("intent") = null;
                        peer.storage.setEntry("peerCode") = null;
                        peer.json({
                            type: "disconnect",
                            code: client.storage.getEntry("code"),
                            reason: {
                                reason_type: "host_disconnect",
                                reason_text: "The host has ended the session.",
                            },
                        });
                    });
                    delete peers[client.storage.getEntry("code")];
                    break;
                case "peer":
                    if (peers[client.storage.getEntry("code")] !== undefined) {
                        peers[client.storage.getEntry("code")].peers = peers[client.storage.getEntry("code")].peers.filter(
                            (p) => p !== client,
                        );
                        peers[client.storage.getEntry("code")].head.json({
                            type: "peer_disconnect",
                            code: client.storage.getEntry("peerCode"),
                        });
                        peers[client.storage.getEntry("code")].peers.forEach(peer => {
                            peer.send(JSON.stringify({
                                type: "peer_disconnect",
                                code: client.storage.getEntry("peerCode"),
                            }));
                        });
                    }
                    break;
            }
        }
    });
}

export default function wss(port = 3001) {
    let server = new Server(new ws.WebSocketServer({ port }));

    server.init();

    server
        .getServer()
        .on("listening", (_) => server.logger.log(`Listening on port ${port}`));
    server.getServer().on("connection", (cl) => {
        server.logger.log("Client connected");
        let client = new Client(cl);
        client.init();
        do {
            client.storage.setEntry("clientCode", randomDigits(6));
        } while (
            server.storage.getEntry("clientsByClientCode")[
                client.storage.getEntry("clientCode")
            ] !== undefined
        );
        client.packetsOnJoin();
        handleClient(server, client);
        client.getClient().on("close", (_) => {
            server.logger.log("Client disconnected");
        });
    });
    return server;
}
