// ============================================================
// WEBSOCKET CLIENT — auto-reconnect, typed messages
// ============================================================

import type { ServerMessage, ClientMessage } from '@bored-games/shared';

type MessageHandler = (msg: ServerMessage) => void;

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export class GameSocket {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private roomCode: string;
  private mode: 'play' | 'spectate';
  private handlers = new Map<string, MessageHandler[]>();
  private reconnectDelay = 1_000;
  private maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private pendingMessages: string[] = [];
  private latency = 0;
  private onLatencyUpdate?: (latency: number) => void;

  constructor(sessionId: string, roomCode: string, mode: 'play' | 'spectate' = 'play') {
    this.sessionId = sessionId;
    this.roomCode = roomCode;
    this.mode = mode;
  }

  // ----- Connection -----

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.intentionallyClosed = false;
    const url = `${WS_BASE}/ws?sessionId=${encodeURIComponent(this.sessionId)}&room=${encodeURIComponent(this.roomCode)}&mode=${this.mode}`;

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      if (window.__DEV__) console.log('🔌 WS connected');
      this.reconnectDelay = 1_000;

      // Send any queued messages
      for (const msg of this.pendingMessages) {
        this.ws!.send(msg);
      }
      this.pendingMessages = [];
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.dispatch(msg);
      } catch {
        console.error('Failed to parse WS message:', event.data);
      }
    });

    this.ws.addEventListener('close', (event) => {
      if (window.__DEV__) console.log(`🔌 WS closed code=${event.code} reason=${event.reason}`);
      if (!this.intentionallyClosed && event.code !== 1000) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener('error', (err) => {
      console.error('🔌 WS error:', err);
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
  }

  // ----- Send -----

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Queue for when connection opens
      this.pendingMessages.push(data);
    }
  }

  // ----- Latency -----

  setLatency(latency: number): void {
    this.latency = latency;
    this.onLatencyUpdate?.(latency);
  }

  getLatency(): number {
    return this.latency;
  }

  onLatencyChange(cb: (latency: number) => void): void {
    this.onLatencyUpdate = cb;
  }

  // ----- Event handlers -----

  on(type: ServerMessage['type'], handler: MessageHandler): () => void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);

    // Return unsubscribe function
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  off(type: ServerMessage['type'], handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  // ----- Helpers -----

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  // ----- Internal -----

  private dispatch(msg: ServerMessage): void {
    // Update latency on heartbeat ack
    if (msg.type === 'HEARTBEAT_ACK') {
      const { serverTime, clientTime } = msg.payload;
      const latency = Math.round((Date.now() - clientTime) / 2);
      this.setLatency(latency);
    }

    const handlers = this.handlers.get(msg.type) ?? [];
    for (const handler of handlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error(`Handler error for ${msg.type}:`, err);
      }
    }

    // Also fire wildcard handlers
    const wildcard = this.handlers.get('*');
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          handler(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (window.__DEV__) {
      console.log(`🔌 WS reconnecting in ${this.reconnectDelay}ms...`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }
}
