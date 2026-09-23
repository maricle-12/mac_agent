/**
 * 无依赖 UI 自动化检查（基于 Chrome DevTools Protocol）。
 *
 * 覆盖：首屏渲染、Markdown/公式渲染、空状态、快捷卡片、发送与模拟回答、
 *       停止生成、API 设置弹窗、删除确认、移动端侧边栏抽屉，
 *       并收集 console 错误 / 未捕获异常 / 浏览器日志错误。
 *
 * 用法：
 *   node scripts/ui-check.mjs [url]
 * 环境变量：
 *   CHROME_PATH  指定浏览器可执行文件路径
 *   HEADFUL=1    显示浏览器窗口（默认无头）
 *   CHROME_PROXY 让被测浏览器走代理，例如 http://127.0.0.1:7897
 *   WORKER_URL   被测页面所连的 Worker 地址（默认 http://127.0.0.1:8787）
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:5173/'
const headful = process.env.HEADFUL === '1'

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const browserPath = candidates.find((item) => existsSync(item))
if (!browserPath) {
  console.error('未找到 Chrome / Edge，请设置 CHROME_PATH 环境变量')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const userDataDir = mkdtempSync(join(tmpdir(), 'ui-check-'))
const port = 9000 + Math.floor(Math.random() * 900)

const browser = spawn(
  browserPath,
  [
    headful ? '--headless=false' : '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1440,900',
    // 本机需要代理才能访问外网时（例如国内访问 *.pages.dev / *.workers.dev），
    // 用 CHROME_PROXY=http://127.0.0.1:7897 让被测浏览器也走代理。
    ...(process.env.CHROME_PROXY ? [`--proxy-server=${process.env.CHROME_PROXY}`] : []),
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let nextId = 1
const pending = new Map()
const consoleErrors = []
const exceptions = []
const logErrors = []
/** 有意触发的 4xx 请求会让浏览器记录一条 network 日志，这里单独容忍 */
let toleratedNetworkErrors = 0

