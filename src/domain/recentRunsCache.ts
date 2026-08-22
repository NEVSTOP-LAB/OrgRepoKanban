import type { RecentWorkflowRun } from '../github/data'

/**
 * 最近 30 天运行记录的本地缓存。
 *
 * 目的：提高「最近 30 天运行记录」看板的启动加载速度——启动时先用缓存立即渲染
 * （快速首屏），随后照常执行一次全量刷新，用增量合并（时间戳覆盖）把较新的运行记录
 * 覆盖进缓存并持久化。最终效果与全量刷新一致；刷新失败/仓库不可读时保留上一次成功
 * 的缓存数据，避免数据整段丢失。
 *
 * 因为缓存按组织（org）分 key，不同组织互不影响；savedAt 记录本次快照的写入时间戳。
 */
export interface RecentRunsCache {
  org: string
  /** 本次快照写入缓存的时间戳（ms） */
  savedAt: number
  runs: RecentWorkflowRun[]
}

const CACHE_PREFIX = 'orgrepokanban:recent-runs:'

function cacheKeyFor(org: string): string {
  return `${CACHE_PREFIX}${org.trim().toLowerCase()}`
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** 读取指定组织最近一次缓存的运行记录；无缓存或损坏时返回 null */
export function loadRecentRunsCache(org: string): RecentWorkflowRun[] | null {
  try {
    const raw = storage()?.getItem(cacheKeyFor(org))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as RecentRunsCache
    if (!parsed || !Array.isArray(parsed.runs)) {
      return null
    }
    return parsed.runs
  } catch {
    return null
  }
}

/** 将本次运行记录快照写入缓存（带时间戳），失败不影响主流程 */
export function saveRecentRunsCache(org: string, runs: RecentWorkflowRun[]): void {
  try {
    storage()?.setItem(cacheKeyFor(org), JSON.stringify({ org, savedAt: Date.now(), runs } satisfies RecentRunsCache))
  } catch {
    // 缓存写失败（如 localStorage 已满）不阻塞主流程
  }
}
