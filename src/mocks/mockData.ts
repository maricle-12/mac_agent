import type { Conversation } from '@/types/conversation'
import { createId } from '@/utils/id'

/**
 * 阶段 2 临时模拟数据（仅用于在没有历史记录时提供示例会话，阶段 9 接入 IndexedDB 后移除）。
 * 真实的模型回答从阶段 7 起由 DeepSeek 流式返回，这里不再生成任何回答。
 */

function minutesAgo(minutes: number): number {
  return Date.now() - minutes * 60 * 1000
}

export const seedConversations: Conversation[] = [
  {
    id: createId('c_'),
    title: '二年级数学分类与整理',
    mode: 'teacher',
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(12),
    messages: [
      {
        id: createId('m_'),
        role: 'user',
        content: '帮我设计一节小学二年级数学《分类与整理》课程。',
        createdAt: minutesAgo(13),
      },
      {
        id: createId('m_'),
        role: 'assistant',
        content: createTeacherMock(),
        createdAt: minutesAgo(12),
      },
    ],
  },
  {
    id: createId('c_'),
    title: '一元一次方程练习',
    mode: 'teacher',
    createdAt: minutesAgo(600),
    updatedAt: minutesAgo(240),
    messages: [
      {
        id: createId('m_'),
        role: 'user',
        content: '出一套一元一次方程的课堂练习，要分层。',
        createdAt: minutesAgo(241),
      },
      {
        id: createId('m_'),
        role: 'assistant',
        content: '好的，我可以按「基础巩固 / 能力提升 / 拓展探究」三个层次出题。请告诉我年级和教材版本，我马上生成。',
        createdAt: minutesAgo(240),
      },
    ],
  },
  {
    id: createId('c_'),
    title: '英语课堂活动设计',
    mode: 'teacher',
    createdAt: minutesAgo(1500),
    updatedAt: minutesAgo(1400),
    messages: [],
  },
  {
    id: createId('c_'),
    title: '这道题为什么错？',
    mode: 'student',
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(45),
    messages: [
      {
        id: createId('m_'),
        role: 'user',
        content: '解方程 2x + 3 = 11，我算出来 x = 7，为什么老师说是错的？',
        createdAt: minutesAgo(46),
      },
      {
        id: createId('m_'),
        role: 'assistant',
        content: createStudentMock(),
        createdAt: minutesAgo(45),
      },
    ],
  },
]

function createTeacherMock(): string {
  return `> 当前为**阶段 2 的模拟回答**，用于验证界面与 Markdown 渲染效果。接入真实模型后（阶段 7）本提示会自动消失。

## 一、教学目标

1. **知识与技能**：能按给定标准对物体进行分类，并用自己的语言说明分类结果。
2. **过程与方法**：经历「观察 → 分类 → 记录 → 交流」的过程，体会分类标准的多样性。
3. **情感态度与价值观**：感受分类在生活中的作用，养成整理物品的习惯。

## 二、教学重点与难点

| 项目 | 内容 | 突破策略 |
| --- | --- | --- |
| 教学重点 | 掌握按单一标准分类的方法 | 借助学具动手操作，边分边说 |
| 教学难点 | 体会「标准不同，结果不同」 | 同一堆物品做两次不同标准的分类并对比 |

## 三、教学过程

### 环节一：情境导入（5 分钟）

- **教师活动**：出示杂乱的文具图片，提问「怎样才能一眼看出有多少种文具？」
- **学生活动**：观察、自由表达。
- **设计意图**：制造认知冲突，让学生自己产生「需要分类」的需求。

### 环节二：动手分类（15 分钟）

\`\`\`text
任务单
1. 把学具袋里的图形倒在桌面上
2. 想一想：可以怎样分？
3. 分好后，和同桌说说你的分类标准
\`\`\`

### 环节三：汇报交流（10 分钟）

- 请两组学生上台展示不同的分类结果。
- 追问：「都是同一堆图形，为什么分出来的结果不一样？」

## 四、课堂练习

1. 把下面的数按奇偶分类：$3,\\ 8,\\ 15,\\ 22,\\ 27$
2. 若集合 $A=\\{x \\mid x>0\\}$，判断 $0 \\in A$ 是否成立，并说明理由。

用集合可以更简洁地表示分类标准：

$$B = \\{x \\in \\mathbb{Z} \\mid x > 0\\}$$

其中 $\\mathbb{Z}$ 表示整数集，$\\in$ 表示「属于」。

## 五、课堂总结

用一句话概括：**分类要先确定标准；标准不同，结果可能不同。**

## 六、作业设计

- **基础**：完成课本第 12 页第 1、2 题。
- **实践**：回家整理自己的书包，拍照记录你用的分类标准。
`
}

function createStudentMock(): string {
  return `> 当前为**阶段 2 的模拟回答**。接入真实模型后本提示会自动消失。

我们一步一步来看，你自己就能找到问题出在哪一步。

## 第一步：先明确目标

题目是解方程：

$$
2x + 3 = 11
$$

「解方程」的意思是：找到一个数，代进去让**等号两边相等**。

## 第二步：检查你的答案

你的答案是 $x = 7$。我们把 $x = 7$ 代回原方程验算：

$$
2 \\times 7 + 3 = 14 + 3 = 17
$$

左边是 $17$，右边是 $11$，**两边不相等**，所以 $x = 7$ 确实不对。

## 第三步：看看错在哪一步

解方程时，$+3$ 要**先移走**，再处理乘 $2$：

1. 两边同时减去 $3$：$2x + 3 - 3 = 11 - 3$，得到 $2x = 8$
2. 两边同时除以 $2$：$x = 4$

> 你很可能把 $2x + 3 = 11$ 直接算成了 $2x = 11 + 3$。注意：**移到等号另一边要变号**。

## 第四步：验算确认

$$
2 \\times 4 + 3 = 8 + 3 = 11
$$

两边相等，所以正确答案是 $x = 4$。

## 方法总结

| 步骤 | 做法 | 易错点 |
| --- | --- | --- |
| 1 | 先处理加减，再处理乘除 | 移项忘记变号 |
| 2 | 两边同时做同样的运算 | 只对一边运算 |
| 3 | 代回原方程验算 | 跳过验算 |

要不要我再给你两道同类题练一练？
`
}

/** 阶段 2 的模拟回答：按模式返回一段内容丰富的 Markdown（阶段 7 起已不再使用） */