function send(ws, method, params = {}, sessionId) {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 调用超时: ${method}`))
      }
    }, 20000)
  })
}

async function waitForVersion() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // 浏览器还没起来
    }
    await sleep(250)
  }
  throw new Error('等待 Chrome 调试端口超时')
}

/** 在页面中执行表达式并取回值（表达式内可以使用 await） */
async function evaluate(ws, sessionId, expression) {
  const result = await send(
    ws,
    'Runtime.evaluate',
    { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '页面执行出错')
  }
  return result.result.value
}

/** 直接读取 IndexedDB，用于校验持久化结果而不是只看界面 */
const DB_DUMP_EXPR = `
  const db = await new Promise((resolve) => {
    const request = indexedDB.open('ai-edu-agent');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  if (!db) return { error: '无法打开数据库' };
  const all = await new Promise((resolve) => {
    const request = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve([]);
  });
  db.close();
  return { count: all.length, rows: all.map((item) => item.title + '(' + item.messages.length + ')') };
`

/** 页面内可复用的 DOM 辅助函数（注入到每个表达式前） */
const DOM_HELPERS = `
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const byText = (text, sel = 'button') =>
    $$(sel).find((el) => (el.textContent || '').trim().includes(text));
  const clickText = (text, sel = 'button') => {
    const el = byText(text, sel);
    if (!el) return false;
    el.click();
    return true;
  };
  const byExact = (text, sel = 'button') =>
    $$(sel).find((el) => (el.textContent || '').trim() === text);
  const clickExact = (text, sel = 'button') => {
    const el = byExact(text, sel);
    if (!el) return false;
    el.click();
    return true;
  };
  const setValue = (sel, value) => {
    const el = $(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const pressEnter = (sel) => {
    const el = $(sel);
    if (!el) return false;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  };
  const visible = (el) => Boolean(el && el.getClientRects().length > 0);
`

/** 用例主动跳过（例如当前构建尚未配置 Worker 端点） */
class SkipError extends Error {}

const steps = []
function step(name, fn, options = {}) {
  steps.push({ name, fn, requiresWorker: options.requiresWorker === true })
}

/** Worker 地址：默认本地 wrangler dev，可用 WORKER_URL 覆盖 */
const WORKER_URL = (process.env.WORKER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')

async function probeWorker() {
  try {
    const response = await fetch(`${WORKER_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

// ------------------------------------------------- 流式输出用的替身（stub）

/**
 * 安装一个假的 /api/chat 流式响应，用来确定性地验证前端流式渲染。
 * 同时会记录 AbortSignal 是否被触发，用于验证「停止生成」是否真的中断了请求。
 */
async function installStreamStub(ctx, parts, delayMs, firstDelayMs = 350) {
  await ctx.eval(`
    window.__origFetch = window.__origFetch || window.fetch;
    window.__streamAborted = false;
    window.__streamChunks = 0;
    window.__lastChatRequest = null;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/api/chat')) return window.__origFetch(input, init);
      try {
        window.__lastChatRequest = JSON.parse(init && init.body ? init.body : 'null');
      } catch {
        window.__lastChatRequest = null;
      }
      const encoder = new TextEncoder();
      const parts = ${JSON.stringify(parts)};
      const delay = ${delayMs};
      const firstDelay = ${firstDelayMs};
      const stream = new ReadableStream({
        async start(controller) {
          if (init && init.signal) {
            init.signal.addEventListener('abort', () => {
              window.__streamAborted = true;
            });
          }
          controller.enqueue(encoder.encode(': keep-alive\\n\\n'));
          // 先停一会儿再发第一个增量，用来观察「AI 正在思考」状态
          await new Promise((resolve) => setTimeout(resolve, firstDelay));
          for (const part of parts) {
            if (window.__streamAborted) break;
            const payload = JSON.stringify({ choices: [{ delta: { content: part } }] });
            controller.enqueue(encoder.encode('data: ' + payload + '\\n\\n'));
            window.__streamChunks += 1;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          try {
            controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
          } catch {}
          try {
            controller.close();
          } catch {}
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
    return true;
  `)
}

async function removeStreamStub(ctx) {
  await ctx.eval(`
    if (window.__origFetch) {
      window.fetch = window.__origFetch;
      delete window.__origFetch;
    }
    return true;
  `)
}

/**
 * 安装一个「流到一半断开」的替身：先发几个增量，再让流报错。
 * 用于验证断连时能否保留已生成内容并给出友好提示。
 */
async function installBrokenStreamStub(ctx, parts, delayMs) {
  await ctx.eval(`
    window.__origFetch = window.__origFetch || window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/api/chat')) return window.__origFetch(input, init);
      const encoder = new TextEncoder();
      const parts = ${JSON.stringify(parts)};
      const stream = new ReadableStream({
        async start(controller) {
          for (const part of parts) {
            const payload = JSON.stringify({ choices: [{ delta: { content: part } }] });
            controller.enqueue(encoder.encode('data: ' + payload + '\\n\\n'));
            await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
          }
          // 模拟网络中断：没有 [DONE]，直接让流报错
          controller.error(new TypeError('network error'));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
    return true;
  `)
}

/** 读取当前最后一条 AI 回答的纯文本 */
const LAST_ANSWER_EXPR = `
  const bodies = $$('.md-body');
  return bodies.length ? bodies[bodies.length - 1].innerText : '';
`

/**
 * 确保已配置 API Key。
 * 由于前面的用例会「清除 API 配置」，后续需要发请求的用例必须先补回来，
 * 否则 useChat 会在本地直接短路、根本不会发起 fetch。
 */
async function ensureApiKey(ctx) {
  if (!(await ctx.eval(`return document.body.innerText.includes('未配置');`))) return

  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return setValue('#api-key', 'sk-error-case-key');`)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(400)
}

/**
 * 统计可见的会话行数量。
 * 注意：移动端抽屉关闭状态仍保留在 DOM 中（只是 md:hidden），
 * 因此必须过滤掉不可见元素，否则会把同一个会话数两遍。
 */
const CONVERSATION_COUNT_EXPR = `
  return $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length;
`

/** 侧边栏纯文本（标题断言要限定在侧边栏内，消息正文里也可能出现同样的字样） */
const SIDEBAR_TEXT_EXPR = `
  const sidebar = document.querySelector('[data-testid="sidebar-desktop"]');
  return sidebar ? sidebar.textContent : '';
`

/** 找到指定标题的可见会话行上的 ⋯ 按钮并点击 */
function openConversationMenuExpr(target) {
  return `
    const more = $$('button[aria-label="更多操作"]')
      .filter((el) => visible(el))
      .find((btn) => {
        const row = btn.closest('div');
        return row && (row.textContent || '').includes('${target}');
      });
    if (!more) return false;
    more.click();
    return true;
  `
}

const STREAM_PARTS = ['分类', '与整理', '是二年级', '数学的', '重要内容', '。']
const STREAM_TEXT = STREAM_PARTS.join('')

/** 一段覆盖各种 Markdown 元素的回答，流式分块下发 */
const RICH_MARKDOWN_PARTS = [
  '## 教学目标\n\n',
  '- **知识与技能**：能按给定标准分类\n',
  '- 过程与方法：动手操作、交流\n\n',
  '| 项目 | 内容 |\n| --- | --- |\n| 教学重点 | 单一标准分类 |\n\n',
  '> 注意：标准不同，结果可能不同。\n\n',
  '行内公式 $x^2$，块级公式：\n\n$$\nx^2 + y^2 = 1\n$$\n\n',
  '```text\n任务单：把图形分一分\n```\n\n',
  '### 小结\n\n',
  '分类要先确定标准。\n',
]
const RICH_MARKDOWN_TEXT = '分类要先确定标准。'

// ---------------------------------------------------------------- 测试场景

step('首屏渲染：应用外壳 + 首次使用引导（空库）', async (ctx) => {
  const info = await ctx.eval(`
    return {
      title: document.title,
      rootChildren: $('#root')?.children.length ?? 0,
      text: document.body.innerText,
    };
  `)
  ctx.assert(info.rootChildren > 0, '#root 未渲染')
  ctx.assert(info.title.includes('AI 教育智能体'), `标题异常: ${info.title}`)
  ctx.assert(info.text.includes('教师模式'), '缺少「教师模式」')
  ctx.assert(info.text.includes('学生模式'), '缺少「学生模式」')
  ctx.assert(info.text.includes('deepseek-chat'), '顶部未显示模型名')
  ctx.assert(info.text.includes('未配置'), 'API 未配置状态未显示')
  // 全新浏览器环境（IndexedDB 为空）应显示欢迎引导，而不是空白
  ctx.assert(info.text.includes('欢迎使用'), '未配置 Key 且无历史时未显示欢迎引导')
  ctx.assert(info.text.includes('今天想准备什么课程？'), '未显示教师模式空状态问候语')
  ctx.assert(info.text.includes('还没有对话记录'), '空历史时未显示占位提示')
})

step('新建对话 → 空状态与快捷卡片', async (ctx) => {
  await ctx.eval(`return clickText('新建对话');`)
  await sleep(300)
  const info = await ctx.eval(`
    const titles = ['生成教学设计', '分析教学重难点', '生成课堂练习', '设计课堂活动'];
    return {
      greeting: document.body.innerText.includes('今天想准备什么课程？'),
      cards: titles.filter((title) => document.body.innerText.includes(title)).length,
      guide: document.body.innerText.includes('欢迎使用'),
    };
  `)
  ctx.assert(info.greeting, '教师模式问候语缺失')
  ctx.assert(info.cards >= 4, `快捷卡片数量异常: ${info.cards}`)
  ctx.assert(info.guide, '首次使用引导未显示（未配置 API Key 时应显示）')
})

step('点击快捷卡片 → 内容填入输入框', async (ctx) => {
  await ctx.eval(`return clickText('生成教学设计');`)
  await sleep(200)
  const value = await ctx.eval(`return $('textarea')?.value ?? '';`)
  ctx.assert(value.includes('教学设计'), `输入框未填入内容: ${value.slice(0, 40)}`)
})

step('配置 API Key（供后续流式用例使用）', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return setValue('#api-key', 'sk-ui-check-session-key');`)
  await sleep(150)
  // 不勾选「记住此设备」，保持 session 存储
  await ctx.eval(`
    const box = $('input[type="checkbox"]');
    if (box && box.checked) box.click();
    return true;
  `)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('待验证');`),
    '配置 Key 后顶部状态未更新',
  )
})

step('探测转发端点是否已配置', async (ctx) => {
  // 生产构建在阶段 14 前 VITE_API_ENDPOINT 仍是占位符，
  // 此时 app 会在本地直接拒绝请求，依赖真实端点的用例应跳过而不是失败。
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return setValue('#api-key', 'sk-endpoint-probe');`)
  await sleep(150)
  await ctx.eval(`return clickText('测试连接');`)
  await ctx.waitFor(
    `return /连接成功|API Key 不正确|尚未配置模型转发地址|网络连接失败|余额不足/.test(document.body.innerText);`,
    25000,
  )

  const missing = await ctx.eval(
    `return document.body.innerText.includes('尚未配置模型转发地址');`,
  )
  ctx.endpointConfigured = !missing
  if (!missing) {
    // 端点已配置 → 这次探测会真的发一次请求并得到 4xx
    ctx.tolerateNetworkError()
  }

  await ctx.eval(`return clickExact('取消');`)
  await sleep(200)
})

step('发送消息 → 流式增量渲染 + Markdown/公式渲染 + 自动标题', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('当前构建的 VITE_API_ENDPOINT 仍是占位符，无法发起聊天请求（阶段 14 部署后生效）')
  }
  // 前置条件：上一步的生成必须已经结束，否则 send() 会被安全守卫拦下
  await ctx.waitFor(`return !byText('停止生成');`, 15000)

  await installStreamStub(ctx, RICH_MARKDOWN_PARTS, 160)
  try {
    await ctx.eval(`return setValue('textarea', '什么是分类与整理');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await sleep(200)

    ctx.assert(
      await ctx.eval(`return document.body.innerText.includes('AI 正在思考');`),
      '未显示「AI 正在思考」',
    )
    ctx.assert(
      await ctx.eval(
        `return $$('.bg-brand').some((el) => (el.textContent||'').includes('什么是分类与整理'));`,
      ),
      '用户消息气泡未出现',
    )

    // 前后采样两次：内容必须是在增长，而不是一次性出现
    await sleep(400)
    const first = await ctx.eval(LAST_ANSWER_EXPR)
    await sleep(500)
    const second = await ctx.eval(LAST_ANSWER_EXPR)
    ctx.assert(first.length > 0, '首个增量没有渲染出来')
    ctx.assert(
      second.length > first.length,
      `回答没有随流式增长（${first.length} → ${second.length}），可能是一次性渲染`,
    )

    await ctx.waitFor(`return document.body.innerText.includes('${RICH_MARKDOWN_TEXT}');`, 15000)
    // 最后一句话出现时可能还没处理完 [DONE]，等状态真正回到空闲
    await ctx.waitFor(
      `return !byText('停止生成') && Boolean(byText('重新生成'));`,
      8000,
    )
    ctx.assert(
      await ctx.eval(`return !document.body.innerText.includes('AI 正在思考');`),
      '流结束后仍在显示「正在思考」',
    )
    ctx.assert(
      await ctx.eval(`return Boolean(byText('复制')) && Boolean(byText('重新生成'));`),
      '回答完成后未出现「复制」与「重新生成」',
    )

    // Markdown 各元素渲染
    const markdown = await ctx.eval(`
      return {
        h2: $$('.md-body h2').length,
        h3: $$('.md-body h3').length,
        table: $$('.md-body table').length,
        code: $$('.md-body pre code').length,
        copyButton: Boolean(byText('复制')),
        katexInline: $$('.md-body .katex').length,
        katexDisplay: $$('.md-body .katex-display').length,
        blockquote: $$('.md-body blockquote').length,
        list: $$('.md-body ul, .md-body ol').length,
        strong: $$('.md-body strong').length,
      };
    `)
    ctx.assert(markdown.h2 >= 1 && markdown.h3 >= 1, `标题渲染异常: ${JSON.stringify(markdown)}`)
    ctx.assert(markdown.table >= 1, '表格未渲染')
    ctx.assert(markdown.code >= 1, '代码块未渲染')
    ctx.assert(markdown.copyButton, '代码块复制按钮缺失')
    ctx.assert(markdown.katexInline >= 1, '行内数学公式未渲染')
    ctx.assert(markdown.katexDisplay >= 1, '块级数学公式未渲染')
    ctx.assert(markdown.blockquote >= 1, '引用未渲染')
    ctx.assert(markdown.list >= 1, '列表未渲染')
    ctx.assert(markdown.strong >= 1, '粗体未渲染')

    const title = await ctx.eval(`
      return $$('button').map((el) => el.textContent || '').find((t) => t.includes('什么是分类与整理')) ?? '';
    `)
    ctx.assert(title.length > 0, '首条消息未自动生成会话标题')
  } finally {
    await ctx.waitFor(`return !byText('停止生成');`, 15000).catch(() => {})
    await removeStreamStub(ctx)
  }
})

step('停止生成 → 中断请求并保留已生成内容', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，跳过停止生成用例')
  }
  await ctx.waitFor(`return !byText('停止生成');`, 15000)

  await installStreamStub(ctx, STREAM_PARTS, 240)
  try {
    await ctx.eval(`return setValue('textarea', '第二个问题');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await sleep(700)

    ctx.assert(
      await ctx.eval(`return Boolean(byText('停止生成'));`),
      '生成中未显示「停止生成」',
    )
    ctx.assert(
      await ctx.eval(
        `return $$('.bg-brand').some((el) => (el.textContent||'').includes('第二个问题'));`,
      ),
      '第二条用户消息未出现',
    )

    const before = await ctx.eval(LAST_ANSWER_EXPR)
    ctx.assert(before.length > 0, '停止前没有已生成的内容可供保留')

    await ctx.eval(`return clickText('停止生成');`)
    await sleep(500)

    ctx.assert(await ctx.eval(`return !byText('停止生成');`), '点击停止后仍显示「停止生成」')

    const after = await ctx.eval(LAST_ANSWER_EXPR)
    ctx.assert(after.length > 0, '停止后已生成的内容被清空')
    ctx.assert(after.length >= before.length, '停止后内容反而变少了')

    ctx.assert(
      await ctx.eval(`return window.__streamAborted === true;`),
      '停止生成没有传导到请求（AbortSignal 未触发）',
    )

    await sleep(800)
    const later = await ctx.eval(LAST_ANSWER_EXPR)
    ctx.assert(later === after, '停止之后内容仍在增长，说明没有真正中断')
  } finally {
    await removeStreamStub(ctx)
  }
})

step('重新生成：不重复添加用户消息', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，跳过重新生成用例')
  }
  await ctx.waitFor(`return !byText('停止生成');`, 15000)

  await installStreamStub(ctx, STREAM_PARTS, 120)
  try {
    const before = await ctx.eval(
      `return $$('.bg-brand').filter((el) => (el.textContent||'').includes('第二个问题')).length;`,
    )
    ctx.assert(before === 1, `重新生成前用户消息数量异常: ${before}`)

    await ctx.eval(`return clickText('重新生成');`)
    await ctx.waitFor(`return document.body.innerText.includes('${STREAM_TEXT}');`, 10000)
    await ctx.waitFor(`return !byText('停止生成');`, 8000)

    const after = await ctx.eval(
      `return $$('.bg-brand').filter((el) => (el.textContent||'').includes('第二个问题')).length;`,
    )
    ctx.assert(after === 1, `重新生成后用户消息被重复添加: ${before} → ${after}`)
    ctx.assert(
      await ctx.eval(`return !byText('停止生成');`),
      '重新生成结束后仍显示「停止生成」',
    )
  } finally {
    await ctx.waitFor(`return !byText('停止生成');`, 15000).catch(() => {})
    await removeStreamStub(ctx)
  }
})

