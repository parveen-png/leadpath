export type SplitName = {
  fullName: string;
  firstName: string;
  lastName: string;
};

export function splitFullName(input: string): SplitName {
  const fullName = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!fullName) return { fullName: "", firstName: "", lastName: "" };
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return { fullName, firstName: parts[0] ?? "", lastName: "" };
  }
  return {
    fullName,
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

export function normalizePhone(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return trimmed;
}
