import { app } from "@azure/functions";
import { createHandlers } from "./http";

app.setup({ enableHttpStream: true });
const handlers = createHandlers();
app.http("chat", { route: "chat", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.chat });
app.http("health", { route: "health", methods: ["GET", "OPTIONS"], authLevel: "anonymous", handler: handlers.health });
app.http("feedback", { route: "feedback", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.feedback });
app.http("profile", { route: "profile", methods: ["GET", "POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.profile });
app.http("track", { route: "track", methods: ["POST", "OPTIONS"], authLevel: "anonymous", handler: handlers.track });
