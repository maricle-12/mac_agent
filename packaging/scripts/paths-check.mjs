/**
 * 跨平台路径与平台分发自检。
 *
 * 为什么需要它：macOS 的目录规则（应用包定位、Application Support 数据目录）
 * 在 Windows 开发机上**无法通过真实运行来验证**。这里用「纯函数 + 显式平台参数」
 * 的方式把 macOS / Linux 的规则在任意机器上算一遍并断言，
 * 而不是只靠肉眼看代码。等真正在 Mac 上打包时，再跑一次发行包自检（smoke-test）。
 *
 * 断言分三类：
 *   A. 目录规划：Windows / macOS / Linux 的资源根目录、数据根目录是否正确；
 *   B. 平台分发：platform.cjs 是否把打开浏览器 / 对话框分发到了正确的实现；
 *   C. 静态安全：机器相关的脚本里不得出现 Windows 绝对路径、不得用 shell 拼命令行。
 *
 * 运行：node packaging/scripts/paths-check.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { inspectGuiSession } from './smoke-test.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagingDir = path.resolve(__dirname, '..')
const demoRoot = path.resolve(packagingDir, '..')

const require = createRequire(import.meta.url)
const pathsModule = require(path.join(packagingDir, 'src', 'paths.cjs'))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
}

const NEVER_WRITABLE = () => false
const ALWAYS_WRITABLE = () => true

const HOME = '/Users/tester'
const WIN_HOME = 'C:\\Users\\tester'

// ---------------------------------------------------------------- A. 目录规划

// A1. Windows：数据与程序同目录（便携模式）
{
  const plan = pathsModule.planRoots({
    platform: 'win32',
    sea: true,
    execPath: 'C:\\Apps\\AI教育智能体\\启动智能体.exe',
    env: {},
    homeDir: WIN_HOME,
    writable: ALWAYS_WRITABLE,
  })
  check(
    'Windows 便携模式：资源根目录 = EXE 所在目录',
    plan.resourceRoot === 'C:\\Apps\\AI教育智能体',
    plan.resourceRoot,
  )
  check(
    'Windows 便携模式：数据目录与程序同目录',
    plan.dataRoot === 'C:\\Apps\\AI教育智能体',
    plan.dataRoot,
  )
  check(
    'Windows 便携模式：前端资源 = resources\\web',
    plan.packagedWeb === 'C:\\Apps\\AI教育智能体\\resources\\web',
    plan.packagedWeb,
  )
  check('Windows 便携模式：dataModeLabel 为便携模式', plan.dataModeLabel.includes('便携'), plan.dataModeLabel)
}

// A2. Windows：程序目录不可写 → 回退 %LOCALAPPDATA%
{
  const plan = pathsModule.planRoots({
    platform: 'win32',
    sea: true,
    execPath: 'C:\\Program Files\\AI教育智能体\\启动智能体.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
    homeDir: WIN_HOME,
    writable: NEVER_WRITABLE,
  })
  check(
    'Windows 只读目录回退：数据目录 = %LOCALAPPDATA%\\AI教育智能体',
    plan.dataRoot === 'C:\\Users\\tester\\AppData\\Local\\AI教育智能体',
    plan.dataRoot,
  )
  check(
    'Windows 只读目录回退：资源仍从 EXE 旁边读',
    plan.resourceRoot === 'C:\\Program Files\\AI教育智能体',
    plan.resourceRoot,
  )
  check('Windows 只读目录回退：portable = false', plan.portable === false)
  check('Windows 只读目录回退：记录了回退原因', Boolean(plan.fallbackReason))
}

// A3. macOS：应用包内 → 资源在 Contents/Resources/app，数据在 Application Support
{
  const execPath = '/Applications/AI教育智能体.app/Contents/MacOS/启动智能体'
  const plan = pathsModule.planRoots({
    platform: 'darwin',
    sea: true,
    execPath,
    env: {},
    homeDir: HOME,
    writable: ALWAYS_WRITABLE, // 即使包内可写，也必须用 Application Support
  })
  check(
    'macOS 应用包：资源根目录 = Contents/Resources/app',
    plan.resourceRoot === '/Applications/AI教育智能体.app/Contents/Resources/app',
    plan.resourceRoot,
  )
  check(
    'macOS 应用包：前端资源 = Contents/Resources/app/resources/web',
    plan.packagedWeb === '/Applications/AI教育智能体.app/Contents/Resources/app/resources/web',
    plan.packagedWeb,
  )
  check(
    'macOS 应用包：数据目录 = ~/Library/Application Support/AI教育智能体',
    plan.dataRoot === '/Users/tester/Library/Application Support/AI教育智能体',
    plan.dataRoot,
  )
  check(
    'macOS 应用包：即使包内可写也不把数据写进包内',
    !plan.dataRoot.includes('.app'),
    plan.dataRoot,
  )
  check('macOS 应用包：portable = false', plan.portable === false)
  check(
    'macOS 应用包：data/config/logs 三个子目录齐备',
    plan.dataDir.endsWith('/data') && plan.configDir.endsWith('/config') && plan.logDir.endsWith('/logs'),
    `${plan.dataDir} | ${plan.configDir} | ${plan.logDir}`,
  )
  check(
    'macOS 应用包：路径全部为 POSIX 形式（无盘符、无反斜杠）',
    !plan.resourceRoot.includes('\\') && !plan.dataRoot.includes('\\') && !/^[A-Za-z]:/.test(plan.resourceRoot),
  )
}

// A4. macOS：直接运行裸二进制（未装入应用包，例如开发/自测）
{
  const plan = pathsModule.planRoots({
    platform: 'darwin',
    sea: true,
    execPath: '/Users/tester/build/启动智能体',
    env: {},
    homeDir: HOME,
    writable: ALWAYS_WRITABLE,
  })
  check(
    'macOS 裸二进制：资源根目录 = 可执行文件所在目录',
    plan.resourceRoot === '/Users/tester/build',
    plan.resourceRoot,
  )
  check(
    'macOS 裸二进制：数据目录仍为 Application Support',
    plan.dataRoot === '/Users/tester/Library/Application Support/AI教育智能体',
    plan.dataRoot,
  )
}

// A5. Linux：程序目录不可写 → ~/.local/share
{
  const plan = pathsModule.planRoots({
    platform: 'linux',
    sea: true,
    execPath: '/opt/ai-edu-agent/启动智能体',
    env: {},
    homeDir: '/home/tester',
    writable: NEVER_WRITABLE,
  })
  check(
    'Linux 回退：数据目录 = ~/.local/share/AI教育智能体',
    plan.dataRoot === '/home/tester/.local/share/AI教育智能体',
    plan.dataRoot,
  )
}

// A6. 环境变量优先级：AI_EDU_DATA_ROOT 覆盖一切（自动化测试用）
{
  const darwin = pathsModule.planRoots({
    platform: 'darwin',
    sea: true,
    execPath: '/Applications/AI教育智能体.app/Contents/MacOS/启动智能体',
    env: { AI_EDU_DATA_ROOT: '/tmp/smoke-copy' },
    homeDir: HOME,
    writable: NEVER_WRITABLE,
  })
  check(
    'macOS：AI_EDU_DATA_ROOT 可把数据目录指向测试临时副本',
    darwin.dataRoot === '/tmp/smoke-copy',
    darwin.dataRoot,
  )
  check(
    'macOS：AI_EDU_DATA_ROOT 不影响资源目录',
    darwin.resourceRoot === '/Applications/AI教育智能体.app/Contents/Resources/app',
    darwin.resourceRoot,
  )

  const win = pathsModule.planRoots({
    platform: 'win32',
    sea: true,
    execPath: 'H:\\build\\app\\启动智能体.exe',
    env: { AI_EDU_DATA_ROOT: 'H:\\temp\\smoke' },
    homeDir: WIN_HOME,
    writable: ALWAYS_WRITABLE,
  })
  check(
    'Windows：AI_EDU_DATA_ROOT 同样生效（两个平台测试方式一致）',
    win.dataRoot === 'H:\\temp\\smoke',
    win.dataRoot,
  )
}

// A7. AI_EDU_APP_ROOT（开发 / 自测）在两个平台上都强制便携模式
{
  const darwin = pathsModule.planRoots({
    platform: 'darwin',
    sea: true,
    execPath: '/Applications/AI教育智能体.app/Contents/MacOS/启动智能体',
    env: { AI_EDU_APP_ROOT: '/Users/tester/dev/demo/release/AI教育智能体' },
    homeDir: HOME,
    writable: ALWAYS_WRITABLE,
  })
  check(
    'macOS：AI_EDU_APP_ROOT 可把资源与数据都指到指定目录（开发调试）',
    darwin.resourceRoot === '/Users/tester/dev/demo/release/AI教育智能体' &&
      darwin.dataRoot === darwin.resourceRoot,
    `${darwin.resourceRoot} | ${darwin.dataRoot}`,
  )
}

// ---------------------------------------------------------------- B. 平台分发
{
  const platform = require(path.join(packagingDir, 'src', 'platform.cjs'))
  const required = [
    'showDialog',
    'openBrowser',
    'probeHealth',
    'probeHealthWithRetry',
    'readLastPort',
    'writeLastPort',
    'delay',
    'OS_LABEL',
  ]
  const missing = required.filter((name) => !(name in platform))
  check('platform.cjs 暴露启动器需要的全部接口', missing.length === 0, missing.join(', '))
  check('platform.cjs 提供平台显示名', typeof platform.OS_LABEL === 'string' && platform.OS_LABEL.length > 0, platform.OS_LABEL)

  // 当前平台上分发到的实现必须与进程平台一致（本机为 win32 时指向 win.cjs）
  const expectedImpl = process.platform === 'win32' ? 'win.cjs' : process.platform === 'darwin' ? 'mac.cjs' : 'generic.cjs'
  const impl = require(
    path.join(packagingDir, 'src', expectedImpl === 'win.cjs' ? 'win.cjs' : expectedImpl === 'mac.cjs' ? 'mac.cjs' : 'generic.cjs'),
  )
  check(
    `platform.cjs 分发到 ${expectedImpl}（当前平台 ${process.platform}）`,
    platform.openBrowser === impl.openBrowser && platform.showDialog === impl.showDialog,
  )
}

// ---------------------------------------------------------------- C. 静态安全
{
  const macSource = fs.readFileSync(path.join(packagingDir, 'src', 'mac.cjs'), 'utf8')
  check(
    'mac.cjs 用绝对路径调用系统程序（/usr/bin/open、/usr/bin/osascript）',
    macSource.includes("'/usr/bin/open'") && macSource.includes("'/usr/bin/osascript'"),
  )
  check('mac.cjs 不经过 shell 执行命令（无 shell: true / exec()）', !/shell:\s*true/.test(macSource) && !/\bexec\(/.test(macSource))
  check('mac.cjs 不使用 Windows 专属程序', !/powershell|rundll32|cmd\.exe|notepad\.exe|\.exe\b/i.test(macSource.replace(/^\s*\*.*$/gm, '')))

  const winSource = fs.readFileSync(path.join(packagingDir, 'src', 'win.cjs'), 'utf8')
  check('win.cjs 不再包含平台无关的健康检查（已移到 net.cjs）', !winSource.includes('probeHealth'))

  const launcherSource = fs.readFileSync(path.join(packagingDir, 'src', 'launcher.cjs'), 'utf8')
  check('launcher.cjs 不再直接依赖 win.cjs', !launcherSource.includes("require('./win.cjs')"))
  check('launcher.cjs 通过 platform.cjs 访问平台能力', launcherSource.includes("require('./platform.cjs')"))

  // 运行期源码里不允许出现开发机绝对路径
  const runtimeFiles = ['launcher.cjs', 'paths.cjs', 'net.cjs', 'win.cjs', 'mac.cjs', 'generic.cjs', 'platform.cjs', 'local-server.cjs', 'db.cjs', 'settings.cjs', 'logger.cjs']
  const leaked = []
  for (const name of runtimeFiles) {
    const source = fs.readFileSync(path.join(packagingDir, 'src', name), 'utf8')
    if (/H:\\agent|C:\\Users\\[A-Za-z]/.test(source)) leaked.push(name)
  }
  check('运行期源码不含开发机绝对路径', leaked.length === 0, leaked.join(', '))

  check(
    'demoRoot 定位正确（用于构建脚本）',
    fs.existsSync(path.join(demoRoot, 'package.json')) && fs.existsSync(path.join(packagingDir, 'package.json')),
  )
}

// ---------------------------------------------------------------- D. 构建期路径不变量
//
// 这一节的由来：macOS 构建在 CI 上失败于
//     Could not resolve "../build/worker.cjs"  （packaging/src/local-server.cjs:29）
// 根因是 macOS 构建把 Worker 产物写到了 packaging/build-mac/worker.cjs，
// 而 local-server.cjs 里那句相对 require 只认 packaging/build/worker.cjs。
// Windows 构建「刚好」也写 packaging/build/，所以只有 macOS 会挂 ——
// 而且 build-mac.mjs 的平台守卫让它在本机完全跑不到，只能等 CI 才暴露。
// 下面这几条断言把那个不变量固化下来，防止同类问题再次发生。
{
  const localServerSource = fs.readFileSync(path.join(packagingDir, 'src', 'local-server.cjs'), 'utf8')
  const commonSource = fs.readFileSync(path.join(packagingDir, 'scripts', 'lib', 'common.mjs'), 'utf8')

  /** local-server.cjs 里 require 的那个 Worker 产物路径（相对 packaging/src/ 解析） */
  const requiredSpec = /require\(\s*['"](\.\.[^'"]+)['"]\s*\)/.exec(localServerSource)?.[1] ?? null
  check('local-server.cjs 里能找到 Worker 产物的相对 require', Boolean(requiredSpec), String(requiredSpec))

  const requiredAbs = requiredSpec ? path.resolve(packagingDir, 'src', requiredSpec) : null
  const declaredAbs = path.join(packagingDir, 'build', 'worker.cjs')
  check(
    'local-server.cjs 要求的 Worker 产物 = 构建脚本约定的唯一位置（packaging/build/worker.cjs）',
    requiredAbs === declaredAbs,
    `local-server 要求 ${requiredAbs}，构建脚本约定 ${declaredAbs}`,
  )
  check('lib/common.mjs 声明了 Worker 产物唯一位置常量', commonSource.includes('WORKER_BUNDLE_RELPATH'))

  for (const script of ['build-release.mjs', 'build-mac.mjs']) {
    const source = fs.readFileSync(path.join(packagingDir, 'scripts', script), 'utf8')
    check(`${script} 通过共用的 ensureWorkerBundle 生成 Worker 产物`, source.includes('ensureWorkerBundle('))
    check(
      `${script} 不自己调用 bundleWorker（避免再一次把产物写到别的目录）`,
      !/\bbundleWorker\s*\(/.test(source),
    )
  }

  // build-mac.mjs 必须保留「只跑到 SEA blob」的预检模式：
  // 否则 macOS 构建线的前半段在 Windows 开发机上永远跑不到（本次故障就是这样漏掉的）。
  const macBuildSource = fs.readFileSync(path.join(packagingDir, 'scripts', 'build-mac.mjs'), 'utf8')
  check('build-mac.mjs 支持 --preflight（让平台无关的前半段可在任意系统验证）', macBuildSource.includes("'--preflight'"))

  // packaging/src 里所有相对 require 都要能解析：要么是真实文件，要么是「已声明的构建产物」。
  // 后者用显式白名单，而不是「本机碰巧存在」—— 否则这条检查在有残留产物的机器上会假装通过。
  const srcDir = path.join(packagingDir, 'src')
  const declaredGenerated = new Set([declaredAbs])
  const unresolved = []
  for (const name of fs.readdirSync(srcDir).filter((f) => f.endsWith('.cjs'))) {
    const source = fs.readFileSync(path.join(srcDir, name), 'utf8')
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
    let match
    while ((match = re.exec(source)) !== null) {
      const abs = path.resolve(srcDir, match[1])
      if (declaredGenerated.has(abs)) continue
      const candidates = [abs, `${abs}.cjs`, `${abs}.js`, `${abs}.json`, path.join(abs, 'index.js'), path.join(abs, 'index.cjs')]
      if (!candidates.some((candidate) => fs.existsSync(candidate))) unresolved.push(`${name} → ${match[1]}`)
    }
  }
  check('packaging/src 的相对 require 全部可解析（或指向已声明的构建产物）', unresolved.length === 0, unresolved.join('; '))

  // ---- 架构名归一化（同一次 macOS CI 失败的第二类根因）----
  // 故障现象：`x64 二进制架构不符：实际 x86_64`。
  // 根因：拿 Mach-O 头部的架构名（x86_64）直接和 Node 分发包的架构名（x64）比较；
  //       arm64 在两套命名里同名，所以只有 x64 会暴露。
  // 下面把「不许跨命名体系直接比较」固化下来。
  const machoSource = fs.readFileSync(path.join(packagingDir, 'scripts', 'macho.mjs'), 'utf8')
  check('macho.mjs 声明了架构族映射表 ARCH_FAMILIES', machoSource.includes('ARCH_FAMILIES'))
  check('macho.mjs 提供 archFamily / sameArch 归一化函数', machoSource.includes('export function archFamily') && machoSource.includes('export function sameArch'))
  check(
    'macho.mjs 的映射覆盖 x64 的三种写法与 arm64 的别名',
    /x64:\s*\[[^\]]*'x64'[^\]]*'x86_64'[^\]]*'amd64'[^\]]*\]/.test(machoSource) &&
      /arm64:\s*\[[^\]]*'arm64'[^\]]*'aarch64'[^\]]*\]/.test(machoSource),
  )
  check('macho.mjs 的 readMachO 同时返回原始架构名与归一化架构族', machoSource.includes('archFamilies:') && machoSource.includes('archFamily:'))

  check('build-mac.mjs 用 sameArch 做架构断言（跨命名体系安全）', macBuildSource.includes('sameArch('))
  check(
    'build-mac.mjs 不再把 macho.arch 与 x64/arm64 直接比较',
    !/macho\.arch\s*(===|!==)/.test(macBuildSource),
  )
  check(
    'build-mac.mjs 不再用 raw macho.arches.includes 判断架构（x86_64 永远匹配不到 x64）',
    !/\.arches\.includes\(/.test(macBuildSource),
  )
  check('build-mac.mjs 用 archFamilies 判断通用包与静态断言', (macBuildSource.match(/archFamilies/g) || []).length >= 2)

  // ---- universal 自检的可诊断性 ----
  // 目标：「失败时能直接看出是哪一项、以及包里哪个文件不是 universal」，
  // 而不是只留下一句「发行包自检未通过」。
  check('build-mac.mjs 扫描包内所有 Mach-O（不只主可执行文件）', macBuildSource.includes('auditMachOFiles('))
  check(
    'build-mac.mjs 有「全部 Mach-O 都含目标架构」的静态断言',
    /应用包内全部 Mach-O 都含/.test(macBuildSource),
  )
  check(
    'build-mac.mjs 在自检失败时把失败项写进最终错误信息',
    macBuildSource.includes('发行包自检未通过：') && macBuildSource.includes('reportMachOFiles('),
  )
  const smokeSource = fs.readFileSync(path.join(packagingDir, 'scripts', 'smoke-test.mjs'), 'utf8')
  check(
    'smoke-test.mjs 在「断言没过」时也打印诊断与 app.log（不只是抛异常时）',
    smokeSource.includes('自检诊断：') && smokeSource.includes("smoke-data-launchservices"),
  )
  // 用户明确要求的跳过措辞，防止被无意改掉（日志/文档都按这句话检索）
  check(
    'smoke-test.mjs 使用约定的跳过措辞「CI环境无GUI会话，跳过LaunchServices启动验收」',
    smokeSource.includes('CI环境无GUI会话，跳过LaunchServices启动验收'),
  )
  check(
    '跳过时明确说明「哪些仍照常执行」（结构 / codesign / Mach-O / DMG）',
    smokeSource.includes('Mach-O 架构检查') && smokeSource.includes('DMG 挂载验收在第 10 步照常执行'),
  )
  check(
    '跳过时给出「实例起在了别的端口」的诊断（区分未转发 --args 与未启动）',
    smokeSource.includes('LaunchServices 可能未转发 --args'),
  )
}

