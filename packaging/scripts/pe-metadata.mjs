/**
 * 给打包好的 EXE 写入 Windows 产品图标与文件版本信息（Version Resource）。
 *
 * 使用 resedit（纯 JS，不需要编译器），只做两件事：
 *   1. 写入 RT_ICON / RT_GROUP_ICON（来自 packaging/assets/app.ico，由 icon.mjs 从品牌 SVG 生成）；
 *   2. 写入 RT_VERSION（ProductName / FileDescription / FileVersion / ProductVersion / OriginalFilename 等）。
 *
 * 不虚构公司名与版权：项目里没有正式公司信息，CompanyName 与 LegalCopyright 留空。
 */

import fs from 'node:fs'
import * as ResEdit from 'resedit'

const LANG_ZH_CN = 2052
const CODEPAGE_UNICODE = 1200
const ICON_LANG = 1033

function parseVersion(version) {
  const parts = String(version)
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isInteger(item) && item >= 0 ? item : 0))
  while (parts.length < 4) parts.push(0)
  return parts.slice(0, 4)
}

/**
 * @param {string} exePath 可执行文件（会被原地修改）
 * @param {{ icoPath: string, version: string, productName: string, fileDescription: string, originalFilename: string, companyName?: string, copyright?: string, internalName?: string }} meta
 */
export function applyWindowsMetadata(exePath, meta) {
  const [major, minor, micro, revision] = parseVersion(meta.version)

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)

  // ---------------------------------------------------------------- 图标
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(meta.icoPath))
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    ICON_LANG,
    iconFile.icons.map((item) => item.data),
  )

  // ---------------------------------------------------------------- 版本信息
  const versionInfo = ResEdit.Resource.VersionInfo.createEmpty()
  versionInfo.setFileVersion(major, minor, micro, revision, LANG_ZH_CN)
  versionInfo.setProductVersion(major, minor, micro, revision, LANG_ZH_CN)

  const strings = {
    ProductName: meta.productName,
    FileDescription: meta.fileDescription,
    // 固定信息块写的是 1.0.1.0，这里显式覆盖字符串表，保证属性页显示 1.0.1
    FileVersion: meta.version,
    ProductVersion: meta.version,
    OriginalFilename: meta.originalFilename,
    InternalName: meta.internalName ?? meta.originalFilename,
    CompanyName: meta.companyName ?? '',
    LegalCopyright: meta.copyright ?? '',
  }
  versionInfo.setStringValues({ lang: LANG_ZH_CN, codepage: CODEPAGE_UNICODE }, strings)
  versionInfo.outputToResourceEntries(resources.entries)

  resources.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))

  return {
    icon: iconFile.icons.length,
    version: `${major}.${minor}.${micro}.${revision}`,
  }
}

/** 读取 EXE 的版本资源（用于构建后自检） */
export function readWindowsMetadata(exePath) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)
  const versionInfo = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  if (versionInfo.length === 0) return null

  const info = versionInfo[0]
  const languages = info.getAllLanguagesForStringValues()
  const values = languages.length > 0 ? info.getStringValues(languages[0]) : {}
  const icons = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)

  return {
    productName: values.ProductName ?? '',
    fileDescription: values.FileDescription ?? '',
    fileVersion: values.FileVersion ?? '',
    productVersion: values.ProductVersion ?? '',
    originalFilename: values.OriginalFilename ?? '',
    iconGroups: icons.length,
  }
}
