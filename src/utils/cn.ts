/** 合并 className，过滤掉 false / null / undefined */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
