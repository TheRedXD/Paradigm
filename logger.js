export default class Logger {
    constructor(name = "") {
        this.name = name;
    }
    log(...text) {
        console.log(`[${this.name}]`, ...text);
    }
    err(...text) {
        console.log(`\x1b[31m[${this.name}]`, ...text, "\x1b[0m");
    }
    wrn(...text) {
        console.log(`\x1b[33m[${this.name}]`, ...text, "\x1b[0m");
    }
}
