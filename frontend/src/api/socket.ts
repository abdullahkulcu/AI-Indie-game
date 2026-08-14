import { io, type Socket } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL;

export function connectSocket(token: string): Socket {
  return io(API_URL, { auth: { token } });
}