step('System Prompt：按模式正确注入且不写入历史', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，跳过 System Prompt 用例')
  }
  await ctx.waitFor(`return !byText('停止生成');`, 15000)

  await installStreamStub(ctx, ['好'], 60, 60)
  try {
    // ---- 教师模式 ----
    await ctx.eval(`return setValue('textarea', '教师模式校验');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await ctx.waitFor(`return window.__lastChatRequest !== null;`, 10000)
    await ctx.waitFor(`return !byText('停止生成');`, 8000)

    const teacher = await ctx.eval(`
      const body = window.__lastChatRequest || {};
      const messages = body.messages || [];
      const systems = messages.filter((m) => m.role === 'system');
      const last = messages[messages.length - 1] || {};
      return {
        systemCount: systems.length,
        firstIsSystem: messages[0] ? messages[0].role === 'system' : false,
        content: systems[0] ? systems[0].content : '',
        lastRole: last.role,
        lastContent: last.content,
        stream: body.stream,
        model: body.model,
        temperature: body.temperature,
        currentOccurrences: messages.filter(
          (m) => m.role === 'user' && m.content === '教师模式校验',
        ).length,
        userCount: messages.filter((m) => m.role === 'user').length,
      };
    `)

    ctx.assert(teacher.systemCount === 1, `system 消息应有且仅有 1 条，实际 ${teacher.systemCount}`)
    ctx.assert(teacher.firstIsSystem, 'system 消息应位于最前')
    ctx.assert(
      teacher.content.includes('教育教学智能体'),
      '教师模式 System Prompt 未正确注入（缺少角色描述）',
    )
    ctx.assert(
      teacher.content.includes('教学重点与难点分析') && teacher.content.includes('作业设计'),
      '教师模式 Prompt 缺少任务清单',
    )
    ctx.assert(
      teacher.content.includes('$$'),
      'System Prompt 未包含公式格式约定',
    )
    ctx.assert(
      teacher.lastRole === 'user' && teacher.lastContent === '教师模式校验',
      `最后一条应为本次用户消息，实际 ${teacher.lastRole} / ${teacher.lastContent}`,
    )
    ctx.assert(
      teacher.currentOccurrences === 1,
      `当前用户消息被重复添加：出现 ${teacher.currentOccurrences} 次`,
    )
    ctx.assert(teacher.userCount >= 1, '请求中没有任何用户消息')
    ctx.assert(teacher.stream === true, '未以流式方式请求')
    ctx.assert(teacher.model === 'deepseek-chat', `模型参数异常: ${teacher.model}`)
    ctx.assert(typeof teacher.temperature === 'number', 'temperature 未传递')

    // 再发一条：system 消息不得在历史中累积（历史上只存 user / assistant）
    await ctx.eval(`return setValue('textarea', '教师模式校验二');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await ctx.waitFor(
      `return !byText('停止生成') && Boolean(window.__lastChatRequest) && window.__lastChatRequest.messages.some((m) => m.content === '教师模式校验二');`,
      10000,
    )
    const second = await ctx.eval(`
      const messages = (window.__lastChatRequest || {}).messages || [];
      return {
        total: messages.length,
        systemCount: messages.filter((m) => m.role === 'system').length,
        systemsAfterFirst: messages.slice(1).filter((m) => m.role === 'system').length,
      };
    `)
    ctx.assert(
      second.systemCount === 1 && second.systemsAfterFirst === 0,
      `system 消息在历史中累积了: ${JSON.stringify(second)}`,
    )

    // ---- 切换到学生模式 ----
    await ctx.eval(`return clickText('学生模式');`)
    await sleep(400)
    await ctx.eval(`
      const btn = byExact('新建学生模式对话');
      if (btn) btn.click();
      return true;
    `)
    await sleep(450)
    ctx.assert(
      await ctx.eval(`return $('h1')?.textContent === '学生模式';`),
      '未能切换到学生模式',
    )

    await ctx.eval(`return setValue('textarea', '学生模式校验');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await ctx.waitFor(`return !byText('停止生成') && window.__lastChatRequest !== null;`, 10000)

    const student = await ctx.eval(`
      const body = window.__lastChatRequest || {};
      const messages = body.messages || [];
      const systems = messages.filter((m) => m.role === 'system');
      return {
        systemCount: systems.length,
        content: systems[0] ? systems[0].content : '',
        lastContent: messages.length ? messages[messages.length - 1].content : '',
        currentOccurrences: messages.filter(
          (m) => m.role === 'user' && m.content === '学生模式校验',
        ).length,
        userCount: messages.filter((m) => m.role === 'user').length,
      };
    `)

    ctx.assert(student.systemCount === 1, `学生模式 system 消息数量异常: ${student.systemCount}`)
    ctx.assert(
      student.content.includes('学习辅导智能体'),
      '学生模式 System Prompt 未正确注入（缺少角色描述）',
    )
    ctx.assert(
      student.content.includes('不是机械地给学生答案') &&
        student.content.includes('优先解释「为什么」') &&
        student.content.includes('避免使用羞辱性、否定性语言'),
      '学生模式 Prompt 缺少关键要求',
    )
    ctx.assert(
      !student.content.includes('教育教学智能体'),
      '学生模式不应携带教师模式的 Prompt',
    )
    ctx.assert(
      student.lastContent === '学生模式校验' && student.currentOccurrences === 1,
      `学生模式请求的最后一条消息或用户消息次数不正确（${student.lastContent} / ${student.currentOccurrences} 次）`,
    )
  } finally {
    await removeStreamStub(ctx)
  }
})

step('API 设置弹窗：字段与隐私提示', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  const info = await ctx.eval(`
    return {
      hasKeyInput: Boolean($('#api-key')),
      hasBaseUrl: $('[id="api-base-url"]')?.value ?? '',
      hasModel: $('[id="api-model"]')?.value ?? '',
      privacy: document.body.innerText.includes('不会将 API Key 保存到云端数据库'),
      remember: document.body.innerText.includes('在此设备记住 API Key'),
      provider: $('[id="api-provider"]')?.value ?? '',
    };
  `)
  ctx.assert(info.hasKeyInput, 'API Key 输入框缺失')
  ctx.assert(info.hasBaseUrl === 'https://api.deepseek.com', `Base URL 默认值异常: ${info.hasBaseUrl}`)
  ctx.assert(info.hasModel === 'deepseek-chat', `Model 默认值异常: ${info.hasModel}`)
  ctx.assert(info.provider === 'deepseek', `Provider 默认值异常: ${info.provider}`)
  ctx.assert(info.privacy, '隐私提示文案缺失')
  ctx.assert(info.remember, '「在此设备记住 API Key」缺失')

  // 输入 Key 并保存，验证顶部状态与首屏引导变化
  await ctx.eval(`return setValue('#api-key', 'sk-test-not-a-real-key');`)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(400)
  const after = await ctx.eval(`
    return {
      modalClosed: !$('#api-key'),
      status: document.body.innerText.includes('待验证'),
      guide: document.body.innerText.includes('欢迎使用'),
    };
  `)
  ctx.assert(after.modalClosed, '保存后弹窗未关闭')
  ctx.assert(after.status, '配置 Key 后顶部状态未更新')
})

step('历史记录持久化：刷新后会话与消息仍在', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，无法通过界面产生会话内容（需先部署或本地启动 Worker）')
  }
  const before = await ctx.eval(`
    return {
      conversations: $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length,
      titleA: document.body.innerText.includes('什么是分类与整理'),
    };
  `)
  ctx.assert(before.conversations >= 2, `刷新前会话数量异常: ${before.conversations}`)
  ctx.assert(before.titleA, '刷新前侧边栏缺少会话标题')

  await ctx.reload()

  const afterReload = await ctx.eval(`
    return {
      conversations: $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length,
      mode: $('h1')?.textContent ?? '',
    };
  `)
  ctx.assert(
    afterReload.conversations === before.conversations,
    `刷新后会话数量变了: ${before.conversations} → ${afterReload.conversations}`,
  )
  ctx.assert(
    afterReload.mode === '学生模式',
    `刷新后未回到上次活跃的会话（当前模式 ${afterReload.mode}）`,
  )

  // 切到富文本会话，验证消息内容完整保留
  const clicked = await ctx.eval(`
    const btn = $$('button').find((el) => (el.textContent || '').includes('什么是分类与整理'));
    if (btn) btn.click();
    return Boolean(btn);
  `)
  ctx.assert(clicked, '刷新后侧边栏找不到之前的会话')
  await sleep(450)

  const rich = await ctx.eval(`
    return {
      mode: $('h1')?.textContent ?? '',
      answer: document.body.innerText.includes('${RICH_MARKDOWN_TEXT}'),
      userMessage: document.body.innerText.includes('什么是分类与整理'),
      table: $$('.md-body table').length,
      code: $$('.md-body pre code').length,
    };
  `)
  // 公式分块是懒加载的：等它到位再断言，避免把「正在下载」误判成「丢失」
  await ctx.waitFor(`return $$('.md-body .katex-display').length >= 1;`, 15000)
  const katexDisplay = await ctx.eval(`return $$('.md-body .katex-display').length;`)

  ctx.assert(rich.answer, '刷新后回答内容丢失（IndexedDB 未生效）')
  ctx.assert(rich.userMessage, '刷新后用户消息丢失')
  ctx.assert(rich.table >= 1, '刷新后 Markdown 表格丢失')
  ctx.assert(katexDisplay >= 1, '刷新后块级公式丢失')
  ctx.assert(rich.code >= 1, '刷新后代码块丢失')
  ctx.assert(rich.mode === '教师模式', '切回教师会话后模式未同步')
})

step(
  '测试连接：失败路径给出友好提示且不泄露 Key',
  async (ctx) => {
    const probeKey = 'sk-browser-leak-check-000000'
    // 这次请求会被上游拒绝，浏览器必然记录一条 401 网络日志，属于预期
    ctx.tolerateNetworkError()
    await ctx.eval(`return clickText('设置');`)
    await sleep(300)
    await ctx.eval(`return setValue('#api-key', '${probeKey}');`)
    await sleep(200)
    await ctx.eval(`return clickText('测试连接');`)
    await ctx.waitFor(
      `return document.body.innerText.includes('连接成功') || document.body.innerText.includes('API Key 不正确') || document.body.innerText.includes('尚未配置模型转发地址');`,
      25000,
    )

    // 生产构建在 `.env.production` 仍为占位符时会走到这里，属于预期状态
    if (await ctx.eval(`return document.body.innerText.includes('尚未配置模型转发地址');`)) {
      ctx.endpointConfigured = false
      ctx.skip('当前构建的 VITE_API_ENDPOINT 仍是占位符，无法联调 Worker（阶段 14 完成部署后生效）')
    }
    ctx.endpointConfigured = true

    const info = await ctx.eval(`
      // 输入框自身的 value 就是用户刚输入的 Key，不算泄露；
      // 这里把它临时摘掉，只检查页面其它位置有没有出现完整 Key。
      const input = $('#api-key');
      const attr = input ? input.getAttribute('value') : null;
      if (input) input.removeAttribute('value');
      const html = document.body.innerHTML;
      if (input && attr !== null) input.setAttribute('value', attr);
      return {
        failed: document.body.innerText.includes('API Key 不正确'),
        details: document.body.innerText.includes('查看技术详情'),
        hint: document.body.innerText.includes('常见原因'),
        leaked: html.includes('${probeKey}'),
        inputAttrHasKey: Boolean(attr && attr.includes('${probeKey}')),
      };
    `)
    ctx.assert(info.failed, '假 Key 应提示「API Key 不正确」')
    ctx.assert(info.details, '失败时应提供「查看技术详情」')
    ctx.assert(info.hint, '失败时应给出常见原因提示')
    ctx.assert(!info.leaked, '页面非输入框位置出现了完整 API Key（泄露）')

    await ctx.eval(`return clickExact('取消');`)
    await sleep(250)
  },
  { requiresWorker: true },
)

step(
  '测试连接：成功分支界面渲染（stub 上游响应）',
  async (ctx) => {
    if (ctx.endpointConfigured === false) {
      ctx.skip('端点未配置，跳过成功分支界面验证')
    }

    // 用桩替身返回一条 OpenAI 兼容的成功响应，只验证成功分支的界面渲染
    await ctx.eval(`
      window.__origFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/chat')) {
          return new Response(JSON.stringify({
            id: 'stub',
            object: 'chat.completion',
            model: 'deepseek-chat',
            choices: [{ index: 0, message: { role: 'assistant', content: '你好！我是你的教学助手。' }, finish_reason: 'stop' }],
            usage: { total_tokens: 11 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return window.__origFetch(input, init);
      };
      return true;
    `)

    await ctx.eval(`return clickText('设置');`)
    await sleep(300)
    await ctx.eval(`return setValue('#api-key', 'sk-stub-success-key');`)
    await sleep(200)
    await ctx.eval(`return clickText('测试连接');`)
    await sleep(800)

    const info = await ctx.eval(`
      return {
        success: document.body.innerText.includes('连接成功'),
        preview: document.body.innerText.includes('模型回复：'),
        summary: document.body.innerText.includes('查看技术详情'),
      };
    `)

    // 展开「查看技术详情」后应能看到 HTTP 状态等信息（闭合的 details 内容不在 innerText 中）
    const expanded = await ctx.eval(`
      const summary = $$('summary').find((el) => el.textContent.includes('查看技术详情'));
      if (!summary) return false;
      summary.click();
      return true;
    `)

    await ctx.eval(`window.fetch = window.__origFetch; delete window.__origFetch; return true;`)

    ctx.assert(info.success, '成功时未显示「连接成功」')
    ctx.assert(info.preview, '成功时未展示模型回复预览')
    ctx.assert(info.summary, '成功时未提供「查看技术详情」')
    ctx.assert(expanded, '未能展开「查看技术详情」')
    ctx.assert(
      await ctx.eval(`return document.body.innerText.includes('HTTP 200');`),
      '技术详情中未显示 HTTP 状态',
    )

    await ctx.eval(`return clickExact('取消');`)
    await sleep(250)
  },
)

step('API Key 默认只存 sessionStorage', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  // 确保「记住此设备」未勾选
  await ctx.eval(`
    const box = $('input[type="checkbox"]');
    if (box && box.checked) box.click();
    return true;
  `)
  await ctx.eval(`return setValue('#api-key', 'sk-session-only-test-key');`)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(350)

  // 重新打开设置：界面应如实告知 Key 只存在本次会话
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return $('[id="api-key"]')?.value === 'sk-session-only-test-key';`),
    '重新打开设置后未回显已保存的 Key',
  )
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('仅保存在本次会话中');`),
    '未勾选记住时未提示「仅保存在本次会话中」',
  )

  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('待验证');`),
    '同一会话内刷新后 Key 丢失',
  )

  // 模拟关闭浏览器：清空 sessionStorage 后重新打开
  await ctx.eval(`sessionStorage.clear(); return true;`)
  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('未配置');`),
    '未勾选「记住此设备」时 Key 不应被持久保存',
  )

  // 新会话（空会话）应显示首次使用引导
  await ctx.eval(`return clickText('新建对话');`)
  await sleep(350)
  const guide = await ctx.eval(`
    return {
      welcome: document.body.innerText.includes('欢迎使用'),
      button: Boolean(byExact('配置 DeepSeek API')),
      privacy: document.body.innerText.includes('不会保存到本应用的云端数据库'),
    };
  `)
  ctx.assert(guide.welcome, '未配置 Key 时新会话未显示欢迎引导')
  ctx.assert(guide.button, '欢迎引导中缺少「配置 DeepSeek API」按钮')
  ctx.assert(guide.privacy, '欢迎引导中缺少隐私说明')

  // 点击引导按钮应直接打开 API 设置
  await ctx.eval(`return clickExact('配置 DeepSeek API');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return Boolean($('#api-key'));`),
    '点击「配置 DeepSeek API」未打开设置弹窗',
  )
  await ctx.eval(`return clickExact('取消');`)
  await sleep(250)
})

step('勾选「记住此设备」后写入 localStorage', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return setValue('#api-key', 'sk-remembered-test-key');`)
  await sleep(150)
  await ctx.eval(`
    const box = $('input[type="checkbox"]');
    if (box && !box.checked) box.click();
    return true;
  `)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(350)

  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('已保存在此设备上');`),
    '勾选记住后未提示「已保存在此设备上」',
  )

  await ctx.reload()
  // 模拟新会话：清空 sessionStorage 后 Key 仍应保留
  await ctx.eval(`sessionStorage.clear(); return true;`)
  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('待验证');`),
    '勾选「记住此设备」后 Key 未能跨会话保留',
  )
  ctx.assert(
    await ctx.eval(`return !document.body.innerText.includes('欢迎使用');`),
    '已记住 Key 时不应再显示首次使用引导',
  )
})

