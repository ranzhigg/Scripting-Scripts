/**
 * Pure parsing helpers for Surge module resources.
 *
 * Keep these helpers independent from Scripting/FileManager so the parser can
 * be tested on a desktop and, more importantly, so localization never needs
 * to guess at any other value in a module (ordinary rules, icons, etc.).
 */

export type RemoteScriptPathReference = {
  lineIndex: number
  start: number
  end: number
  value: string
  quote: "" | "'" | '"'
}

export type RemoteModuleResourceReference = RemoteScriptPathReference & {
  kind: "script" | "ruleset" | "domainset" | "include"
}

/**
 * Return a path suitable for Surge's profile-relative resource fields.
 * Keeping this pure makes the iCloud/subdirectory rule explicit and testable:
 * a module under `Providers/` must reference `Providers/...`, not only the
 * basename of the resource file.
 */
export function relativeProfilePath(profileDir: string, targetPath: string): string {
  const from = String(profileDir ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
  const target = String(targetPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
  if (target === from) return ""
  if (target.startsWith(`${from}/`)) return target.slice(from.length + 1)
  // If a provider returns paths with different prefixes, never leak an
  // absolute path into the module. The caller can still use the same-folder
  // fallback safely; bookmark-backed paths normally take the branch above.
  return target.split("/").pop() ?? target
}

function isSectionHeader(line: string): boolean {
  return /^\s*\[[^\]]+\]\s*$/.test(line)
}

function isScriptSection(line: string): boolean {
  return /^\s*\[\s*Script\s*\]\s*$/i.test(line)
}

function isRemoteURL(value: string): boolean {
  return /^https?:\/\//i.test(String(value ?? "").trim())
}

function isLocalResourcePath(value: string): boolean {
  return /(?:^|[\\/])\.scripting-resources(?:[\\/]|$)/i.test(String(value ?? "").trim())
}

function acceptsResourceValue(value: string, includeLocal: boolean): boolean {
  return isRemoteURL(value) || (includeLocal && isLocalResourcePath(value))
}

function findScriptPathParameter(line: string, includeLocal = false): Omit<RemoteScriptPathReference, "lineIndex"> | null {
  // The modern declaration uses comma-separated key=value pairs. The legacy
  // form uses whitespace before the first parameter, so accept both without
  // matching a comment or a similarly named option.
  const match = /(?:^|[,\s])script-path\s*=\s*/i.exec(line)
  if (!match) return null

  const valueStart = match.index + match[0].length
  const first = line[valueStart]
  if (first === "'" || first === '"') {
    const close = line.indexOf(first, valueStart + 1)
    if (close < 0) return null
    const value = line.slice(valueStart + 1, close).trim()
    if (!acceptsResourceValue(value, includeLocal)) return null
    return {
      start: valueStart,
      end: close + 1,
      value,
      quote: first,
    }
  }

  const rest = line.slice(valueStart)
  const rawEnd = rest.search(/\s*,\s*/)
  const segmentEnd = rawEnd < 0 ? rest.length : rawEnd
  const segment = rest.slice(0, segmentEnd)
  const value = segment.trim()
  if (!acceptsResourceValue(value, includeLocal)) return null

  const leading = segment.search(/\S/)
  if (leading < 0) return null
  return {
    start: valueStart + leading,
    end: valueStart + segment.length,
    value,
    quote: "",
  }
}

/** Find only HTTP(S) script-path values inside the [Script] section. */
export function extractRemoteScriptPathReferences(content: string): RemoteScriptPathReference[] {
  return extractRemoteModuleResourceReferences(content)
    .filter((reference) => reference.kind === "script")
    .map(({ kind: _kind, ...reference }) => reference)
}

function findExternalSetReference(line: string, includeLocal = false): Omit<RemoteModuleResourceReference, "lineIndex"> | null {
  const match = /^\s*(RULE-SET|DOMAIN-SET)\s*,\s*/i.exec(line)
  if (!match) return null
  const kind = match[1].toLowerCase() === "rule-set" ? "ruleset" : "domainset"
  const valueStart = match[0].length
  const first = line[valueStart]
  if (first === "'" || first === '"') {
    const close = line.indexOf(first, valueStart + 1)
    if (close < 0) return null
    const value = line.slice(valueStart + 1, close).trim()
    if (!acceptsResourceValue(value, includeLocal)) return null
    return { start: valueStart, end: close + 1, value, quote: first, kind }
  }
  const rest = line.slice(valueStart)
  const comma = rest.indexOf(",")
  const segment = comma < 0 ? rest : rest.slice(0, comma)
  const value = segment.trim()
  if (!acceptsResourceValue(value, includeLocal)) return null
  const leading = segment.search(/\S/)
  if (leading < 0) return null
  return {
    start: valueStart + leading,
    end: valueStart + segment.length,
    value,
    quote: "",
    kind,
  }
}

function findRemoteInclude(line: string, includeLocal = false): Omit<RemoteModuleResourceReference, "lineIndex"> | null {
  const match = /^\s*#!include\s+/i.exec(line)
  if (!match) return null
  const valueStart = match[0].length
  const first = line[valueStart]
  if (first === "'" || first === '"') {
    const close = line.indexOf(first, valueStart + 1)
    if (close < 0) return null
    const value = line.slice(valueStart + 1, close).trim()
    if (!acceptsResourceValue(value, includeLocal)) return null
    return { start: valueStart, end: close + 1, value, quote: first, kind: "include" }
  }
  const value = line.slice(valueStart).trim()
  if (!acceptsResourceValue(value, includeLocal)) return null
  return {
    start: valueStart + line.slice(valueStart).search(/\S/),
    end: valueStart + line.slice(valueStart).length,
    value,
    quote: "",
    kind: "include",
  }
}

/** Find remote scripts, rule sets, domain sets, and included profiles. */
export function extractRemoteModuleResourceReferences(content: string): RemoteModuleResourceReference[] {
  const lines = String(content ?? "").split(/\r?\n/g)
  const references: RemoteModuleResourceReference[] = []
  let inScriptSection = false

  lines.forEach((line, lineIndex) => {
    if (isScriptSection(line)) {
      inScriptSection = true
      return
    }
    if (isSectionHeader(line)) {
      inScriptSection = false
      return
    }
    if (/^\s*[#;]/.test(line)) {
      const include = findRemoteInclude(line)
      if (include) references.push({ lineIndex, ...include })
      return
    }
    if (inScriptSection) {
      const script = findScriptPathParameter(line)
      if (script) references.push({ lineIndex, ...script, kind: "script" })
    }
    const set = findExternalSetReference(line)
    if (set) references.push({ lineIndex, ...set })
    const include = findRemoteInclude(line)
    if (include) references.push({ lineIndex, ...include })
  })

  return references
}

/** Find resources already rewritten into the local `.scripting-resources` tree. */
export function extractLocalModuleResourceReferences(content: string): RemoteModuleResourceReference[] {
  const lines = String(content ?? "").split(/\r?\n/g)
  const references: RemoteModuleResourceReference[] = []
  let inScriptSection = false

  lines.forEach((line, lineIndex) => {
    if (isScriptSection(line)) {
      inScriptSection = true
      return
    }
    if (isSectionHeader(line)) {
      inScriptSection = false
      return
    }
    if (/^\s*[#;]/.test(line)) {
      const include = findRemoteInclude(line, true)
      if (include && isLocalResourcePath(include.value)) references.push({ lineIndex, ...include })
      return
    }
    if (inScriptSection) {
      const script = findScriptPathParameter(line, true)
      if (script && isLocalResourcePath(script.value)) references.push({ lineIndex, ...script, kind: "script" })
    }
    const set = findExternalSetReference(line, true)
    if (set && isLocalResourcePath(set.value)) references.push({ lineIndex, ...set })
    const include = findRemoteInclude(line, true)
    if (include && isLocalResourcePath(include.value)) references.push({ lineIndex, ...include })
  })

  return references
}

/**
 * Rewrite selected remote script paths while preserving the rest of each line
 * and preserving quote style. `replacements` may be keyed by the original URL
 * or by `script:${url}`.
 */
export function rewriteRemoteScriptPaths(
  content: string,
  replacements: Map<string, string> | Record<string, string>,
): string {
  return rewriteRemoteModuleResources(content, replacements, "script")
}

export function rewriteRemoteModuleResources(
  content: string,
  replacements: Map<string, string> | Record<string, string>,
  kind?: RemoteModuleResourceReference["kind"],
): string {
  const refs = extractRemoteModuleResourceReferences(content)
    .filter((reference) => !kind || reference.kind === kind)
  return rewriteModuleResourceReferences(content, refs, replacements)
}

/** Rewrite an explicit set of resource references, including local paths. */
export function rewriteModuleResourceReferences(
  content: string,
  refs: RemoteModuleResourceReference[],
  replacements: Map<string, string> | Record<string, string>,
): string {
  const lines = String(content ?? "").split(/\r?\n/g)
  const byLine = new Map<number, RemoteModuleResourceReference[]>()
  for (const ref of refs) {
    const list = byLine.get(ref.lineIndex) ?? []
    list.push(ref)
    byLine.set(ref.lineIndex, list)
  }

  for (const [lineIndex, lineRefs] of byLine.entries()) {
    let line = lines[lineIndex]
    for (const ref of [...lineRefs].sort((a, b) => b.start - a.start)) {
      const kindKey = `${ref.kind}:${ref.value}`
      const replacement = replacements instanceof Map
        ? replacements.get(kindKey) ?? replacements.get(ref.value)
        : replacements[kindKey] ?? replacements[ref.value]
      if (!replacement) continue
      const rendered = ref.quote ? `${ref.quote}${replacement}${ref.quote}` : replacement
      line = `${line.slice(0, ref.start)}${rendered}${line.slice(ref.end)}`
    }
    lines[lineIndex] = line
  }
  return lines.join("\n")
}
