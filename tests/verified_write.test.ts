import {
  removeTextVerified,
  replaceTextVerified,
  snapshotText,
} from "../utils/verified_write"

const files = new Map<string, string>()
let corruptNextWrite = false

const previousFileManager = (globalThis as any).FileManager
;(globalThis as any).FileManager = {
  async exists(path: string) { return files.has(path) },
  async readAsString(path: string) {
    if (!files.has(path)) throw new Error("not found")
    return files.get(path)
  },
  async writeAsString(path: string, content: string) {
    files.set(path, corruptNextWrite ? `${content}\nCORRUPTED` : content)
    corruptNextWrite = false
  },
  async remove(path: string) { files.delete(path) },
}

async function run() {
  try {
    files.set("Surge/Module/demo.sgmodule", "old module")
    await replaceTextVerified("Surge/Module/demo.sgmodule", "new module", "模块", 1000)
    if (files.get("Surge/Module/demo.sgmodule") !== "new module") {
      throw new Error("verified replacement did not persist")
    }

    corruptNextWrite = true
    let failed = false
    try {
      await replaceTextVerified("Surge/Module/demo.sgmodule", "broken module", "模块", 1000)
    } catch {
      failed = true
    }
    if (!failed) throw new Error("corrupted write was accepted")
    if (files.get("Surge/Module/demo.sgmodule") !== "new module") {
      throw new Error("failed replacement did not restore the previous module")
    }

    corruptNextWrite = true
    failed = false
    try {
      await replaceTextVerified("Surge/Script/new.js", "new script", "脚本", 1000)
    } catch {
      failed = true
    }
    if (!failed) throw new Error("corrupted new-file write was accepted")
    if ((await snapshotText("Surge/Script/new.js", 1000)).exists) {
      throw new Error("failed new-file write left a partial resource")
    }

    files.set("Surge/rules.list", "rules")
    await removeTextVerified("Surge/rules.list", 1000)
    if ((await snapshotText("Surge/rules.list", 1000)).exists) {
      throw new Error("verified remove did not remove the resource")
    }

    console.log("verified_write: ok")
  } finally {
    ;(globalThis as any).FileManager = previousFileManager
  }
}

void run()