step('非敏感设置（Base URL / Model）持久化', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return setValue('#api-base-url', 'https://api.example.com/v1');`)
  await ctx.eval(`return setValue('#api-model', 'deepseek-reasoner');`)
  await sleep(150)
  await ctx.eval(`return clickText('保存');`)
  await sleep(350)

  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('deepseek-reasoner');`),
    '刷新后顶部未显示保存的模型名',
  )

  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  ctx.assert(
    (await ctx.eval(`return $('[id="api-base-url"]')?.value ?? '';`)) ===
      'https://api.example.com/v1',
    '刷新后 Base URL 未保留',
  )
  ctx.assert(
    (await ctx.eval(`return $('[id="api-model"]')?.value ?? '';`)) === 'deepseek-reasoner',
    '刷新后 Model 未保留',
  )
})

step('清除 API 配置：Key 与设置一并清除', async (ctx) => {
  await ctx.eval(`return clickText('设置');`)
  await sleep(300)
  await ctx.eval(`return clickText('清除 API 配置');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('确定清除 API 配置吗');`),
    '未出现清除确认弹窗',
  )
  ctx.assert(
    await ctx.eval(`return clickExact('清除');`),
    '确认弹窗中找不到「清除」按钮',
  )
  await sleep(400)

  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('未配置');`),
    '清除后顶部仍显示已配置',
  )
  ctx.assert(
    await ctx.eval(`return $('[id="api-key"]')?.value === '';`),
    '清除后设置弹窗仍显示旧 Key',
  )
  ctx.assert(
    (await ctx.eval(`return $('[id="api-model"]')?.value ?? '';`)) === 'deepseek-chat',
    '清除后 Model 未恢复默认值',
  )

  await ctx.eval(`return clickExact('取消');`)
  await sleep(250)
  await ctx.eval(`sessionStorage.clear(); return true;`)
  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('未配置');`),
    '清除后 Key 仍被持久保存（localStorage 未清干净）',
  )
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('deepseek-chat');`),
    '清除配置后未恢复默认模型',
  )

  // 空会话应重新显示首次使用引导
  await ctx.eval(`return clickText('新建对话');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('欢迎使用');`),
    '清除配置后新会话未重新显示欢迎引导',
  )
})

step('模式偏好持久化 + 切换模式建新对话', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，缺少可用于测试模式切换的会话内容')
  }
  // 先选中一个有内容的会话，切换模式应弹确认
  const selected = await ctx.eval(`
    const btn = $$('button').find((el) =>
      (el.textContent || '').includes('什么是分类与整理'));
    if (btn) btn.click();
    return Boolean(btn);
  `)
  ctx.assert(selected, '找不到用于测试的会话')
  await sleep(450)

  await ctx.eval(`return clickText('学生模式');`)
  await sleep(450)
  const confirmInfo = await ctx.eval(`
    return {
      shown: document.body.innerText.includes('切换模式将创建一个新对话'),
      button: Boolean(byExact('新建学生模式对话')),
    };
  `)
  ctx.assert(
    confirmInfo.shown && confirmInfo.button,
    '当前对话已有内容时切换模式应提示「切换模式将创建一个新对话」',
  )

  await ctx.eval(`return clickExact('新建学生模式对话');`)
  await sleep(500)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '学生模式';`),
    '确认后未切换到学生模式',
  )
  ctx.assert(
    await ctx.eval(`return $$('.md-body').length === 0;`),
    '新建的学生模式会话不应带有上一条会话的内容',
  )

  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '学生模式';`),
    '刷新后未保留上次使用的模式',
  )
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('今天想学习什么？');`),
    '刷新后未打开与学生模式匹配的会话',
  )

  // 还原为教师模式
  await ctx.eval(`return clickText('教师模式');`)
  await sleep(450)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '教师模式';`),
    '未能切回教师模式',
  )
})

step('桌面布局验收：侧边栏 / 正文宽度 / 固定区 / 无横向溢出', async (ctx) => {
  // 先选中一个带消息的会话（若端点未配置则可能没有，此时只验证外壳布局）
  await ctx.eval(`
    const btn = $$('button').find((el) =>
      (el.textContent || '').includes('什么是分类与整理'));
    if (btn) btn.click();
    return Boolean(btn);
  `)
  await sleep(400)

  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
  ]) {
    await ctx.setViewport(width, height, false)
    await sleep(350)

    const metrics = await ctx.eval(`
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const scroll = document.querySelector('[data-testid="message-scroll"]');
      return {
        sidebar: rect('[data-testid="sidebar-desktop"]'),
        header: rect('[data-testid="header"]'),
        scroll: rect('[data-testid="message-scroll"]'),
        content: rect('[data-testid="message-content"]'),
        composer: rect('[data-testid="composer"]'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scrollable: scroll ? scroll.scrollHeight > scroll.clientHeight : false,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        sidebarHeight: rect('[data-testid="sidebar-desktop"]')?.h ?? 0,
      };
    `)

    const label = `${width}x${height}`
    ctx.assert(metrics.sidebar, `${label}: 未找到桌面侧边栏`)
    ctx.assert(
      metrics.sidebar.w >= 240 && metrics.sidebar.w <= 280,
      `${label}: 侧边栏宽度应在 240~280px，实际 ${metrics.sidebar.w}px`,
    )
    ctx.assert(
      metrics.sidebarHeight === height,
      `${label}: 侧边栏未撑满视口高度（${metrics.sidebarHeight} vs ${height}）`,
    )
    ctx.assert(
      metrics.header.y === 0 && metrics.header.h <= 64,
      `${label}: 顶部栏未固定在顶部（y=${metrics.header.y}, h=${metrics.header.h}）`,
    )
    ctx.assert(
      Math.abs(metrics.composer.y + metrics.composer.h - height) <= 2,
      `${label}: 输入区未固定在底部`,
    )
    ctx.assert(metrics.overflowX <= 1, `${label}: 出现横向溢出 ${metrics.overflowX}px`)

    // 以下断言需要渲染消息列表；端点未配置时可能只有空状态，此时跳过这几项
    if (!metrics.scroll) continue
    ctx.assert(
      metrics.content.w >= 700 && metrics.content.w <= 900,
      `${label}: 正文宽度应在 700~900px，实际 ${metrics.content.w}px`,
    )
    ctx.assert(
      Math.abs(metrics.scroll.y - metrics.header.h) <= 2,
      `${label}: 消息区未紧接顶部栏（scroll.y=${metrics.scroll.y}, header.h=${metrics.header.h}）`,
    )
    ctx.assert(
      Math.abs(metrics.scroll.h - (height - metrics.header.h - metrics.composer.h)) <= 2,
      `${label}: 消息区高度未填满顶部栏与输入区之间`,
    )
    ctx.assert(metrics.scrollable, `${label}: 消息区不可独立滚动`)
  }

  await ctx.setViewport(1440, 900, false)
  await sleep(300)
})

step('移动端适配：多机型 + 触屏可用性', async (ctx) => {
  try {
    await runMobileChecks(ctx)
  } finally {
    // 无论成功失败都要还原视口与媒体特性，
    // 否则后续用例会在「手机视口 + 抽屉打开」的状态下运行，
    // 导致桌面侧边栏不可见、会话数量统计为 0，产生连锁误报。
    await ctx.setMediaFeatures([])
    await ctx.setViewport(1440, 900, false)
    await sleep(400)
    await ctx.eval(`
      const overlay = $$('div').find((el) => el.className.includes('bg-ink/30'));
      if (overlay) overlay.click();
      return true;
    `)
    await sleep(300)
  }
})

async function runMobileChecks(ctx) {
  // 手机（<768px 侧边栏应折叠）与平板（>=768px 侧边栏应常驻）
  const devices = [
    { name: '360×640 小屏手机', width: 360, height: 640, phone: true },
    { name: '390×844 iPhone 14', width: 390, height: 844, phone: true },
    { name: '414×896 大屏手机', width: 414, height: 896, phone: true },
    { name: '768×1024 平板', width: 768, height: 1024, phone: false },
  ]

  for (const device of devices) {
    await ctx.setViewport(device.width, device.height, device.phone)
    await sleep(400)

    const metrics = await ctx.eval(`
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        sidebar: rect('[data-testid="sidebar-desktop"]'),
        composer: rect('[data-testid="composer"]'),
        header: rect('[data-testid="header"]'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        bodyOverflow: getComputedStyle(document.body).overflow,
        rootHeight: Math.round(document.getElementById('root').getBoundingClientRect().height),
      };
    `)

    const label = device.name
    ctx.assert(metrics.overflowX <= 1, `${label}: 出现横向溢出 ${metrics.overflowX}px`)
    ctx.assert(
      metrics.composer && metrics.composer.y + metrics.composer.h <= metrics.viewport.h + 1,
      `${label}: 输入区超出视口底部（可能被软键盘遮挡）`,
    )
    ctx.assert(
      metrics.header && metrics.header.y >= 0 && metrics.header.h >= 55,
      `${label}: 顶部栏尺寸异常 ${JSON.stringify(metrics.header)}`,
    )
    ctx.assert(metrics.bodyOverflow === 'hidden', `${label}: 页面整页滚动未被禁止`)
    ctx.assert(
      Math.abs(metrics.rootHeight - metrics.viewport.h) <= 2,
      `${label}: 应用外壳高度与视口不一致（${metrics.rootHeight} vs ${metrics.viewport.h}）`,
    )

    if (device.phone) {
      ctx.assert(
        !metrics.sidebar || metrics.sidebar.w === 0,
        `${label}: 手机端侧边栏应折叠`,
      )
    } else {
      ctx.assert(
        metrics.sidebar && metrics.sidebar.w >= 240,
        `${label}: 平板端侧边栏应常驻（实际宽 ${metrics.sidebar?.w}）`,
      )
    }
  }

  // 回到手机尺寸，验证抽屉与点击目标尺寸
  await ctx.setViewport(390, 844, true)
  await sleep(400)

  // 先模拟触屏环境，再检查点击目标尺寸（触屏下按钮会被放大）
  await ctx.setMediaFeatures([
    { name: 'hover', value: 'none' },
    { name: 'pointer', value: 'coarse' },
  ])
  await sleep(350)

  await ctx.eval(`return $('button[aria-label="打开菜单"]').click();`)
  await sleep(400)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('新建对话');`),
    '抽屉打开后侧边栏内容不可见',
  )

  const drawerTargets = await ctx.eval(`
    const drawer = $$('div').find((el) => el.className.includes('drawer-safe'));
    if (!drawer) return null;
    const buttons = [...drawer.querySelectorAll('button')].filter((el) => el.getClientRects().length > 0);
    const tooSmall = buttons
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 12),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((item) => item.h < 36 || item.w < 36);
    return { count: buttons.length, tooSmall };
  `)
  ctx.assert(drawerTargets && drawerTargets.count > 0, '抽屉内没有可点击元素')
  ctx.assert(
    drawerTargets.tooSmall.length === 0,
    `抽屉内有过小的点击目标: ${JSON.stringify(drawerTargets.tooSmall)}`,
  )

  // 触屏下「⋯」按钮必须常显（否则手机上根本点不到）
  const touchMore = await ctx.eval(`
    const more = $$('button[aria-label="更多操作"]').filter((el) => visible(el))[0];
    if (!more) return null;
    const style = getComputedStyle(more);
    const rect = more.getBoundingClientRect();
    return { opacity: Number(style.opacity), w: Math.round(rect.width), h: Math.round(rect.height) };
  `)
  ctx.assert(touchMore, '触屏环境下找不到会话的 ⋯ 按钮')
  ctx.assert(
    touchMore.opacity === 1,
    `触屏设备上「⋯」按钮不可见（opacity=${touchMore.opacity}），手机上无法重命名或删除会话`,
  )
  ctx.assert(
    touchMore.h >= 36 && touchMore.w >= 36,
    `触屏设备上「⋯」按钮过小: ${touchMore.w}×${touchMore.h}`,
  )
}

