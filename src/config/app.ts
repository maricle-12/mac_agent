/**
 * 全局品牌与产品配置。
 * 修改品牌只需要改这个文件，不要在各组件里硬编码产品名称。
 */
export const appConfig = {
  /** 产品名称 */
  appName: 'AI 教育智能体',
  /** 产品副标题 */
  appSubtitle: '面向教师与学生的智能学习助手',
  /** 品牌标记：1~2 个字符或 emoji，渲染在圆角方块中 */
  logo: 'AI',
  /** 版本号 */
  version: '0.1.0',
  /** 页脚 / 关于弹窗中的说明 */
  description:
    '无需安装、无需注册。使用你自己的模型 API Key，即可获得面向教学的智能助手能力。',
} as const

export type AppConfig = typeof appConfig