// ---------------------------------------------------------------- E. CI/图形会话判定
//
// LaunchServices（open）验收只有在「能把失败归因于应用」的环境里才该做。
// GitHub 的 macOS runner 上 launchctl managername 会返回 Aqua（假阳性），
// 因此判定改为「不在 CI + Aqua + 控制台有真实用户」三信号合取。
// 这里直接调用判定函数验证它——两种环境都可以在任意机器上确定性地测出来。
{
  const savedCI = process.env.CI
  const savedStrict = process.env.AI_EDU_STRICT_LAUNCHSERVICES
  try {
    process.env.CI = 'true'
    delete process.env.AI_EDU_STRICT_LAUNCHSERVICES
    const inCi = inspectGuiSession()
    check('CI 环境下判定为「无可用图形会话」（跳过 LaunchServices 验收）', inCi.usable === false, inCi.detail)
    check('CI 判定理由里明确提到 CI 与图形域', inCi.detail.includes('CI') && inCi.detail.includes('Aqua'), inCi.detail)

    process.env.AI_EDU_STRICT_LAUNCHSERVICES = '1'
    const forced = inspectGuiSession()
    check('设置 AI_EDU_STRICT_LAUNCHSERVICES=1 可强制开启（供真实 Mac 人工验收）', forced.usable === true, forced.detail)
    check('强制开启时也把判定依据打进日志', forced.detail.includes('强制'), forced.detail)
  } finally {
    if (savedCI === undefined) delete process.env.CI
    else process.env.CI = savedCI
    if (savedStrict === undefined) delete process.env.AI_EDU_STRICT_LAUNCHSERVICES
    else process.env.AI_EDU_STRICT_LAUNCHSERVICES = savedStrict
  }
}

// ---------------------------------------------------------------- 输出
let failed = 0
console.log(`\n=== 跨平台路径自检（当前机器：${process.platform}） ===\n`)
for (const item of results) {
  if (!item.ok) failed += 1
  console.log(`   ${item.ok ? '✓' : '✗'} ${item.name}${item.detail && !item.ok ? `（实际：${item.detail}）` : ''}`)
}
console.log(`\n共 ${results.length} 项，失败 ${failed} 项\n`)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: failed === 0, total: results.length, failed, results }, null, 2))
}

process.exit(failed === 0 ? 0 : 1)
