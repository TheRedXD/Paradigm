import express from "express";
import Logger from "./logger.js";
import path from "path";

let __dirname = path.resolve();

export default function web(port = 3000) {
    const webLogger = new Logger("web");
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static("static"));
    app.use((_req, res, next) => {
        res.setHeader("Permissions-Policy", 'fullscreen=*');
        next();
    });
    app.get("/", (_req, res) => {
        res.setHeader("Permissions-Policy", 'fullscreen=*');
        res.sendFile(path.join(__dirname, "views/index.html"));
    });
    app.listen(port, _ => webLogger.log(`Listening on port ${port}`));
    return app;
}
