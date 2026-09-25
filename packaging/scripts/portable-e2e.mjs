#!/usr/bin/env node
/**
 * 便携版端到端验证脚本（只用于验证，不进入发行包）。
 *
 * 阶段（--phase）：
 *   seed             在界面里保存 API Key 并发送一条消息，读取 IndexedDB / localStorage
 *   verify           服务重启之后，用同一个浏览器用户目录再次打开，检查数据是否仍在
 *   quit             打开「关于」→ 点击「退出智能体」，检查本地服务是否关闭
 *   local            检查本地模式：/api/local/info、设置脱敏、浏览器存储中不含完整 Key
 *   seed-legacy      模拟 v1.0.0 用户：往 IndexedDB 写入旧聊天记录与旧 API Key
 *   verify-migration 检查一次性迁移结果：旧聊天记录进入 SQLite、浏览器中的完整 Key 被清除
 *
 * 用法：
 *   node packaging/scripts/portable-e2e.mjs --phase <阶段> --profile <浏览器用户目录> [--url http://127.0.0.1:8765/]
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const phase = args.get('phase') ?? 'seed'
const url = (args.get('url') ?? 'http://127.0.0.1:8765/').replace(/\/+$/, '') + '/'
const profile = path.resolve(args.get('profile') ?? path.join(tmpdir(), 'portable-e2e-profile'))
fs.mkdirSync(profile, { recursive: true })

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS / Linux（在 Mac 上做便携版端到端验收时需要）
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const browserPath = BROWSERS.find((candidate) => fs.existsSync(candidate))
if (!browserPath) {
  console.error('未找到 Chrome / Edge')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const debugPort = 9500 + Math.floor(Math.random() * 400)

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1440,900',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let nextId = 1
const pending = new Map()

function send(ws, method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }
    }, 25_000)
  })
}

async function waitForTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
        if (page) return page
      }
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(200)
  }
  throw new Error('等待浏览器调试端口超时')
}

const DOM_HELPERS = `
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const byText = (text, sel = 'button') => $$(sel).find((el) => (el.textContent || '').trim().includes(text));
  const setValue = (sel, value) => {
    const el = $(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const storageDump = () => {
    const dump = { local: {}, session: {} };
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key) || '';
      dump.local[key] = key.includes('api-key') ? '<长度 ' + value.length + '>' : value;
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key) || '';
      dump.session[key] = key.includes('api-key') ? '<长度 ' + value.length + '>' : value;
    }
    return dump;
  };
  const indexedDbDump = async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('ai-edu-agent');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return { error: '无法打开数据库' };
    if (!db.objectStoreNames.contains('conversations')) {
      db.close();
      return { count: 0, rows: [], note: '本地模式下没有 conversations 存储' };
    }
    const all = await new Promise((resolve) => {
      const request = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
    db.close();
    return { count: all.length, rows: all.map((item) => ({ title: item.title, messages: item.messages.length })) };
  };
`

async function main() {
  const target = await waitForTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
  })

  async function evaluate(expression) {
    const result = await send(ws, 'Runtime.evaluate', {
      expression: `(async () => { ${DOM_HELPERS} ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '页面执行出错')
    }
    return result.result.value
  }

  async function navigate() {
    await send(ws, 'Page.navigate', { url })
    await sleep(2800)
  }

  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await navigate()

  const report = { phase, url, browser: path.basename(browserPath) }

  if (phase === 'local') {
    report.localInfo = await evaluate(`return await (await fetch('/api/local/info')).json();`)
    report.settings = await evaluate(`return await (await fetch('/api/local/settings')).json();`)
    report.storage = await evaluate(`return storageDump();`)
    report.indexedDb = await evaluate(`return await indexedDbDump();`)
    report.shell = await evaluate(`
      return {
        title: document.title,
        composerVisible: Boolean($('[data-testid="composer"] textarea')),
        sidebar: document.body.innerText.slice(0, 300),
      };
    `)
    // 设置弹窗：便携版应显示脱敏 Key 与「重新设置」
    await evaluate(`byText('API 设置')?.click(); return true;`)
    await sleep(700)
    report.settingsModal = await evaluate(`
      const buttons = $$('button').map((el) => (el.textContent || '').trim());
      return {
        masked: $('[data-testid="masked-api-key"]')?.textContent ?? null,
        hasResetButton: buttons.includes('重新设置'),
        hasKeyInput: Boolean($('#api-key')),
        body: (document.body.innerText || '').slice(-700),
      };
    `)
    // 关闭弹窗
    await evaluate(`byText('取消')?.click(); return true;`)
    await sleep(300)
  } else if (phase === 'seed-legacy') {
    // 模拟 v1.0.0 用户：旧聊天记录 + 旧 API Key
    report.seeded = await evaluate(`
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ai-edu-agent', 1);
        request.onupgradeneeded = () => {
          const d = request.result;
          if (!d.objectStoreNames.contains('conversations')) {
            const store = d.createObjectStore('conversations', { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const now = Date.now();
      await new Promise((resolve) => {
        const tx = db.transaction('conversations', 'readwrite');
        tx.objectStore('conversations').put({
          id: 'c_legacy_1',
          title: '旧版历史（迁移测试）',
          mode: 'teacher',
          createdAt: now - 5000,
          updatedAt: now - 5000,
          messages: [
            { id: 'm_legacy_1', role: 'user', content: '这是 v1.0.0 留下的历史记录', createdAt: now - 4999 },
            { id: 'm_legacy_2', role: 'assistant', content: '迁移之后应该还能看到', createdAt: now - 4998 },
          ],
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
      localStorage.setItem('ai-edu-agent:api-key:local', 'sk-legacykey1234567890abcdef');
      localStorage.setItem('ai-edu-agent:api-settings', JSON.stringify({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }));
      return { indexedDb: await indexedDbDump(), storage: storageDump() };
    `)
  } else if (phase === 'verify-migration') {
    report.conversations = await evaluate(`return await (await fetch('/api/local/conversations')).json();`)
    report.localInfo = await evaluate(`return await (await fetch('/api/local/info')).json();`)
    report.settings = await evaluate(`return await (await fetch('/api/local/settings')).json();`)
    report.storage = await evaluate(`return storageDump();`)
    report.indexedDb = await evaluate(`return await indexedDbDump();`)
    report.sidebar = await evaluate(`return document.body.innerText.slice(0, 400);`)
  } else if (phase === 'quit') {
    await evaluate(`
      const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('关于'));
      if (button) button.click();
      return true;
    `)
    await sleep(400)
    report.about = await evaluate(`
      const buttons = [...document.querySelectorAll('button')].map((el) => (el.textContent || '').trim());
      return {
        hasQuitButton: buttons.some((text) => text.includes('退出智能体')),
        hasExportLink: Boolean(document.querySelector('a[href="/api/local/export"]')),
        buttons: buttons.filter(Boolean).slice(-8),
      };
    `)
    await evaluate(`
      const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('退出智能体'));
      if (button) button.click();
      return true;
    `)
    await sleep(1500)
    report.afterQuit = await evaluate(`return { body: document.body.innerText.slice(0, 200) };`)
  } else if (phase === 'chat') {
    // 通过界面发一条消息，验证「界面 → 本地服务 → SQLite」这条链路
    const message = args.get('message') ?? 'SQLite 落库测试：请回复一个字'
    report.message = message
    report.before = await evaluate(`return await (await fetch('/api/local/conversations')).json();`)
    await evaluate(`setValue('[data-testid="composer"] textarea', ${JSON.stringify(message)}); return true;`)
    await sleep(300)
    await evaluate(`
      const el = $('[data-testid="composer"] textarea');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    `)
    await sleep(10000)
    report.ui = await evaluate(`return document.body.innerText.slice(0, 500);`)
    report.after = await evaluate(`return await (await fetch('/api/local/conversations')).json();`)
    report.storage = await evaluate(`return storageDump();`)
  } else if (phase === 'seed') {
    report.shell = await evaluate(`
      return {
        title: document.title,
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        styleSheets: document.styleSheets.length,
        composerVisible: Boolean($('[data-testid="composer"] textarea')),
      };
    `)

    await evaluate(`byText('API 设置')?.click(); return true;`)
    await sleep(600)
    await evaluate(`setValue('#api-key', 'sk-portable-e2e-0000000000000000'); return true;`)
    await evaluate(`
      const checkbox = $('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) checkbox.click();
      return true;
    `)
    await sleep(300)
    await evaluate(`byText('保存')?.click(); return true;`)
    await sleep(1200)

    report.storageAfterSave = await evaluate(`return storageDump();`)

    await evaluate(`setValue('[data-testid="composer"] textarea', '便携版重启测试：请回复一个字'); return true;`)
    await sleep(300)
    await evaluate(`
      const el = $('[data-testid="composer"] textarea');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    `)
    await sleep(9000)

    report.uiAfterSend = await evaluate(`return { text: document.body.innerText.slice(0, 400) };`)
    report.indexedDb = await evaluate(`return await indexedDbDump();`)
  } else {
    report.indexedDb = await evaluate(`return await indexedDbDump();`)
    report.storage = await evaluate(`return storageDump();`)
    report.sidebarText = await evaluate(`return { sidebar: document.body.innerText.slice(0, 500) };`)
  }

  console.log(JSON.stringify(report, null, 2))

  try {
    await send(ws, 'Browser.close')
  } catch {
    /* ignore */
  }
  await sleep(500)
  browser.kill()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('E2E 失败：', error.message)
    try {
      browser.kill()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
