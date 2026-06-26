// SSE 实时行情流（PhoneApp 专用，独立实现）。
// 前端用 EventSource('/api/stream') 订阅，后端 streamManager 每 2s 抓取后即推送。
// 15s 心跳保活，防止代理/浏览器断开空闲连接。

import { subscribe } from "@/lib/streamManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller 已关闭，忽略
        }
      };

      unsubscribe = subscribe((payload) => send(payload));

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* 已关闭 */
        }
      }, 15000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
