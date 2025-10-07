import express from "express";
import Logger from "./logger.js";

export default function web(port = 3000) {
    const webLogger = new Logger("web");
    const app = express();
    app.use(express.static("static"));
    app.get("/", (req, res) => {
        res.send("test route");
    });
    app.listen(port, _ => webLogger.log(`Listening on port ${port}`));
    return app;
}
