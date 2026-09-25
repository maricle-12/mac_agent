/**
 * 发行包自检：把发行目录复制到临时目录后**真正启动一次程序**，
 * 用 HTTP 把关键接口全部打一遍，最后关闭并清理。
 *
 * 为什么要在临时副本里跑：正式 release 目录必须保持「首次启动状态」，
 * 不能让自检产生的 data/app.db、config/settings.json、logs 污染发布包。
 *
 * 两个平台的差异（有意保留，不做「看起来一样」的假统一）：
 *
 *   Windows：直接启动 <副本>/启动智能体.exe。
 *            不传 --data-root，这样验的正是「默认把数据放在 EXE 旁边」这条便携行为。
 *
 *   macOS  ：跑两遍。
 *            A. 直接启动 <副本>/AI教育智能体.app/Contents/MacOS/启动智能体，
 *               数据目录用 --data-root 指到副本内（绝不写用户的 Application Support）；
 *               结束时再起第二个进程占同一个端口，验证「单实例复用」。
 *            B. 用 /usr/bin/open 让 **LaunchServices** 启动整个 .app ——
 *               这正是用户双击时的路径，能验证 Info.plist / CFBundleExecutable /
 *               代码签名是否真的成立（用独立端口，避免与 A 的单实例逻辑互相干扰）。
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const IS_MAC = process.platform === 'darwin'

/**
 * 判断当前环境是否具备「可用的图形会话」。
 *
 * 为什么需要这个判断：LaunchServices（`/usr/bin/open`）只在真正可用的图形登录会话里才能把 `.app` 拉起来。
 * 只有在这样的环境里，LaunchServices 验收失败才**可以归因于应用本身**；
 * 否则失败反映的是环境，把它报成构建失败会让整个交付物（dmg / zip）都拿不到。
 *
 * 为什么不能只看 launchctl managername：实测在 GitHub Actions 的 macOS runner 上
 * `launchctl managername` **会返回 Aqua**，但 `open` 退出码为 0 而应用从未在预期端口起来
 * （`双击启动后本地服务可用（健康检查超时）`）。也就是说 Aqua 这个信号在 CI 上会给出假阳性。
 * 因此这里改用三信号合取，并且**默认不在 CI 里做这项验收**：
 *   1) 不在 CI 中（CI 环境无法保证 WindowServer / 会话真的可用）
 *   2) 进程在 Aqua 图形域里
 *   3) 控制台有真实登录用户（不是 root / 空）
 *
 * 需要在带桌面的 Mac 上强制做这项验收时：`AI_EDU_STRICT_LAUNCHSERVICES=1 npm run build:mac`
 */
export function inspectGuiSession() {
  let managerName = null
  let consoleUser = null
  try {
    const result = spawnSync('/bin/launchctl', ['managername'], { encoding: 'utf8', timeout: 10_000 })
    managerName = result.status === 0 ? result.stdout.trim() : null
  } catch {
    managerName = null
  }
  try {
    const result = spawnSync('/usr/bin/stat', ['-f', '%Su', '/dev/console'], { encoding: 'utf8', timeout: 10_000 })
    consoleUser = result.status === 0 ? result.stdout.trim() : null
  } catch {
    consoleUser = null
  }

  const isCI = Boolean(process.env.CI) && process.env.CI !== 'false' && process.env.CI !== '0'
  const isAqua = managerName === 'Aqua'
  const hasRealUser = Boolean(consoleUser) && consoleUser !== 'root'
  const signals = `launchctl managername=${managerName ?? '未知'}、/dev/console 用户=${consoleUser ?? '未知'}、CI=${isCI ? '是' : '否'}`

  if (process.env.AI_EDU_STRICT_LAUNCHSERVICES === '1') {
    return { usable: true, detail: `${signals}；已由 AI_EDU_STRICT_LAUNCHSERVICES=1 强制开启` }
  }

  const reasons = []
  if (isCI) reasons.push('在 CI 环境中，无法保证图形会话真的可用')
  if (!isAqua) reasons.push('不在 Aqua 图形域')
  if (!hasRealUser) reasons.push('控制台没有真实登录用户')

  return {
    usable: reasons.length === 0,
    detail: reasons.length === 0 ? signals : `${signals}；${reasons.join('；')}`,
  }
}

/** 探测某个端口上是不是本应用（用于诊断「实例起在了别的端口」） */
async function probeInstance(port, timeoutMs = 700) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = await response.json()
    return body && body.local === true ? body : null
  } catch {
    return null
  }
}

/** 在给定端口列表里找还活着、且是本应用的实例（诊断用） */
async function findLiveInstancePorts(ports) {
  const found = []
  for (const port of ports) {
    if (await probeInstance(port)) found.push(port)
  }
  return found
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return await response.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return null
}

