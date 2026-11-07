import { z } from 'zod'

export interface ToolDef {
  name: string
  description: string
  module: 'payment' | 'wallet' | 'data' | 'account'
  action: string
  schema: Record<string, z.ZodTypeAny>
}

export const str = z.string()
export const optStr = z.string().optional()
export const optJson = z.record(z.unknown()).optional()
/** 接受 JSON 数字或十进制字符串（大整数 / u64 索引）。 */
export const numOrStr = z.union([z.string(), z.number()])
