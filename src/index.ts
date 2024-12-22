import { Hono } from 'hono'
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

export class Relay extends DurableObject {
  sender?: WebSocket;
  receiver?: WebSocket;
  step: Step;
  fileName?: string;
  fileSize?: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.step = Step.Metadata;

    ctx.blockConcurrencyWhile(async () => {
      this.step = (await ctx.storage.get('step')) || Step.Metadata;
      this.fileName = await ctx.storage.get('fileName');
      this.fileSize = await ctx.storage.get('fileSize');

      ctx.getWebSockets().forEach(ws => {
        const { role } = ws.deserializeAttachment();
        if (role == Role.Sender) this.sender = ws;
        else this.receiver = ws;
      })
    });
  }

  set_sender() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: Role.Sender })
    this.sender = server;
    this.ctx.waitUntil(new Promise(res => {
      server.send(JSON.stringify({id: this.ctx.id.toString()}));
      res(null);
    }))
    return new Response(null, { status: 101, webSocket: client });
  }

  set_receiver() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: Role.Receiver })
    this.receiver = server;
    this.ctx.waitUntil(new Promise(res => {
      server.send(JSON.stringify({fileName: this.fileName, fileSize: this.fileSize}));
      res(null);
    }))
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: any) {
    if (ws == this.sender) {
      if (this.step == Step.Metadata) {
      const { fileName, fileSize } = JSON.parse(msg);
      this.fileName = fileName;
      this.fileSize = fileSize;
      this.step = Step.Approval;
      }

      if (this.step == Step.Transfer) {
        this.receiver?.send(msg)
      }
    }

    if (ws == this.receiver) {
      if (this.step == Step.Approval) {
        if (msg == "LET_IT_RIP") {
          this.step = Step.Transfer;
          this.sender?.send(msg);
        }
      }
    }
  }

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname == '/send') 
      return this.set_sender();
    else
      return this.set_receiver();
  }
}

type Bindings = {
  RELAY: DurableObjectNamespace<Relay>
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/send', (c) => {
  const upgrade = c.req.header('Upgrade');
  if (!upgrade || upgrade != 'websocket')
    return new Response("Exepected websocket upgrade", { status: 426 });

  const id = c.env.RELAY.newUniqueId();
  const relay = c.env.RELAY.get(id);
  return relay.fetch(c.req.raw)
})

app.get('/get/:id', (c) => {
  const upgrade = c.req.header('Upgrade');
  if (!upgrade || upgrade != 'websocket')
    return new Response("Exepected websocket upgrade", { status: 426 });

  const id = c.env.RELAY.idFromString(c.req.param('id'));
  const relay = c.env.RELAY.get(id);
  return relay.fetch(c.req.raw)
})

// HTML
app.get('/sender', (c) => c.html(sender))
app.get('/receiver', (c) => c.html(receiver))

export default app;