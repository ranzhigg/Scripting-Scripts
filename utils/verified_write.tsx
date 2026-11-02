import { withTimeout } from "./async"

/**
 * A small write transaction for Scripting's FileManager.
 *
 * File Provider writes can return before iCloud has committed the bytes.  A
 * caller must therefore never treat writeAsString() alone as success.  This
 * helper reads the target back and restores the previous snapshot if either
 * the write or the read-back check fails.
 */
export type TextFileSnapshot = {
  exists: boolean
  content: string
}

export const VERIFIED_WRITE_TIMEOUT_MS = 15 * 1000

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]): Promise<any> {
  const value = fn.apply(thisArg, args)
  return value && typeof value.then === "function" ? await value : value
}

async function existsHint(path: string): Promise<boolean | undefined> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") {
    return !!(await callMaybeAsync(fm.exists, fm, [path]))
  }
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return undefined
}

export async function readTextVerified(
  path: string,
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<string> {
  const fm = fmOrThrow()
  if (typeof fm.readAsString !== "function") {
    throw new Error("FileManager.readAsString 不可用")
  }
  return String(
    await withTimeout(
      () => callMaybeAsync(fm.readAsString, fm, [path]),
      timeoutMs,
      `读取文件超时（${timeoutMs / 1000}s）：${path}`,
    ),
  )
}

/**
 * Take a best-effort existence snapshot while still surfacing an actual
 * read/permission error for a file provider that says the file exists.
 */
export async function snapshotText(
  path: string,
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<TextFileSnapshot> {
  const hint = await existsHint(path)
  if (hint === true) {
    return { exists: true, content: await readTextVerified(path, timeoutMs) }
  }
  try {
    return { exists: true, content: await readTextVerified(path, timeoutMs) }
  } catch (error) {
    if (hint === false || hint === undefined) return { exists: false, content: "" }
    throw error
  }
}

export async function writeTextVerified(
  path: string,
  content: string,
  label = "文件",
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<void> {
  const fm = fmOrThrow()
  const writer = typeof fm.writeAsString === "function"
    ? fm.writeAsString
    : fm.writeAsStringSync
  if (typeof writer !== "function") throw new Error("FileManager.writeAsString 不可用")

  const result = await withTimeout(
    () => callMaybeAsync(writer, fm, [path, content]),
    timeoutMs,
    `${label}写入超时（${timeoutMs / 1000}s）：${path}`,
  )
  if (result === false) throw new Error(`FileManager 拒绝写入：${path}`)

  const saved = await readTextVerified(path, timeoutMs)
  if (saved !== content) throw new Error(`${label}写入后校验失败：${path}`)
}

export async function removeTextVerified(
  path: string,
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<void> {
  const fm = fmOrThrow()
  const remover = typeof fm.remove === "function" ? fm.remove : fm.removeSync
  if (typeof remover !== "function") throw new Error("FileManager.remove 不可用")
  const result = await withTimeout(
    () => callMaybeAsync(remover, fm, [path]),
    timeoutMs,
    `删除文件超时（${timeoutMs / 1000}s）：${path}`,
  )
  if (result === false) throw new Error(`FileManager 拒绝删除：${path}`)

  const remaining = await snapshotText(path, timeoutMs)
  if (remaining.exists) throw new Error(`删除后仍可读取文件：${path}`)
}

export async function restoreTextSnapshot(
  path: string,
  snapshot: TextFileSnapshot,
  label = "文件回滚",
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<void> {
  if (snapshot.exists) {
    await writeTextVerified(path, snapshot.content, label, timeoutMs)
    return
  }

  const current = await snapshotText(path, timeoutMs)
  if (current.exists) await removeTextVerified(path, timeoutMs)
}

/**
 * Replace one text file transactionally. The returned snapshot is useful for
 * callers that need to report what was preserved, but the normal caller only
 * needs the guarantee that a failed replacement is rolled back.
 */
export async function replaceTextVerified(
  path: string,
  content: string,
  label = "文件",
  timeoutMs = VERIFIED_WRITE_TIMEOUT_MS,
): Promise<TextFileSnapshot> {
  const previous = await snapshotText(path, timeoutMs)
  try {
    await writeTextVerified(path, content, label, timeoutMs)
    return previous
  } catch (error) {
    try {
      await restoreTextSnapshot(path, previous, `${label}失败回滚`, timeoutMs)
    } catch (rollbackError) {
      throw new Error(
        `${String((error as any)?.message ?? error)}；${label}回滚失败：${String((rollbackError as any)?.message ?? rollbackError)}`,
      )
    }
    throw error
  }
}
