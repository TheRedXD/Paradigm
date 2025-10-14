import * as ws from "ws";

export const errors = {
    CodeAlreadyInUse: "code_already_in_use",
    InvalidIntent: "invalid_intent",
    UnknownSession: "unknown_session",
    ClientCodeInvalid: "client_code_invalid",

    SelfDisconnect: "self_disconnect",
    HostDisconnect: "host_disconnect",
};

/**
 * @param {ws.WebSocket} socket
 * @param {string} type
 * @param {string} text
 */
export function packetErr(socket, type = "", text = "") {
    socket.send(
        JSON.stringify({
            type: "err",
            data: {
                err_type: type,
                err_text: text,
            },
        }),
    );
}
/**
 * @param {ws.WebSocket} socket
 * @param {number} code
 * @param {"head" | "peer"} intent
 */
export function packetConnect(socket, code, intent) {
    socket.send(
        JSON.stringify({
            type: "connect",
            code,
            intent
        }),
    );
}
/**
 * @param {ws.WebSocket} socket
 * @param {number} code
 * @param {string} reason_type
 * @param {string} reason_text
 */
export function packetDisconnect(socket, code, reason_type, reason_text) {
    socket.send(
        JSON.stringify({
            type: "disconnect",
            code,
            reason: {
                reason_type,
                reason_text
            }
        }),
    );
}