step('删除对话：⋯ 菜单 → 确认弹窗 → 取消 / 删除后刷新不复活', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，缺少用于删除的会话（需先部署或本地启动 Worker）')
  }
  const target = '什么是分类与整理'
  const opened = await ctx.eval(openConversationMenuExpr(target))
  ctx.assert(opened, '未能打开会话的 ⋯ 菜单')
  await sleep(250)
  ctx.assert(await ctx.eval(`return Boolean(byText('重命名'));`), '菜单中缺少「重命名」')
  ctx.assert(await ctx.eval(`return Boolean(byText('删除'));`), '菜单中缺少「删除」')

  await ctx.eval(`return clickText('删除');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('确定删除此对话吗');`),
    '未出现删除确认弹窗',
  )
  await ctx.eval(`return clickText('取消');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return !document.body.innerText.includes('确定删除此对话吗');`),
    '取消后确认弹窗未关闭',
  )
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('${target}');`),
    '取消删除后会话不应消失',
  )

  // 真正删除，并确认刷新后不会「复活」
  const beforeCount = await ctx.eval(CONVERSATION_COUNT_EXPR)
  const dbBefore = await ctx.eval(DB_DUMP_EXPR)
  await ctx.eval(openConversationMenuExpr(target))
  await sleep(250)
  // 第一次点击命中菜单里的「删除」→ 打开确认弹窗；第二次才命中弹窗里的「删除」
  await ctx.eval(`return clickExact('删除');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('确定删除此对话吗');`),
    '未出现删除确认弹窗',
  )
  await ctx.eval(`return clickExact('删除');`)
  await sleep(500)

  ctx.assert(
    await ctx.eval(`return !document.body.innerText.includes('${target}');`),
    '删除后会话仍然出现在侧边栏',
  )

  await ctx.reload()
  const afterReload = await ctx.eval(`
    const rows = $$('button[aria-label="更多操作"]')
      .filter((el) => visible(el))
      .map((btn) => {
        const row = btn.closest('div');
        return row ? (row.textContent || '').replace(/\\s+/g, ' ').slice(0, 24) : '';
      });
    return {
      count: $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length,
      exists: document.body.innerText.includes('${target}'),
      rows,
      pageText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    };
  `)
  ctx.assert(!afterReload.exists, '删除后刷新，会话又出现了（IndexedDB 未真正删除）')
  ctx.assert(
    afterReload.count === beforeCount - 1,
    `删除后会话数量不正确: 界面 ${beforeCount} → 刷新后 ${afterReload.count}
      IndexedDB(删除前): ${dbBefore.count} 条 [${dbBefore.rows.join(' | ')}]
      刷新后剩余: [${afterReload.rows.join(' | ')}]
      刷新后页面文本: ${afterReload.pageText}`,
  )
})

step('重命名对话：空标题被拒绝、改名后刷新仍在', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，缺少用于重命名的会话（需先部署或本地启动 Worker）')
  }
  const original = '学生模式校验'
  const renamed = '学生会话（改名验证）'

  const opened = await ctx.eval(openConversationMenuExpr(original))
  ctx.assert(opened, '未能打开会话的 ⋯ 菜单')
  await sleep(250)
  await ctx.eval(`return clickText('重命名');`)
  await sleep(300)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('重命名对话');`),
    '未出现重命名弹窗',
  )

  // 标题为空白时「保存」应不可用
  await ctx.eval(`
    const input = $$('input[type="text"]').find((el) => el.maxLength === 40);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '   ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `)
  await sleep(250)
  ctx.assert(
    await ctx.eval(`const btn = byExact('保存'); return Boolean(btn) && btn.disabled === true;`),
    '标题为空白时「保存」应不可用',
  )

  const setTitle = (value) => `
    const input = $$('input[type="text"]').find((el) => el.maxLength === 40);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `

  await ctx.eval(setTitle(renamed))
  await sleep(200)
  await ctx.eval(`return clickExact('保存');`)
  await sleep(400)

  ctx.assert(
    (await ctx.eval(SIDEBAR_TEXT_EXPR)).includes(renamed),
    '重命名后侧边栏未更新',
  )
  ctx.assert(
    !(await ctx.eval(SIDEBAR_TEXT_EXPR)).includes(original),
    '重命名后侧边栏仍显示旧标题',
  )

  await ctx.reload()
  ctx.assert(
    (await ctx.eval(SIDEBAR_TEXT_EXPR)).includes(renamed),
    '刷新后重命名丢失（IndexedDB 未生效）',
  )

  // 改回原名，避免影响后续用例
  await ctx.eval(openConversationMenuExpr(renamed))
  await sleep(250)
  await ctx.eval(`return clickText('重命名');`)
  await sleep(300)
  await ctx.eval(setTitle(original))
  await sleep(200)
  await ctx.eval(`return clickExact('保存');`)
  await sleep(400)
  ctx.assert(
    (await ctx.eval(SIDEBAR_TEXT_EXPR)).includes(original),
    '改回原名称失败',
  )
})