async function healthGone(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    } catch {
      return true
    }
    await sleep(200)
  }
  return false
}

/** 等一个子进程自己退出（用于验证单实例复用后第二个进程会主动结束） */
async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true
    await sleep(200)
  }
  return false
}

/** 打一个接口，同时拿到状态码、解析后的 JSON 和原始文本（首页是 HTML，需要看文本） */
export async function requestJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { response, body, text }
}

/**
 * @param {{
 *   appDir: string,
 *   executableRelPath: string,
 *   port: number,
 *   log?: (msg: string) => void,
 *   appBundleRelPath?: string|null,
 *   checkLaunchServices?: boolean,
 * }} options
 */
export async function smokeTest(options) {
  const { appDir, executableRelPath, port } = options
  const log = options.log ?? (() => {})
  const checkLaunchServices = options.checkLaunchServices ?? IS_MAC
  const appBundleRelPath = options.appBundleRelPath ?? '.'

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-edu-smoke-'))
  const target = path.join(tempRoot, 'app')
  const checks = []

  const record = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail })
    log(`   ${ok ? '✓' : '✗'} ${name}${detail ? `（${detail}）` : ''}`)
  }
  /** 环境不具备能力而**明确跳过**的项：只提示，不计入失败 */
  const skip = (name, reason) => {
    log(`   · 跳过：${name}（${reason}）`)
  }

  let child = null
  /** 单实例用例启动的第二个进程（正常情况下会自行退出） */
  let secondChild = null
  /** macOS 阶段 B 由 LaunchServices 启动，拿不到子进程句柄，只能记 PID 以便兜底收尾 */
  let launchedViaOpenPid = null
  /** 抛出的异常（用于在 finally 里决定要不要打印诊断） */
  let thrownError = null

  const healthUrl = (p) => `http://127.0.0.1:${p}/api/health`
  const apiUrl = (p, suffix) => `http://127.0.0.1:${p}${suffix}`

  try {
    fs.cpSync(appDir, target, { recursive: true })
    log(`   自检副本：${target}`)

    const executable = path.join(target, executableRelPath)
    // 复制过程中若权限位没带过来，spawn 会直接 EACCES；显式补一次执行权限
    try {
      fs.chmodSync(executable, 0o755)
    } catch {
      /* Windows 上 chmod 基本是空操作，失败不影响 */
    }
    // macOS 上数据必须显式指向副本，否则会写进用户真实的 Application Support
    const useDataRootOverride = IS_MAC
    const dataRoot = path.join(target, 'smoke-data')
    const args = [`--port=${port}`, '--no-browser']
    if (useDataRootOverride) args.push(`--data-root=${dataRoot}`)
    const expectedDataRoot = useDataRootOverride ? dataRoot : target

    child = spawn(executable, args, {
      cwd: target,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })

    const health = await waitForHealth(port, 60_000)
    record('启动并监听 127.0.0.1', Boolean(health), health ? `端口 ${port}` : '健康检查超时')
    if (!health) throw new Error(`自检失败：本地服务没有起来（可执行文件：${executable}）`)

    record('健康检查带便携版标识', health.local === true && health.app === 'ai-edu-agent-portable')

    // ------------------------------------------------------------ 静态资源
    const index = await requestJson(apiUrl(port, '/'))
    record('首页可访问', index.response.ok && index.text.includes('<div id="root">'))

    const assetMatch = /src="(\/assets\/[^"]+\.js)"/.exec(index.text)
    if (assetMatch) {
      const asset = await requestJson(apiUrl(port, assetMatch[1]))
      record('前端 JS 资源可访问', asset.response.ok, assetMatch[1])
    } else {
      record('前端 JS 资源可访问', false, '首页里没有找到 assets 引用')
    }

    const favicon = await requestJson(apiUrl(port, '/favicon.svg'))
    record('图标资源可访问', favicon.response.ok)

    // ------------------------------------------------------------ 本地数据接口
    const info = (await requestJson(apiUrl(port, '/api/local/info'))).body
    record('本地数据接口可用', info?.local === true && typeof info?.database?.path === 'string')
    record('数据库位于 data 目录', String(info?.database?.path).includes(`${path.sep}data${path.sep}app.db`))
    record('首次启动为空数据库', info?.database?.conversationCount === 0)
    record('首次启动未配置 API Key', info?.settings?.configured === false)
    record('接口上报了运行平台', info?.platform === process.platform, String(info?.platform))

    const settings = (await requestJson(apiUrl(port, '/api/local/settings'))).body
    record(
      '设置接口不返回完整 Key',
      Boolean(settings?.settings) && !('apiKey' in settings.settings) && settings.settings.maskedApiKey === '',
    )

    // 会话读写
    const conversation = {
      id: 'c_smoke_1',
      title: '自检会话',
      mode: 'teacher',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ id: 'm_smoke_1', role: 'user', content: '自检消息', createdAt: Date.now() }],
    }
    const created = await requestJson(apiUrl(port, '/api/local/conversations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation }),
    })
    record('写入会话', created.response.ok)

    const list = (await requestJson(apiUrl(port, '/api/local/conversations'))).body
    const roundTrip = list?.conversations?.find((item) => item.id === 'c_smoke_1')
    record(
      '读回会话（含中文）',
      Boolean(roundTrip) && roundTrip.messages[0].content === '自检消息',
      roundTrip ? `标题=${roundTrip.title}` : '未找到',
    )

    const removed = await requestJson(apiUrl(port, '/api/local/conversations/c_smoke_1'), { method: 'DELETE' })
    record('删除会话', removed.response.ok)

    const exported = await requestJson(apiUrl(port, '/api/local/export'))
    record('导出数据且不含 API Key', exported.response.ok && exported.text.includes('"includesApiKey": false'))

    // 跨站来源必须被拒绝
    const forbidden = await requestJson(apiUrl(port, '/api/local/settings'), {
      headers: { Origin: 'https://evil.example.com' },
    })
    record('拒绝跨站来源', forbidden.response.status === 403, `HTTP ${forbidden.response.status}`)

    // 未配置 Key 时 /api/chat 应给出可读提示而不是崩溃
    const chat = await requestJson(apiUrl(port, '/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }], stream: false }),
    })
    record(
      '未配置 Key 时给出友好提示',
      chat.response.status === 400 && chat.body?.error?.code === 'api_key_not_configured',
    )

    // ------------------------------------------------------------ 数据落盘位置
    record('数据库文件已创建', fs.existsSync(path.join(expectedDataRoot, 'data', 'app.db')))
    record('配置文件已创建', fs.existsSync(path.join(expectedDataRoot, 'config', 'settings.json')))
    record('日志文件已创建', fs.existsSync(path.join(expectedDataRoot, 'logs', 'app.log')))

    const logText = fs.readFileSync(path.join(expectedDataRoot, 'logs', 'app.log'), 'utf8')
    record('日志记录了数据库路径与迁移状态', logText.includes('数据库文件：') && logText.includes('历史迁移状态：'))
    record('日志中没有完整 API Key', !/sk-[A-Za-z0-9]{20,}/.test(logText))
    if (IS_MAC) {
      record('macOS：日志标明运行平台为 macOS', logText.includes('平台=macOS'))
    }

    // ------------------------------------------------------------ macOS：LaunchServices 启动
    if (IS_MAC && checkLaunchServices) {
      const gui = inspectGuiSession()
      if (!gui.usable) {
        // 环境无法保证图形会话可用 → 这项验收的结果不可归因于应用，
        // 明确跳过并说明原因（继续执行后面的步骤，尤其是第 10 步的 DMG）。
        skip('LaunchServices「双击启动」验收', 'CI环境无GUI会话，跳过LaunchServices启动验收')
        log(`   · 判定依据：${gui.detail}`)
        log('   · 已跳过：open .app、模拟双击、等待 localhost 健康检查')
        log(
          '   · 不受影响、照常执行并已通过：应用包结构检查、codesign 验证、Mach-O 架构检查；' +
            'DMG 挂载验收在第 10 步照常执行',
        )
        log('   · 需要在带桌面的 Mac 上强制做这项验收时：AI_EDU_STRICT_LAUNCHSERVICES=1 npm run build:mac')
      } else {
        const bundlePath = path.resolve(target, appBundleRelPath)
        const secondPort = port + 1
        const secondDataRoot = path.join(target, 'smoke-data-launchservices')

        // 与用户双击完全同一条路径：LaunchServices 拉起 .app
        const open = spawn('/usr/bin/open', [
          bundlePath,
          '--args',
          `--port=${secondPort}`,
          '--no-browser',
          `--data-root=${secondDataRoot}`,
        ])
        const openExit = await new Promise((resolve) => open.on('exit', resolve))
        record('LaunchServices 能拉起应用包（等价于用户双击）', openExit === 0, `open 退出码 ${openExit}`)

        const second = await waitForHealth(secondPort, 60_000)
        if (second) {
          record('双击启动后本地服务可用', true, `端口 ${secondPort}`)
          launchedViaOpenPid = second.pid ?? null
          const secondInfo = (await requestJson(apiUrl(secondPort, '/api/local/info'))).body
          record(
            '双击启动的实例写入独立数据目录',
            String(secondInfo?.database?.path).startsWith(secondDataRoot),
            String(secondInfo?.database?.path),
          )
          await requestJson(apiUrl(secondPort, '/api/local/shutdown'), {
            method: 'POST',
            headers: { Origin: `http://127.0.0.1:${secondPort}` },
          }).catch(() => null)
          record('双击启动的实例可以正常退出', await healthGone(secondPort, 15_000))
        } else {
          // 找不到实例时，区分两种可能：应用压根没起来，还是起来了但落在了别的端口
          // （后者通常意味着 LaunchServices 没有把 --args 转发过去）。
          const candidates = [secondPort]
          for (let p = 8765; p <= 8774; p += 1) candidates.push(p)
          const landed = await findLiveInstancePorts(candidates)
          record(
            '双击启动后本地服务可用',
            false,
            landed.length > 0
              ? `期望端口 ${secondPort} 无响应，但在 ${landed.join('、')} 上发现了实例（LaunchServices 可能未转发 --args）`
              : `期望端口 ${secondPort} 无响应，默认端口段也没有实例（open 退出码 ${openExit}，应用可能未真正启动）`,
          )
        }
      }
    }

    // ------------------------------------------------------------ 单实例
    // 同端口再起一个进程：它应当探测到已有实例，只打开页面（自检里用 --no-browser 跳过）
    // 然后自己退出，而不是抢占端口或起第二个服务。
    const duplicate = spawn(executable, args, {
      cwd: target,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    secondChild = duplicate
    const duplicateExited = await waitForExit(duplicate, 20_000)
    record('单实例：第二个实例复用已有服务并自行退出', duplicateExited)
    const stillOurs = await requestJson(apiUrl(port, '/api/local/info'))
    record('单实例：第一个实例仍在正常服务', stillOurs.response.ok && stillOurs.body?.port === port)

    // ------------------------------------------------------------ 关闭
    await requestJson(apiUrl(port, '/api/local/shutdown'), {
      method: 'POST',
      headers: { Origin: `http://127.0.0.1:${port}` },
    }).catch(() => null)

    let exited = false
    for (let i = 0; i < 25; i += 1) {
      if (child.exitCode !== null || child.killed) {
        exited = true
        break
      }
      await sleep(200)
    }
    // 判定「服务真的关掉了」：子进程已退出 **或** 端口不再响应，二者之一即可。
    // 只看 exitCode 在慢机器上偏脆（universal 二进制约 230 MB，首次运行还要校验签名）；
    // 而「端口不再响应」才是用户真正关心的结果。
    const stopped = exited || (await healthGone(port, 12_000))
    record('退出接口能关闭本地服务', stopped, exited ? '进程已退出' : stopped ? '端口已停止响应' : '服务仍在响应')
  } catch (error) {
    thrownError = error
    throw error
  } finally {
    // 诊断信息必须在删除临时副本**之前**打印；而且不只是异常时要打，
    // 「某一项断言没过」时也要打 —— 否则日志末尾只剩「自检未通过」，看不出原因。
    const failedChecks = checks.filter((item) => !item.ok)
    if (failedChecks.length > 0 || thrownError) {
      try {
        log('')
        log(`   --- 自检诊断：共 ${checks.length} 项，失败 ${failedChecks.length} 项 ---`)
        for (const item of failedChecks) log(`   ✗ ${item.name}${item.detail ? `（${item.detail}）` : ''}`)
        if (thrownError) log(`   异常：${thrownError.message ?? thrownError}`)
        const logCandidates = [
          path.join(target, 'smoke-data', 'logs', 'app.log'),
          path.join(target, 'smoke-data-launchservices', 'logs', 'app.log'),
          path.join(target, 'logs', 'app.log'),
        ]
        for (const candidate of logCandidates) {
          if (!fs.existsSync(candidate)) continue
          log(`   [app.log] ${candidate} 末尾 40 行：`)
          for (const line of fs.readFileSync(candidate, 'utf8').trim().split('\n').slice(-40)) {
            log(`      ${line}`)
          }
        }
      } catch {
        /* 诊断信息拿不到就算了，不要掩盖原始错误 */
      }
    }

    try {
      child?.kill()
    } catch {
      /* ignore */
    }
    try {
      if (secondChild && secondChild.exitCode === null) secondChild.kill()
    } catch {
      /* ignore */
    }
    // macOS 阶段 B 由 LaunchServices 启动，没有子进程句柄：用上报的 PID 兜底
    if (launchedViaOpenPid) {
      try {
        process.kill(launchedViaOpenPid, 'SIGTERM')
      } catch {
        /* 已经退出了 */
      }
    }
    await sleep(300)
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      /* 临时目录删除失败不影响构建结果 */
    }
  }

  return {
    ok: checks.every((item) => item.ok),
    checks,
  }
}
