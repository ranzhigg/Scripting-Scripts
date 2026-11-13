import {
  fetchAvoidedPolicies,
  fetchCaptureFilters,
  fetchSurgePolicies,
  getRemoteAPIURL,
  setPolicyAvoided,
} from "../utils/remote_control"

const cfg: any = {
  remoteHost: "https://127.0.0.1/v1",
  remotePort: "6171",
  remotePassword: "test-key",
  remoteAuthMode: "x-key",
}

if (getRemoteAPIURL(cfg, "/policies") !== "https://127.0.0.1:6171/v1/policies") {
  throw new Error("Surge API path was not normalized")
}
if (getRemoteAPIURL({ ...cfg, remoteHost: "https://127.0.0.1:6171", remotePort: "" }, "/modules") !== "https://127.0.0.1:6171/v1/modules") {
  throw new Error("embedded Surge API port was not accepted")
}

const calls: { url: string; init: any }[] = []
const previousFetch = (globalThis as any).fetch
;(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, init })
  if (url.endsWith("/policies")) {
    return { ok: true, status: 200, json: async () => ({ proxies: ["Proxy A"] }) }
  }
  if (url.endsWith("/policies/avoided")) {
    if (init.method === "GET") return { ok: true, status: 200, json: async () => ({ policies: [] }) }
    const body = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ policies: body.avoided ? [body.policy_name] : [] }) }
  }
  return { ok: true, status: 200, json: async () => ({ active: "in-memory", filters: {} }) }
}

async function run() {
  try {
    const policies = await fetchSurgePolicies(cfg)
    if (policies.proxies?.[0] !== "Proxy A") throw new Error("policies response was not decoded")

    const avoided = await fetchAvoidedPolicies(cfg)
    if (avoided.size !== 0) throw new Error("avoided policies response was not decoded")

    const next = await setPolicyAvoided(cfg, "Proxy A", true)
    if (!next.has("Proxy A")) throw new Error("policy avoidance request was not applied")

    await fetchCaptureFilters(cfg)
    const moduleRequest = calls.find((call) => call.url.endsWith("/policies") && call.init.method === "GET")
    if (moduleRequest?.init.headers?.["X-Key"] !== "test-key") throw new Error("X-Key header was not sent")
    await fetchSurgePolicies({ ...cfg, remoteAuthMode: "bearer" })
    const bearerCalls = calls.filter((call) => call.url.endsWith("/policies") && call.init.method === "GET")
    const bearerRequest = bearerCalls[bearerCalls.length - 1]
    if (bearerRequest?.init.headers?.Authorization !== "Bearer test-key") throw new Error("Bearer header was not sent")
    console.log("remote_control: ok")
  } finally {
    ;(globalThis as any).fetch = previousFetch
  }
}

void run()
