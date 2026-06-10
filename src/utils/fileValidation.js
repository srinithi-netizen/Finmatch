import * as XLSX from "xlsx";

const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const ALLOWED_EXTENSIONS = ["pdf", "csv", "xlsx", "xls"];
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// --- SHA-256 hash ---
export async function getFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Extension check ---
function getExtension(filename) {
  return filename.split(".").pop().toLowerCase();
}

// --- Type/extension validation ---
function isSupportedType(file) {
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) return false;

  // Some browsers give empty/odd MIME types for csv/xlsx, so rely mainly on extension,
  // but cross-check MIME if present
  if (file.type && !Object.keys(ALLOWED_TYPES).includes(file.type)) {
    // Allow fallback: some systems report csv as "application/vnd.ms-excel" or empty
    if (file.type !== "" && !file.type.includes("octet-stream")) {
      // Extension still allowed, MIME mismatch -> treat extension as source of truth
      // but flag if totally unrelated (e.g. image/png with .pdf renamed)
      const mismatchedImage = file.type.startsWith("image/");
      const mismatchedVideo = file.type.startsWith("video/");
      if (mismatchedImage || mismatchedVideo) return false;
    }
  }
  return true;
}
function isEmptyFile(file) {
  return file.size === 0;
}

// --- Size validation ---
function isWithinSizeLimit(file) {
  return file.size <= MAX_SIZE_BYTES;
}

// --- Corruption checks ---

// PDF: check header signature (%PDF-) and EOF marker (%%EOF)
async function isValidPdf(file) {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Check minimum size
    if (bytes.length < 8) return false;

    // Header check: first 5 bytes should be %PDF-
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    if (header !== "%PDF-") return false;

    // Footer check: look for %%EOF in last 1024 bytes
    const tailLength = Math.min(1024, bytes.length);
    const tail = new TextDecoder().decode(
      bytes.slice(bytes.length - tailLength)
    );
    if (!tail.includes("%%EOF")) return false;

    return true;
  } catch (err) {
    return false;
  }
}

// CSV: try parsing - check it's readable text and has at least one row with content
async function isValidCsv(file) {
  try {
    const text = await file.text();
    if (!text || text.trim().length === 0) return false;

    // Check for binary garbage (null bytes indicate corruption/non-text)
    if (text.includes("\u0000")) return false;

    // Must have at least one line with a delimiter or content
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return false;

    return true;
  } catch (err) {
    return false;
  }
}

// XLSX/XLS: try parsing with SheetJS - if it throws, file is corrupted
async function isValidExcel(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    // Must have at least one sheet with a name
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return false;
    }

    // Try to access the first sheet to confirm it's readable
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return false;

    return true;
  } catch (err) {
    return false;
  }
}

async function isFileCorrupted(file) {
  const ext = getExtension(file.name);

  if (ext === "pdf") {
    const valid = await isValidPdf(file);
    return !valid;
  }

  if (ext === "csv") {
    const valid = await isValidCsv(file);
    return !valid;
  }

  if (ext === "xlsx" || ext === "xls") {
    const valid = await isValidExcel(file);
    return !valid;
  }

  return false;
}

/**
 * Main validation function
 * @param {File} file - the file to validate
 * @param {string[]} existingHashes - array of SHA-256 hashes already uploaded for this client
 * @returns {Promise<{ valid: boolean, error: string|null, hash: string|null }>}
 */
export async function validateFile(file, existingHashes = []) {
    
  // 1. Unsupported file type check
  if (!isSupportedType(file)) {
    return {
      valid: false,
      error: `Unsupported file type: "${file.name}". Only PDF, CSV, and XLSX files are allowed.`,
      hash: null,
    };
  }

  // 2. Max size check (25 MB)
  if (!isWithinSizeLimit(file)) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `"${file.name}" is too large (${sizeMB} MB). Maximum allowed size is 25 MB.`,
      hash: null,
    };
  }

  // 3. Corrupted file check
  const corrupted = await isFileCorrupted(file);
  if (corrupted) {
    return {
      valid: false,
      error: `"${file.name}" appears to be corrupted or damaged. Please select a valid file.`,
      hash: null,
    };
  }

  // 4. Duplicate check (SHA-256)
  const hash = await getFileHash(file);
  if (existingHashes.includes(hash)) {
    return {
      valid: false,
      error: `"${file.name}" has already been uploaded (duplicate file detected).`,
      hash,
    };
  }
   if (isEmptyFile(file)) {
    return {
      valid: false,
      error: `"${file.name}" is empty (0 bytes). Please upload a valid file.`,
      hash: null,
    };
  }

  return { valid: true, error: null, hash };
}