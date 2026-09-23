import type { AgentMode } from '@/types/conversation'

/** 空状态下的快捷卡片 */
export interface QuickPrompt {
  id: string
  title: string
  description: string
  /** 点击后填入输入框的内容 */
  prompt: string
}

export const quickPrompts: Record<AgentMode, QuickPrompt[]> = {
  teacher: [
    {
      id: 'lesson-plan',
      title: '生成教学设计',
      description: '按学段学科生成可直接上课的教案',
      prompt: '帮我设计一节完整的教学设计（教案），包含教学目标、重难点、教学过程与作业设计。',
    },
    {
      id: 'key-points',
      title: '分析教学重难点',
      description: '梳理重点、难点与突破策略',
      prompt: '请帮我分析这节课的教学重点与教学难点，并给出具体的突破策略。',
    },
    {
      id: 'exercises',
      title: '生成课堂练习',
      description: '分层练习 + 参考答案 + 易错点',
      prompt: '请根据教学内容生成一套课堂练习，包含基础、提升、拓展三个层次，并给出参考答案与易错点分析。',
    },
    {
      id: 'activities',
      title: '设计课堂活动',
      description: '可落地的课堂互动活动',
      prompt: '请为这节课设计 2~3 个可落地的课堂活动，包含教师活动、学生活动与设计意图。',
    },
  ],
  student: [
    {
      id: 'explain',
      title: '讲解知识点',
      description: '讲清「为什么」，再举例子',
      prompt: '请帮我讲解这个知识点，先说明它为什么是这样，再举一个例子：',
    },
    {
      id: 'analyze',
      title: '分析一道题',
      description: '分步骤分析思路与方法',
      prompt: '请帮我分析这道题的思路，不要直接给答案：',
    },
    {
      id: 'check',
      title: '检查我的答案',
      description: '指出错在哪一步、为什么错',
      prompt: '请帮我检查我的答案，指出错误出现在哪一步、为什么错，并给出修正方向：',
    },
    {
      id: 'mistakes',
      title: '整理错题',
      description: '归纳错因与同类题方法',
      prompt: '请帮我把这类错题整理一下，归纳错因和同类题的解题方法。',
    },
  ],
}

/** 各模式下的空状态问候语 */
export const emptyStateGreeting: Record<AgentMode, string> = {
  teacher: '今天想准备什么课程？',
  student: '今天想学习什么？',
}

/** 各模式下的输入框占位符 */
export const inputPlaceholder: Record<AgentMode, string> = {
  teacher: '输入教学需求，例如：帮我设计一节二年级数学课……',
  student: '输入你想学习的问题……',
}
