import { DurableObject } from "cloudflare:workers";
import sender from './sender.html'
import receiver from './receiver.html'

enum Role {
  Sender,
  Receiver
}

enum Step {
  Metadata,
  Approval,
  Transfer
}

enum SenderStatus {
  SendingMetadata,
  SendingData,
}

type Room = {
  sender?: WebSocket,
  receiver?: WebSocket
}

export class Relay extends DurableObject {
  sessions: Map<WebSocket, any>;
  rooms: Map<string, Room>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.rooms = new Map();
    this.ctx.getWebSockets().forEach((ws) => {
      const { id, role, status } = ws.deserializeAttachment();
      this.sessions.set(ws, { role, id, status });
      let room = this.rooms.get(id);
      // Room has not been intialized
      if (!room) {
        this.rooms.set(id, role == Role.Sender ? { sender: ws } : { receiver: ws });
      } else {
        // Room has already been initalized, just needs to add this ws to it
        this.rooms.set(id, role == Role.Sender ? { sender: ws, ...room } : { receiver: ws, ...room });
      }
    });
  }

  webSocketMessage(ws: WebSocket, msg: any) {
    const { role, id, status } = this.sessions.get(ws);
    if (role == Role.Sender) {
      // if (status == SenderStatus.SendingMetadata) {
      // // This message must be a JSON with file metadata.
      

      // }
    } 
    const room = this.rooms.get(id);
    // room.receiver.send(msg);
  }

  async fetch(req: Request) {
    const path = new URL(req.url).pathname
    console.log(this.sessions);
    console.log(this.rooms);
    if (path == '/send') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      // room id
      const id = crypto.randomUUID();
      server.serializeAttachment({ id, role: Role.Sender, status: SenderStatus.SendingMetadata })
      this.sessions.set(server, id);
      this.rooms.set(id, { sender: server })
      const res = new Response(null, { status: 101, webSocket: client });
      this.ctx.waitUntil(new Promise(resolve => {
        server.send(JSON.stringify({ id }));
        resolve(null);
      }))
      return res;
    } else if (path.startsWith('/get/')) {
      const id = path.split('/')[2]
      const room = this.rooms.get(id);
      if (!room) return new Response(`room ${id} not found`, { status: 404 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id, role: Role.Receiver })
      this.sessions.set(server, id);
      this.rooms.set(id, { ...room, receiver: server })
      console.log('set the room', this.rooms)
      const res = new Response(null, { status: 101, webSocket: client });
      return res;
    }
    return new Response('bad', { status: 400 });
  }

}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path == '/send' || path.startsWith('/get/')) {
      const upgrade = request.headers.get('Upgrade');
      if (!upgrade || upgrade != 'websocket')
        return new Response("Exepected websocket upgrade", { status: 426 });

      const id: DurableObjectId = env.RELAY.idFromName('relay');
      const relay = env.RELAY.get(id);
      return relay.fetch(request);
    } else if (path == '/html/sender') {
      const res = new Response(sender)
      res.headers.set('content-type', 'text/html')
      return res;
    } else if (path == 'html/receiver') {
      const res = new Response(receiver)
      res.headers.set('content-type', 'text/html')
      return res;
    }

    return new Response('stinky', { status: 400 });
  },
} satisfies ExportedHandler<Env>;
