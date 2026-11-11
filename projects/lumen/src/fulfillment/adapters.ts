export type PrintJobRequest = {
  id: string;
  designId: string;
  title: string;
  material: string;
  quantity: number;
};

export type PrintJobResult = {
  ok: boolean;
  status: "disabled" | "queued" | "rejected";
  providerJobId: string | null;
  physical: false;
  reason: string;
};

export interface FulfillmentAdapter {
  name: "off" | "mock" | "print_farm" | "octoprint" | "bambu" | "prusa";
  configured: boolean;
  submit(job: PrintJobRequest): PrintJobResult;
}

/** Generic print-farm HTTP shape. The vendor is whoever the owner puts in LUMEN_PRINT_FARM_URL. */
export type PrintFarmRequest = {
  method: "POST";
  url: string;
  headers: { "content-type": "application/json"; authorization?: string };
  body: { designId: string; material: string; quantity: number; idempotencyKey: string };
};

export class PrintFarmStub implements FulfillmentAdapter {
  name = "print_farm" as const;
  configured: boolean;
  constructor(private readonly url: string, private readonly token: string) {
    this.configured = Boolean(url && token);
  }
  submit(job: PrintJobRequest): PrintJobResult {
    const request: PrintFarmRequest = {
      method: "POST",
      url: this.url,
      headers: { "content-type": "application/json", ...(this.token ? { authorization: "Bearer [redacted]" } : {}) },
      body: { designId: job.designId, material: job.material, quantity: job.quantity, idempotencyKey: `print:${job.id}` },
    };
    void request;
    return { ok: false, status: "disabled", providerJobId: null, physical: false, reason: this.configured ? "PRINT_FARM_NOT_LIVE" : "NOT_CONFIGURED" };
  }
}

export class LocalPrinterStub implements FulfillmentAdapter {
  configured: boolean;
  constructor(readonly name: "octoprint" | "bambu" | "prusa", url: string) {
    this.configured = Boolean(url);
  }
  submit(): PrintJobResult {
    return { ok: false, status: "disabled", providerJobId: null, physical: false, reason: this.configured ? "LOCAL_PRINTER_NOT_LIVE" : "NOT_CONFIGURED" };
  }
}

export class MockFulfillment implements FulfillmentAdapter {
  name = "mock" as const;
  configured = true;
  jobs: PrintJobRequest[] = [];
  submit(job: PrintJobRequest): PrintJobResult {
    this.jobs.push(job);
    return { ok: true, status: "queued", providerJobId: `mock_${job.id}`, physical: false, reason: "MOCK_QUEUED" };
  }
}

export class OffFulfillment implements FulfillmentAdapter {
  name = "off" as const;
  configured = false;
  submit(): PrintJobResult {
    return { ok: false, status: "disabled", providerJobId: null, physical: false, reason: "NOT_CONFIGURED" };
  }
}

export function createFulfillment(env: Record<string, string | undefined>): FulfillmentAdapter {
  const mode = env.LUMEN_FULFILLMENT ?? "off";
  if (mode === "mock") return new MockFulfillment();
  if (mode === "print_farm") return new PrintFarmStub(env.LUMEN_PRINT_FARM_URL ?? "", env.LUMEN_PRINT_FARM_TOKEN ?? "");
  if (mode === "octoprint") return new LocalPrinterStub("octoprint", env.LUMEN_OCTOPRINT_URL ?? "");
  if (mode === "bambu") return new LocalPrinterStub("bambu", env.LUMEN_BAMBU_URL ?? "");
  if (mode === "prusa") return new LocalPrinterStub("prusa", env.LUMEN_PRUSA_URL ?? "");
  return new OffFulfillment();
}
