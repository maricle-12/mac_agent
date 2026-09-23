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

/** 在页面中执行表达式并取回值 */
async function evaluate(ws, sessionId, expression) {
  const result = await send(
    ws,
    'Runtime.evaluate',
    { expression: `(() => { ${expression} })()`, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '页面执行出错')
  }
  return result.result.value
}

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

const steps = []
function step(name, fn) {
  steps.push({ name, fn })
}

// ---------------------------------------------------------------- 测试场景

step('首屏渲染：标题、模式、会话列表', async (ctx) => {
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
  ctx.assert(info.text.includes('二年级数学分类与整理'), '缺少历史会话')
  ctx.assert(info.text.includes('deepseek-chat'), '顶部未显示模型名')
  ctx.assert(info.text.includes('未配置'), 'API 未配置状态未显示')
})

step('Markdown 渲染：标题 / 表格 / 代码块 / 数学公式', async (ctx) => {
  const info = await ctx.eval(`
    return {
      h2: $$('.md-body h2').length,
      table: $$('.md-body table').length,
      code: $$('.md-body pre code').length,
      copyButton: Boolean(byText('复制')),
      katexInline: $$('.md-body .katex').length,
      katexDisplay: $$('.md-body .katex-display').length,
      blockquote: $$('.md-body blockquote').length,
      list: $$('.md-body ul, .md-body ol').length,
    };
  `)
  ctx.assert(info.h2 >= 3, `标题渲染异常: h2=${info.h2}`)
  ctx.assert(info.table >= 1, '表格未渲染')
  ctx.assert(info.code >= 1, '代码块未渲染')
  ctx.assert(info.copyButton, '代码块复制按钮缺失')
  ctx.assert(info.katexInline >= 1, '行内数学公式未渲染')
  ctx.assert(info.katexDisplay >= 1, '块级数学公式未渲染')
  ctx.assert(info.blockquote >= 1, '引用未渲染')
  ctx.assert(info.list >= 1, '列表未渲染')
})

step('切换会话时同步模式（学生模式 + 块级公式）', async (ctx) => {
  await ctx.eval(`
    const btn = $$('button').find((el) => (el.textContent || '').includes('这道题为什么错'));
    if (!btn) return false;
    btn.click();
    return true;
  `)
  await sleep(400)

  const info = await ctx.eval(`
    return {
      header: $('h1')?.textContent ?? '',
      display: $$('.md-body .katex-display').length,
      modeBadge: document.body.innerText.includes('学生模式'),
    };
  `)
  ctx.assert(info.header === '学生模式', `顶部模式未同步为「学生模式」: ${info.header}`)
  ctx.assert(info.modeBadge, '侧边栏未高亮学生模式')
  ctx.assert(info.display >= 2, `学生回答中的块级公式未渲染: ${info.display}`)

  await ctx.eval(`
    const btn = $$('button').find((el) => (el.textContent || '').includes('二年级数学分类与整理'));
    if (!btn) return false;
    btn.click();
    return true;
  `)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '教师模式';`),
    '切回教师会话后模式未同步',
  )
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

step('发送消息 → 用户气泡 + AI 模拟回答', async (ctx) => {
  await ctx.eval(`return setValue('textarea', '帮我设计一节二年级数学课');`)
  await sleep(150)
  await ctx.eval(`return pressEnter('textarea');`)
  await sleep(250)

  const thinking = await ctx.eval(`return document.body.innerText.includes('AI 正在思考');`)
  ctx.assert(thinking, '未显示「AI 正在思考」')

  const userBubble = await ctx.eval(`
    return $$('.bg-brand').some((el) => (el.textContent||'').includes('帮我设计一节二年级数学课'));
  `)
  ctx.assert(userBubble, '用户消息气泡未出现')

  await ctx.waitFor(`return document.body.innerText.includes('阶段 2 的模拟回答');`, 8000)
  const title = await ctx.eval(`
    return $$('button').map((el) => el.textContent || '').find((t) => t.includes('二年级数学课')) ?? '';
  `)
  ctx.assert(title.length > 0, '首条消息未自动生成会话标题')
})

step('重新生成：不重复添加用户消息', async (ctx) => {
  const before = await ctx.eval(`
    return $$('.bg-brand').filter((el) => (el.textContent||'').includes('帮我设计')).length;
  `)
  await ctx.eval(`return clickText('重新生成');`)
  await sleep(1200)
  const after = await ctx.eval(`
    return {
      userCount: $$('.bg-brand').filter((el) => (el.textContent||'').includes('帮我设计')).length,
      hasAnswer: document.body.innerText.includes('阶段 2 的模拟回答'),
    };
  `)
  ctx.assert(before === 1, `重新生成前用户消息数异常: ${before}`)
  ctx.assert(after.userCount === 1, `重新生成后用户消息被重复添加: ${after.userCount}`)
  ctx.assert(after.hasAnswer, '重新生成后没有回答')
})

step('停止生成按钮可用', async (ctx) => {
  await ctx.eval(`return setValue('textarea', '第二个问题');`)
  await sleep(120)
  await ctx.eval(`return pressEnter('textarea');`)
  await sleep(200)
  const stopVisible = await ctx.eval(`return Boolean(byText('停止生成'));`)
  ctx.assert(stopVisible, '生成中未显示「停止生成」')
  await ctx.eval(`return clickText('停止生成');`)
  await sleep(600)
  const stopped = await ctx.eval(`return !byText('停止生成');`)
  ctx.assert(stopped, '点击停止后仍在生成状态')
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
  ctx.assert(!after.guide, '配置 Key 后仍显示首次使用引导')
})

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

step('模式偏好持久化到 localStorage', async (ctx) => {
  // 先选中一个有内容的会话，切换模式应弹确认
  await ctx.eval(`
    const btn = $$('button').find((el) =>
      (el.textContent || '').includes('二年级数学分类与整理'));
    if (btn) btn.click();
    return Boolean(btn);
  `)
  await sleep(400)

  await ctx.eval(`return clickText('学生模式');`)
  await sleep(400)
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
  await sleep(450)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '学生模式';`),
    '确认后未切换到学生模式',
  )

  await ctx.reload()
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '学生模式';`),
    '刷新后未保留上次使用的模式',
  )
  // 刷新后应自动打开该模式下的会话（学生会话含 3 个块级公式，教师会话只有 1 个）
  ctx.assert(
    (await ctx.eval(`return $$('.md-body .katex-display').length;`)) >= 2,
    '刷新后未打开与学生模式匹配的会话',
  )

  // 还原为教师模式
  await ctx.eval(`return clickText('教师模式');`)
  await sleep(400)
  await ctx.eval(`
    const btn = byExact('新建教师模式对话');
    if (btn) btn.click();
    return true;
  `)
  await sleep(400)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '教师模式';`),
    '未能切回教师模式',
  )

  // 空会话下切换模式不应弹确认，直接就地切换
  await ctx.eval(`return clickText('新建对话');`)
  await sleep(350)
  await ctx.eval(`return clickText('学生模式');`)
  await sleep(350)
  const emptySwitch = await ctx.eval(`
    return {
      mode: $('h1')?.textContent ?? '',
      noConfirm: !document.body.innerText.includes('切换模式将创建一个新对话'),
    };
  `)
  ctx.assert(emptySwitch.mode === '学生模式', '空会话下切换模式失败')
  ctx.assert(emptySwitch.noConfirm, '空会话下切换模式不应弹出确认')

  await ctx.eval(`return clickText('教师模式');`)
  await sleep(350)
  ctx.assert(
    await ctx.eval(`return $('h1')?.textContent === '教师模式';`),
    '未能切回教师模式',
  )
})

