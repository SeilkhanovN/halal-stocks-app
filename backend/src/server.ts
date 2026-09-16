import Fastify from "fastify";
const app = Fastify();
app.get("/", async () => ({ status: "ok" }));
app.listen({ port: 3000 }, () => console.log("backend running on :3000"));