step('删除当前会话 → 自动选中相邻会话', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，无法产生多个会话（需先部署或本地启动 Worker）')
  }
  const countBefore = await ctx.eval(CONVERSATION_COUNT_EXPR)
  ctx.assert(countBefore >= 2, `用例前提不满足：需要至少 2 个会话，实际 ${countBefore}`)

  // 选中第一个可见会话，然后删除它
  const selected = await ctx.eval(`
    const rows = $$('button[aria-label="更多操作"]').filter((el) => visible(el));
    const container = rows[0] ? rows[0].closest('div') : null;
    const button = container ? container.querySelector('button') : null;
    if (button) button.click();
    return Boolean(button);
  `)
  ctx.assert(selected, '未能选中第一个会话')
  await sleep(450)

  await ctx.eval(`
    const more = $$('button[aria-label="更多操作"]').filter((el) => visible(el))[0];
    if (more) more.click();
    return Boolean(more);
  `)
  await sleep(250)
  await ctx.eval(`return clickExact('删除');`)
  await sleep(350)
  await ctx.eval(`return clickExact('删除');`)
  await sleep(550)

  const after = await ctx.eval(`
    const rows = $$('button[aria-label="更多操作"]').filter((el) => visible(el));
    const activeRow = rows.find((btn) => {
      const row = btn.closest('div');
      return row && row.className.includes('bg-surface');
    });
    return { count: rows.length, hasActive: Boolean(activeRow) };
  `)
  ctx.assert(after.count === countBefore - 1, `删除后数量不正确: ${countBefore} → ${after.count}`)
  ctx.assert(after.hasActive, '删除当前会话后没有自动选中相邻会话（被丢进了空状态）')
})

