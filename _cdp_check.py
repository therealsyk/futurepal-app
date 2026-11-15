import json, socket, time

def cdp(method, params=None, id_=1, timeout=15):
    s = socket.create_connection(('localhost', 9222), timeout)
    msg = {'id': id_, 'method': method}
    if params:
        msg['params'] = params
    s.sendall(json.dumps(msg).encode())
    buf = b''
    end = time.time() + timeout
    while time.time() < end:
        try:
            buf += s.recv(65536)
        except Exception:
            break
        try:
            return json.loads(buf.decode())
        except Exception:
            continue
    return {'error': 'timeout', 'raw': buf[:500]}

cdp('Runtime.enable')
print(cdp('Page.navigate', {'url': 'file:///D:/Claude%20Apps/Wallet/app/release/win-unpacked/resources/app.asar/dist/index.html'}, 2))
time.sleep(4)
expr = """JSON.stringify({
  href: location.href,
  navItems: Array.from(document.querySelectorAll('nav a')).map(a => ({text: a.textContent.trim(), href: a.href})),
  hasSidebar: !!document.querySelector('.sidebar'),
  bodyTextLen: document.body.innerText.length,
  bodySnippet: document.body.innerText.slice(0, 300)
})"""
r = cdp('Runtime.evaluate', {'expression': expr}, 3)
print(json.dumps(r.get('result', {}).get('result', {}), indent=2))
