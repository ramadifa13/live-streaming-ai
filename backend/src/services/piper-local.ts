import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function resolveBackendDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const cand of [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
  ]) {
    if (fs.existsSync(path.join(cand, "piper_tts", "worker.py"))) return cand;
  }
  return path.resolve(here, "../..");
}

const BACKEND_DIR = resolveBackendDir();

function piperDataDir(): string {
  return (process.env.PIPER_DIR || path.join(BACKEND_DIR, "piper_data")).trim();
}

function resolvePython(): string {
  if (process.env.PIPER_PYTHON) return process.env.PIPER_PYTHON;
  const data = piperDataDir();
  const win = path.join(data, "env", "Scripts", "python.exe");
  const nix = path.join(data, "env", "bin", "python");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(nix)) return nix;
  throw new Error(
    `Piper venv tidak ditemukan di ${data}. Jalankan: cd backend && npm run piper:setup`,
  );
}

type Pending = {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
};

class PiperLocal {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = Buffer.alloc(0);
  private mode: "line" | "body" = "line";
  private bodyNeed = 0;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private queue: Pending[] = [];
  private starting: Promise<void> | null = null;

  async ensure(): Promise<void> {
    if (this.proc && this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private boot(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Piper worker timeout (READY)"));
        this.kill();
      }, 60_000);
      this.readyWaiters.push(() => {
        clearTimeout(timeout);
        this.ready = true;
        resolve();
      });

      const data = piperDataDir();
      const python = resolvePython();
      const worker = path.join(BACKEND_DIR, "piper_tts", "worker.py");
      if (!fs.existsSync(worker)) {
        reject(new Error(`worker.py tidak ada: ${worker}`));
        return;
      }
      const env = {
        ...process.env,
        PIPER_DIR: data,
        PIPER_MODELS_DIR: process.env.PIPER_MODELS_DIR || path.join(data, "models"),
        PIPER_VOICE: process.env.PIPER_VOICE || "id_ID-news_tts-medium",
        PIPER_DEFAULT_HOST: process.env.PIPER_DEFAULT_HOST || "namira",
        PYTHONUNBUFFERED: "1",
      };
      const proc = spawn(python, ["-u", worker], {
        cwd: path.join(BACKEND_DIR, "piper_tts"),
        env,
        windowsHide: true,
      });
      this.proc = proc;
      this.buf = Buffer.alloc(0);
      this.mode = "line";
      this.ready = false;

      proc.stderr.on("data", (chunk: Buffer) => {
        const msg = chunk.toString("utf8").trim();
        if (msg) console.log(`[Piper] ${msg}`);
      });
      proc.stdout.on("data", (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.drain();
      });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        this.failAll(err);
        reject(err);
      });
      proc.on("exit", (code) => {
        const err = new Error(`Piper worker exit ${code}`);
        this.failAll(err);
        this.proc = null;
        this.ready = false;
      });

      this.drain();
    });
  }

  private failAll(err: Error) {
    const q = this.queue.splice(0);
    for (const p of q) p.reject(err);
  }

  private drain() {
    while (this.buf.length > 0) {
      if (this.mode === "line") {
        const nl = this.buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = this.buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
        this.buf = this.buf.subarray(nl + 1);
        if (!this.ready) {
          if (line === "READY") {
            const waiters = this.readyWaiters.splice(0);
            this.ready = true;
            for (const w of waiters) w();
          }
          continue;
        }
        if (line.startsWith("OK ")) {
          this.bodyNeed = Number(line.slice(3).trim());
          if (!Number.isFinite(this.bodyNeed) || this.bodyNeed < 0) {
            this.queue.shift()?.reject(new Error(`Piper OK invalid: ${line}`));
            continue;
          }
          this.mode = "body";
          continue;
        }
        if (line.startsWith("ERR ")) {
          const detail = line.slice(4);
          this.queue.shift()?.reject(new Error(detail || "Piper error"));
          continue;
        }
        continue;
      }
      if (this.buf.length < this.bodyNeed) return;
      const wav = this.buf.subarray(0, this.bodyNeed);
      this.buf = this.buf.subarray(this.bodyNeed);
      this.mode = "line";
      this.bodyNeed = 0;
      this.queue.shift()?.resolve(Buffer.from(wav));
    }
  }

  async synthesize(payload: {
    text: string;
    host: string;
    length_scale?: number;
    sample_rate?: number;
  }): Promise<Buffer> {
    await this.ensure();
    const proc = this.proc;
    if (!proc?.stdin.writable) throw new Error("Piper worker tidak siap");
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      proc.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (err) {
          this.queue.pop();
          reject(err);
        }
      });
    });
  }

  kill() {
    try {
      this.proc?.kill();
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.ready = false;
  }
}

const piperLocal = new PiperLocal();

export async function synthesizeWithLocalPiper(payload: {
  text: string;
  host: string;
  length_scale?: number;
  sample_rate?: number;
}): Promise<Buffer> {
  return piperLocal.synthesize(payload);
}

export function stopLocalPiper(): void {
  piperLocal.kill();
}