step('删除对话：⋯ 菜单 → 确认弹窗 → 取消', async (ctx) => {
  const opened = await ctx.eval(`
    const more = $$('button[aria-label="更多操作"]').find((btn) => {
      const row = btn.closest('div');
      return row && (row.textContent || '').includes('一元一次方程练习');
    });
    if (!more) return false;
    more.click();
    return true;
  `)
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
  await sleep(250)
  ctx.assert(
    await ctx.eval(`return !document.body.innerText.includes('确定删除此对话吗');`),
    '取消后确认弹窗未关闭',
  )
})

step('桌面布局验收：侧边栏 / 正文宽度 / 固定区 / 无横向溢出', async (ctx) => {
  // 先选中一个带消息的会话，确保渲染的是消息列表而不是空状态
  await ctx.eval(`
    const btn = $$('button').find((el) =>
      (el.textContent || '').includes('二年级数学分类与整理'));
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
      metrics.content.w >= 700 && metrics.content.w <= 900,
      `${label}: 正文宽度应在 700~900px，实际 ${metrics.content.w}px`,
    )
    ctx.assert(
      metrics.header.y === 0 && metrics.header.h <= 64,
      `${label}: 顶部栏未固定在顶部（y=${metrics.header.y}, h=${metrics.header.h}）`,
    )
    ctx.assert(
      Math.abs(metrics.composer.y + metrics.composer.h - height) <= 2,
      `${label}: 输入区未固定在底部`,
    )
    ctx.assert(
      metrics.scroll && Math.abs(metrics.scroll.y - metrics.header.h) <= 2,
      `${label}: 消息区未紧接顶部栏（scroll.y=${metrics.scroll?.y}, header.h=${metrics.header.h}）`,
    )
    ctx.assert(
      Math.abs(metrics.scroll.h - (height - metrics.header.h - metrics.composer.h)) <= 2,
      `${label}: 消息区高度未填满顶部栏与输入区之间`,
    )
    ctx.assert(metrics.scrollable, `${label}: 消息区不可独立滚动`)
    ctx.assert(metrics.overflowX <= 1, `${label}: 出现横向溢出 ${metrics.overflowX}px`)
  }

  await ctx.setViewport(1440, 900, false)
  await sleep(300)
})

step('移动端：侧边栏折叠与抽屉', async (ctx) => {
  await ctx.setViewport(390, 844, true)
  await sleep(500)

  const collapsed = await ctx.eval(`
    const sidebar = $$('div').find((el) => el.className.includes('md:flex') && el.className.includes('w-64'));
    return {
      hidden: sidebar ? getComputedStyle(sidebar).display === 'none' : null,
      menuButton: Boolean($('button[aria-label="打开菜单"]')),
      bodyOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  `)
  ctx.assert(collapsed.hidden === true, '移动端侧边栏未折叠')
  ctx.assert(collapsed.menuButton, '移动端缺少菜单按钮')
  ctx.assert(collapsed.bodyOverflow, '移动端出现横向溢出')

  await ctx.eval(`return $('button[aria-label="打开菜单"]').click();`)
  await sleep(400)
  ctx.assert(
    await ctx.eval(`return document.body.innerText.includes('新建对话');`),
    '抽屉打开后侧边栏内容不可见',
  )

  await ctx.setViewport(1440, 900, false)
  await sleep(300)
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
    assert(condition, message) {
      if (!condition) throw new Error(message)
    },
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

  console.log(`=== UI 自动化检查 ===\nURL: ${url}\n`)

  for (const item of steps) {
    try {
      await item.fn(ctx)
      console.log(`PASS  ${item.name}`)
    } catch (error) {
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

  if (consoleErrors.length || exceptions.length || logErrors.length) failures += 1

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
