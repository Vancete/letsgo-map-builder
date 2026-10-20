// Drives the running editor for testing (start it with --remote-debugging-port=9223):
//   node scripts/cdp.ts shot <out.png>      screenshot of the window
//   node scripts/cdp.ts eval "<js>"         evaluate in the renderer, print the result
const port = process.env.CDP_PORT ?? '9223';
const [cmd, arg] = process.argv.slice(2);

const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string; url: string }[];
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
if (!page) throw new Error('no page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m.error ? { error: m.error } : m.result);
    pending.delete(m.id);
  }
});
const send = (method: string, params: object = {}) =>
  new Promise<any>((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(arg, Buffer.from(r.data, 'base64'));
  console.log('saved', arg);
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r, null, 1));
}
else if (cmd === 'click' || cmd === 'drag') {
  // click x y  |  drag x1 y1 x2 y2   (CSS pixels of the page)
  const n = process.argv.slice(3).map(Number);
  const ev = (type: string, x: number, y: number, buttons = 1) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  await ev('mouseMoved', n[0], n[1], 0);
  await ev('mousePressed', n[0], n[1]);
  if (cmd === 'drag') {
    for (let i = 1; i <= 12; i++) await ev('mouseMoved', n[0] + ((n[2] - n[0]) * i) / 12, n[1] + ((n[3] - n[1]) * i) / 12);
    await ev('mouseReleased', n[2], n[3], 0);
  } else await ev('mouseReleased', n[0], n[1], 0);
  console.log('ok');
}
ws.close();
export {};
