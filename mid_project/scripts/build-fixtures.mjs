// Renders the fake 등기부 HTML sources in tests/fixtures/ into PDF / PNG / JPG with headless Chrome.
// Usage: node scripts/build-fixtures.mjs [registry|contract]   (default: both)
// Set CHROME=/path/to/chrome if it is not in the default place.
// macOS only for the JPG step (uses the built-in `sips`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = resolve(import.meta.dirname, "../tests/fixtures");

const registryJobs = [
  { src: "fake-01-apartment.html", out: "fake-01-apartment.pdf", kind: "pdf" },
  { src: "fake-02-villa.html", out: "fake-02-villa.pdf", kind: "pdf" },
  // a slightly blurry, slightly tilted photo of a one-page 증명서
  { src: "fake-03-officetel.html", hash: "photo,slightly-blurry", out: "fake-03-officetel.png", kind: "png", size: "1240,1754" },
  // a very blurry, tilted photo that only shows the top part of fake-01
  { src: "fake-01-apartment.html", hash: "photo,very-blurry", out: "fake-04-blurry.jpg", kind: "jpg", size: "1000,760" },
];

// v0.4 contracts: one template, the case is picked with ?id=
const contractJobs = [
  { src: "fake-contract.html", query: "id=11", out: "fake-11-contract-ok.pdf", kind: "pdf" },
  { src: "fake-contract.html", query: "id=12", out: "fake-12-contract-other-landlord.pdf", kind: "pdf" },
  { src: "fake-contract.html", query: "id=13", hash: "photo,slightly-blurry", out: "fake-13-contract-unit-mismatch.png", kind: "png", size: "1240,1754" },
  { src: "fake-contract.html", query: "id=14", out: "fake-14-contract-coowner-agent.pdf", kind: "pdf" },
  { src: "fake-contract.html", query: "id=15", hash: "photo,slightly-blurry", out: "fake-15-contract-trust-high-deposit.jpg", kind: "jpg", size: "1240,1754" },
];

const group = process.argv[2];
const jobs = [...(group !== "contract" ? registryJobs : []), ...(group !== "registry" ? contractJobs : [])];

const profile = mkdtempSync(join(tmpdir(), "fixtures-chrome-"));
try {
  for (const job of jobs) {
    const url = pathToFileURL(join(DIR, job.src)).href + (job.query ? `?${job.query}` : "") + (job.hash ? `#${job.hash}` : "");
    const out = join(DIR, job.out);
    const base = ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`];
    if (job.kind === "pdf") {
      execFileSync(CHROME, [...base, "--no-pdf-header-footer", `--print-to-pdf=${out}`, url], { stdio: "ignore" });
    } else {
      const png = job.kind === "png" ? out : out.replace(/\.jpg$/, ".tmp.png");
      execFileSync(CHROME, [...base, `--window-size=${job.size}`, `--screenshot=${png}`, url], { stdio: "ignore" });
      if (job.kind === "jpg") {
        execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", png, "--out", out], { stdio: "ignore" });
        rmSync(png);
      }
    }
    console.log(`wrote tests/fixtures/${job.out}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
