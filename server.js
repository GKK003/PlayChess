import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Chess server running");
});

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Player disconnected");
  });
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
