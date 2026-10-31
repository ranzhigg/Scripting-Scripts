import {
  extractLocalModuleResourceReferences,
  extractRemoteModuleResourceReferences,
  extractRemoteScriptPathReferences,
  relativeProfilePath,
  rewriteModuleResourceReferences,
  rewriteRemoteModuleResources,
  rewriteRemoteScriptPaths,
} from "../utils/script_localizer_core"

const sample = [
  "#!name=Demo",
  "[Script]",
  "request = type=http-request,pattern=^https://example.com,script-path=https://cdn.example.com/a.js,requires-body=true",
  "quoted = type=generic, script-path=\"https://cdn.example.com/a.js\"",
  "legacy = http-response ^https://example.com script-path=https://cdn.example.com/b.js",
  "local = type=cron,script-path=local.js",
  "[Rule]",
  "RULE-SET,https://cdn.example.com/rules.list,REJECT,no-resolve",
  "DOMAIN-SET,\"https://cdn.example.com/domains.txt\",DIRECT",
  "#!include https://cdn.example.com/extra.conf",
  "DOMAIN-SUFFIX,example.com,DIRECT",
].join("\n")

const references = extractRemoteScriptPathReferences(sample)
if (references.length !== 3) throw new Error(`expected 3 remote scripts, got ${references.length}`)
if (references[0].value !== "https://cdn.example.com/a.js") throw new Error("modern script path was not found")
if (references[1].quote !== '"') throw new Error("quoted script path lost quote metadata")
if (references[2].value !== "https://cdn.example.com/b.js") throw new Error("legacy script path was not found")

const resources = extractRemoteModuleResourceReferences(sample)
if (resources.length !== 6) throw new Error(`expected 6 remote resources, got ${resources.length}`)
if (resources.filter((item) => item.kind === "ruleset").length !== 1) throw new Error("RULE-SET was not found")
if (resources.filter((item) => item.kind === "domainset").length !== 1) throw new Error("DOMAIN-SET was not found")
if (resources.filter((item) => item.kind === "include").length !== 1) throw new Error("remote include was not found")

const rewritten = rewriteRemoteScriptPaths(sample, new Map([
  ["https://cdn.example.com/a.js", ".scripting-scripts/demo/a.js"],
  ["https://cdn.example.com/b.js", ".scripting-scripts/demo/b.js"],
]))

if (!rewritten.includes("script-path=.scripting-scripts/demo/a.js,requires-body=true")) {
  throw new Error("modern script path was not rewritten")
}
if (!rewritten.includes('script-path=".scripting-scripts/demo/a.js"')) {
  throw new Error("quoted script path was not rewritten")
}
if (!rewritten.includes("script-path=.scripting-scripts/demo/b.js")) {
  throw new Error("legacy script path was not rewritten")
}
if (!rewritten.includes("script-path=local.js")) throw new Error("local script path was changed")
if (!rewritten.includes("DOMAIN-SUFFIX,example.com,DIRECT")) throw new Error("other module sections were changed")

const resourceRewritten = rewriteRemoteModuleResources(sample, new Map([
  ["https://cdn.example.com/rules.list", "rulesets/rules.list"],
  ["https://cdn.example.com/domains.txt", "rulesets/domains.txt"],
  ["https://cdn.example.com/extra.conf", "includes/extra.conf"],
]))
if (!resourceRewritten.includes("RULE-SET,rulesets/rules.list,REJECT,no-resolve")) throw new Error("RULE-SET was not rewritten")
if (!resourceRewritten.includes('DOMAIN-SET,"rulesets/domains.txt",DIRECT')) throw new Error("DOMAIN-SET was not rewritten")
if (!resourceRewritten.includes("#!include includes/extra.conf")) throw new Error("include was not rewritten")

const sameURL = [
  "[Script]",
  "request = type=http-request,script-path=https://cdn.example.com/shared.txt",
  "[Rule]",
  "RULE-SET,https://cdn.example.com/shared.txt,REJECT",
].join("\n")
const kindSpecific = rewriteRemoteModuleResources(sameURL, new Map([
  ["script:https://cdn.example.com/shared.txt", "scripts/shared.js"],
  ["ruleset:https://cdn.example.com/shared.txt", "rulesets/shared.list"],
]))
if (!kindSpecific.includes("script-path=scripts/shared.js")) throw new Error("kind-specific script path was not rewritten")
if (!kindSpecific.includes("RULE-SET,rulesets/shared.list,REJECT")) throw new Error("kind-specific rule set path was not rewritten")
if (rewriteRemoteModuleResources(kindSpecific, new Map()).includes("https://cdn.example.com/shared.txt")) {
  throw new Error("rewritten local paths unexpectedly became remote again")
}

const profileRoot = "/icloud/Surge/Module"
const nestedResource = "/icloud/Surge/Module/Providers/Demo/.scripting-resources/Demo-aabbccdd/scripts/demo.js"
if (relativeProfilePath(profileRoot, nestedResource) !== "Providers/Demo/.scripting-resources/Demo-aabbccdd/scripts/demo.js") {
  throw new Error("nested iCloud module path was not kept relative to the Surge Module profile root")
}

const localSample = [
  "[Script]",
  "foo = type=generic,script-path=.scripting-resources/demo/scripts/a.js",
  "[Rule]",
  "RULE-SET,.scripting-resources/demo/rulesets/a.list,REJECT",
].join("\n")
const localReferences = extractLocalModuleResourceReferences(localSample)
if (localReferences.length !== 2) throw new Error(`expected 2 local resources, got ${localReferences.length}`)
const rebased = rewriteModuleResourceReferences(localSample, localReferences, new Map([
  ["script:.scripting-resources/demo/scripts/a.js", "Offline/.scripting-resources/demo/scripts/a.js"],
  ["ruleset:.scripting-resources/demo/rulesets/a.list", "Offline/.scripting-resources/demo/rulesets/a.list"],
]))
if (!rebased.includes("script-path=Offline/.scripting-resources/demo/scripts/a.js")) {
  throw new Error("local script path was not rebased")
}
if (!rebased.includes("RULE-SET,Offline/.scripting-resources/demo/rulesets/a.list,REJECT")) {
  throw new Error("local ruleset path was not rebased")
}

console.log("script_localizer_core: ok")
