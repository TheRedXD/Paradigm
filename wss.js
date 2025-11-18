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
        this.json = (o) => this.ws.send(JSON.stringify(o));
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
        this.peers = {};
        this.clientsByClientCode = {};
    }
    getServer() {
        return this.wss;
    }
    init() {
        // this.storage.setEntries({
        //     peers: {},
        //     clientsByClientCode: {},
        // });
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
    client.getClient().on("message", (raw) => {
        let data = null;
        try {
            data = JSON.parse(raw.toString());
        } catch (e) {}
        if (data === null) return;
        if (typeof data.type !== "string") return;
        switch (data.type) {
            case "join":
                if (typeof data.code !== "number") return;
                if (typeof data.intent !== "string") return;
                if (data.code < 0) return;
                if (!Number.isInteger(data.code)) return;
                if (client.storage.getEntry("initiated")) return;
                if (server.peers[data.code] !== undefined && data.intent !== "peer") {
                    client.json({
                        type: "err",
                        data: {
                            err_type: "code_already_in_use",
                            err_text:
                                "The peering code is already in use! Refresh the page and try again.",
                        },
                    });
                    return;
                }
                if (data.intent !== "head" && data.intent !== "peer") {
                    client.json({
                        type: "err",
                        data: {
                            err_type: "invalid_intent",
                            err_text:
                                "The intent provided is invalid! If you're a regular user, and see this, report to developers.",
                        },
                    });
                    return;
                }
                if (data.intent === "peer" && server.peers[data.code] === undefined) {
                    client.json({
                        type: "err",
                        data: {
                            err_type: "unknown_session",
                            err_text: "The selected session does not exist.",
                        },
                    });
                    client.getClient().close();
                    return;
                }
                client.storage.setEntry("initiated", true);
                client.storage.setEntry("code", data.code);
                client.storage.setEntry("intent", data.intent);
                if (data.intent === "head") {
                    client.storage.setEntry("preferredName", "Host");
                    server.peers[data.code] = {
                        head: client,
                        peerCode: 0,
                        peers: [],
                    };
                } else if (
                    data.intent === "peer" &&
                    server.peers[data.code] !== undefined
                ) {
                    client.storage.setEntry("preferredName", `Peer (Nonce ${server.peers[data.code].peerCode})`);
                    client.storage.setEntry("peerCode", server.peers[data.code].peerCode);
                    server.peers[data.code].peerCode = server.peers[data.code].peerCode + 1;

                    server.peers[data.code].head.json({
                        type: "peer_connect",
                        code: client.storage.getEntry("peerCode"),
                    });
                    server.peers[data.code].peers.forEach((peer) => {
                        peer.json({
                            type: "peer_connect",
                            code: client.storage.getEntry("peerCode"),
                        });
                    });

                    server.peers[data.code].peers.push(client);
                }
                client.json({
                    type: "connect",
                    code: client.storage.getEntry("code"),
                    intent: client.storage.getEntry("intent"),
                });
                break;
            case "leave":
                if (client.storage.getEntry("initiated")) {
                    client.json({
                        type: "disconnect",
                        code: client.storage.getEntry("code"),
                        reason: {
                            reason_type: "self_disconnect",
                            reason_text: "The client ended the connection.",
                        },
                    });
                    if (client.storage.getEntry("intent") === "head") {
                        server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                            peer.storage.setEntry("initiated", false);
                            peer.storage.setEntry("code", null);
                            peer.storage.setEntry("intent", null);
                            peer.storage.setEntry("peerCode", null);
                            peer.json({
                                type: "disconnect",
                                code: client.storage.getEntry("code"),
                                reason: {
                                    reason_type: "host_disconnect",
                                    reason_text:
                                        "The host has ended the session.",
                                },
                            });
                        });
                        delete server.peers[client.storage.getEntry("code")];
                    } else if (client.storage.getEntry("intent") === "peer") {
                        if (server.peers[client.storage.getEntry("code")] !== undefined) {
                            server.peers[client.storage.getEntry("code")].peers = server.peers[
                                client.storage.getEntry("code")
                            ].peers.filter((p) => p !== client);
                            server.peers[client.storage.getEntry("code")].head.json({
                                type: "peer_disconnect",
                                code: client.storage.getEntry("peerCode"),
                            });
                            server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                                peer.json({
                                    type: "peer_disconnect",
                                    code: client.storage.getEntry("peerCode"),
                                });
                            });
                        }
                    }
                    client.storage.setEntry("initiated", false);
                    client.storage.setEntry("code", null);
                    client.storage.setEntry("intent", null);
                    client.storage.setEntry("peerCode", null);
                }
                break;
            case "send":
                if (client.storage.getEntry("initiated") && data.data !== undefined) {
                    if (client.storage.getEntry("intent") == "peer") {
                        server.peers[client.storage.getEntry("code")].head.getClient().send(
                            JSON.stringify({
                                type: "data",
                                code: client.storage.getEntry("code"),
                                peerCode: client.storage.getEntry("peerCode"),
                                intent: client.storage.getEntry("intent"),
                                data: data.data,
                            }),
                        );
                    } else if (client.storage.getEntry("intent") == "head") {
                        if (typeof data.code !== "number") {
                            server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                                peer.getClient().send(
                                    JSON.stringify({
                                        type: "data",
                                        code: client.storage.getEntry("code"),
                                        intent: client.storage.getEntry("intent"),
                                        data: data.data,
                                    }),
                                );
                            });
                        } else {
                            server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                                if (peer.storage.getEntry("peerCode") == data.code) {
                                    peer.getClient().send(
                                        JSON.stringify({
                                            type: "data",
                                            code: client.storage.getEntry("code"),
                                            intent: client.storage.getEntry("intent"),
                                            data: data.data,
                                        }),
                                    );
                                    return;
                                }
                            });
                        }
                    }
                }
                break;
            case "intent":
                client.json({
                    type: "intent",
                    intent: client.storage.getEntry("intent"),
                });
                break;
            case "list":
                if (client.storage.getEntry("initiated")) {
                    client.json({
                        type: "list",
                        peersLength: server.peers[client.storage.getEntry("code")].peers.length,
                        peers: server.peers[client.storage.getEntry("code")].peers.map((p) => p.storage.getEntry("peerCode")),
                    });
                }
                break;
            case "preferred_name":
                if (client.storage.getEntry("initiated")) {
                    if (typeof data.name == "string") {
                        client.json({
                            type: "preferred_name",
                            success: true
                        });
                    } else {
                        client.json({
                            type: "preferred_name",
                            success: false
                        });
                    }
                }
                break;
            case "call":
                if (typeof data.intent == "string" && data.intent == "head") {
                    if (typeof data.code == "number") {
                        let targetClient = server.clientsByClientCode[data.code];
                        if (targetClient !== undefined) {
                            client.json({
                                type: "call_back",
                                success: true,
                                clientCode: data.code
                            })
                            targetClient.json({
                                type: "call",
                                code: client.storage.getEntry("code"),
                            })
                        } else {
                             client.json({
                                type: "call_back",
                                success: false,
                                reason: "client_code_invalid"
                            })
                        }
                    }
                }
                break;
            case "chat":
                if (client.storage.getEntry("initiated")) {

                }
                break;
        }
    });

    client.getClient().on("close", () => {
        if (client.storage.getEntry("initiated")) {
            if (client.storage.getEntry("intent") === "head") {
                if (!server.peers[client.storage.getEntry("code")]) return;
                server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                    peer.storage.setEntry("initiated", false);
                    peer.storage.setEntry("code", null);
                    peer.storage.setEntry("intent", null);
                    peer.storage.setEntry("peerCode", null);
                    peer.json({
                        type: "disconnect",
                        code: client.storage.getEntry("code"),
                        reason: {
                            reason_type: "host_disconnect",
                            reason_text: "The host has ended the session.",
                        },
                    });
                });
                delete server.peers[client.storage.getEntry("code")];
            } else if (client.storage.getEntry("intent") === "peer") {
                if (server.peers[client.storage.getEntry("code")] !== undefined) {
                    server.peers[client.storage.getEntry("code")].peers = server.peers[client.storage.getEntry("code")].peers.filter(
                        (p) => p !== client,
                    );
                    server.peers[client.storage.getEntry("code")].head.json({
                        type: "peer_disconnect",
                        code: client.storage.getEntry("peerCode"),
                    });
                    server.peers[client.storage.getEntry("code")].peers.forEach((peer) => {
                        peer.json({
                            type: "peer_disconnect",
                            code: client.storage.getEntry("peerCode"),
                        });
                    });
                }
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
            server.clientsByClientCode[
                client.storage.getEntry("clientCode")
            ] !== undefined
        );
        server.clientsByClientCode[client.storage.getEntry("clientCode")] = client;
        client.packetsOnJoin();
        handleClient(server, client);
        client.getClient().on("close", (_) => {
            server.logger.log("Client disconnected");
            delete server.clientsByClientCode[client.storage.getEntry("clientCode")];
        });
    });
    return server;
}