step('流式中途断开 → 保留已生成内容 + 友好提示 + 页面不崩', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，跳过流式中断用例')
  }
  await ctx.waitFor(`return !byText('停止生成');`, 15000)
  await ensureApiKey(ctx)

  await installBrokenStreamStub(ctx, ['已生成的前半段内容', '，仍然是可见的'], 200)
  try {
    await ctx.eval(`return setValue('textarea', '断开测试');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)

    // 等错误提示出现
    await ctx.waitFor(`return document.body.innerText.includes('连接中断');`, 12000)

    const info = await ctx.eval(`
      const bodies = $$('.md-body');
      return {
        partialKept: bodies.length ? bodies[bodies.length - 1].innerText.includes('已生成的前半段内容') : false,
        friendly: document.body.innerText.includes('连接中断'),
        keepsPartialHint: document.body.innerText.includes('已保留已生成的内容'),
        stopped: !byText('停止生成'),
        canRegenerate: Boolean(byText('重新生成')),
        errorStyled: $$('.border-danger\\\\/25').length > 0,
      };
    `)
    ctx.assert(info.partialKept, '中断后已生成的内容没有保留')
    ctx.assert(info.friendly, '中断后没有显示「连接中断」提示')
    ctx.assert(info.keepsPartialHint, '中断提示没有说明已保留内容')
    ctx.assert(info.stopped, '中断后仍显示「停止生成」')
    ctx.assert(info.canRegenerate, '中断后应仍可「重新生成」')
    ctx.assert(info.errorStyled, '错误样式未生效')

    // 页面必须仍然可用：还能新建对话
    await ctx.eval(`return clickText('新建对话');`)
    await sleep(400)
    ctx.assert(
      await ctx.eval(`return document.body.innerText.includes('今天想准备什么课程？');`),
      '流式中断后页面无法继续使用（空状态未渲染）',
    )
  } finally {
    await removeStreamStub(ctx)
  }
})

step('异常内容（非法公式 / 未闭合代码块）不会让页面崩溃', async (ctx) => {
  if (ctx.endpointConfigured === false) {
    ctx.skip('端点未配置，跳过异常内容用例')
  }
  await ctx.waitFor(`return !byText('停止生成');`, 15000)
  await ensureApiKey(ctx)

  await installStreamStub(
    ctx,
    ['非法公式：', '$$\\frac{}{$$', '\n\n未闭合代码块：\n\n', '```js\nconst a = 1\n'],
    120,
    120,
  )
  try {
    await ctx.eval(`return setValue('textarea', '异常内容测试');`)
    await sleep(150)
    await ctx.eval(`return pressEnter('textarea');`)
    await ctx.waitFor(`return !byText('停止生成') && document.body.innerText.includes('未闭合代码块');`, 12000)

    const info = await ctx.eval(`
      return {
        stillRendered: document.body.innerText.includes('非法公式'),
        sidebarAlive: Boolean($('[data-testid="sidebar-desktop"]')),
        composerAlive: Boolean($('textarea')),
        noCrashScreen: !document.body.innerText.includes('页面出现了意外错误'),
      };
    `)
    ctx.assert(info.stillRendered, '异常内容没有渲染出来')
    ctx.assert(info.sidebarAlive && info.composerAlive, '页面结构异常')
    ctx.assert(info.noCrashScreen, '异常内容触发了整页兜底（不应发生）')
  } finally {
    await removeStreamStub(ctx)
  }
})

