import fs from "fs";

import web from "./web.js";
import wss from "./wss.js";

let config = JSON.parse(fs.readFileSync("config.json"));

const webApp = web(config.ports.web, config.urls);
const wssApp = wss(config.ports.wss);