step('清除本地聊天记录（隐私功能）', async (ctx) => {
  const before = await ctx.eval(CONVERSATION_COUNT_EXPR)
  ctx.assert(before > 0, '清除前没有可清理的会话，用例前提不成立')

  await ctx.eval(`return clickText('设置');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('本地数据');`),
    '设置弹窗缺少「本地数据」区块',
  )

  await ctx.eval(`return clickText('清除本地聊天记录');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('确定清除本地聊天记录吗');`),
    '未出现清除聊天记录的确认弹窗',
  )
  await ctx.eval(`return clickExact('清除');`)
  await sleep(500)

  ctx.assert(
    await ctx.eval(`return $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length === 0;`),
    '清除后侧边栏仍有会话',
  )
  ctx.assert(
    await ctx.eval(
      `return document.body.innerText.includes('还没有对话记录') || document.body.innerText.includes('今天想准备什么课程？');`,
    ),
    '清除后未回到空状态',
  )

  await ctx.eval(`return clickExact('取消');`)
  await sleep(250)

  // 刷新后仍应为空
  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length === 0;`),
    '清除后刷新，聊天记录又出现了（IndexedDB 未真正清空）',
  )
})

step('清除后仍可正常新建对话', async (ctx) => {
  await ctx.eval(`return clickText('新建对话');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return $$('button[aria-label="更多操作"]').filter((el) => visible(el)).length === 1;`),
    '清除后无法新建对话',
  )
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('今天想准备什么课程？');`),
    '新建对话后未显示空状态',
  )
})

// ---------------------------------------------------------------- 运行器

function createContext(ws, sessionId, pageUrl) {
  return {
    async eval(expression) {
      return evaluate(ws, sessionId, DOM_HELPERS + expression)
    },
    async waitFor(expression, timeout = 5000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if (await evaluate(ws, sessionId, DOM_HELPERS + expression)) return true
        await sleep(150)
      }
      throw new Error(`等待超时: ${expression.slice(0, 60)}`)
    },
    /** 重新加载页面，用于验证本地存储是否生效 */
    async reload() {
      await send(ws, 'Page.navigate', { url: pageUrl }, sessionId)
      await sleep(1800)
    },
    async setViewport(width, height, mobile) {
      await send(
        ws,
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile },
        sessionId,
      )
    },
    /** 模拟媒体特性，例如把环境伪装成触屏（hover: none / pointer: coarse） */
    async setMediaFeatures(features) {
      await send(ws, 'Emulation.setEmulatedMedia', { features }, sessionId)
    },
    assert(condition, message) {
      if (!condition) throw new Error(message)
    },
    /** 声明本次用例会故意产生一次 4xx 网络日志 */
    tolerateNetworkError() {
      toleratedNetworkErrors += 1
    },
    /** 跳过当前用例 */
    skip(reason) {
      throw new SkipError(reason)
    },
    /** 端点是否已配置为真实 Worker（生产构建在阶段 14 前仍是占位符） */
    endpointConfigured: undefined,
  }
}

let failures = 0

try {
  const version = await waitForVersion()
  const ws = new WebSocket(version.webSocketDebuggerUrl)

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('无法连接浏览器调试通道')), { once: true })
  })

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(
        (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
      )
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      exceptions.push(details.exception?.description ?? details.text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      logErrors.push(`${message.params.entry.source}: ${message.params.entry.text}`)
    }
  })

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' })
  const attached = await send(ws, 'Target.attachToTarget', { targetId, flatten: true })
  const sessionId = attached.sessionId

  await send(ws, 'Runtime.enable', {}, sessionId)
  await send(ws, 'Log.enable', {}, sessionId)
  await send(ws, 'Page.enable', {}, sessionId)
  await send(ws, 'Page.navigate', { url }, sessionId)
  await sleep(2500)

  const ctx = createContext(ws, sessionId, url)

  const workerAvailable = await probeWorker()

  console.log(`=== UI 自动化检查 ===\nURL: ${url}\nWorker: ${WORKER_URL} ${workerAvailable ? '（可用）' : '（未运行，相关用例将跳过）'}\n`)

  for (const item of steps) {
    if (item.requiresWorker && !workerAvailable) {
      console.log(`SKIP  ${item.name}`)
      continue
    }
    try {
      await item.fn(ctx)
      console.log(`PASS  ${item.name}`)
    } catch (error) {
      if (error instanceof SkipError) {
        console.log(`SKIP  ${item.name}\n      ${error.message}`)
        continue
      }
      failures += 1
      console.log(`FAIL  ${item.name}\n      ${error.message}`)
    }
  }

  console.log('\n--- console.error ---')
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '（无）')
  console.log('--- 未捕获异常 ---')
  console.log(exceptions.length ? exceptions.join('\n') : '（无）')
  console.log('--- 浏览器日志错误 ---')
  console.log(logErrors.length ? logErrors.join('\n') : '（无）')

  const networkErrors = logErrors.filter((item) => item.startsWith('network:'))
  const otherLogErrors = logErrors.filter((item) => !item.startsWith('network:'))
  const unexpectedNetworkErrors = Math.max(0, networkErrors.length - toleratedNetworkErrors)

  if (unexpectedNetworkErrors > 0) {
    console.log(`\n⚠️ 出现 ${unexpectedNetworkErrors} 条预期外的网络错误日志`)
  }

  if (consoleErrors.length || exceptions.length || otherLogErrors.length || unexpectedNetworkErrors) {
    failures += 1
  }

  console.log(`\n结果: ${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
  process.exitCode = failures === 0 ? 0 : 1

  ws.close()
} catch (error) {
  console.error('检查脚本执行失败:', error.message)
  process.exitCode = 1
} finally {
  browser.kill()
  await sleep(400)
  try {
    rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // Windows 下目录可能仍被占用，忽略
  }
}
