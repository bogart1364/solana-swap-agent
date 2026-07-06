import { PublicKey } from "@solana/web3.js";

export interface Contact {
  name: string;
  address: string;
}

const STORAGE_KEY = "swap-agent:contacts";

function readAll(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Contact[]) : [];
  } catch {
    return [];
  }
}

function writeAll(contacts: Contact[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function listContacts(): Contact[] {
  return readAll();
}

export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address.trim());
    return true;
  } catch {
    return false;
  }
}

export function addContact(name: string, address: string): { ok: boolean; error?: string } {
  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  if (!trimmedName) return { ok: false, error: "Name is required." };
  if (!isValidAddress(trimmedAddress)) return { ok: false, error: "That doesn't look like a valid Solana address." };

  const contacts = readAll();
  const idx = contacts.findIndex((c) => c.name.toLowerCase() === trimmedName.toLowerCase());
  if (idx >= 0) contacts[idx] = { name: trimmedName, address: trimmedAddress };
  else contacts.push({ name: trimmedName, address: trimmedAddress });
  writeAll(contacts);
  return { ok: true };
}

export function removeContact(name: string) {
  writeAll(readAll().filter((c) => c.name.toLowerCase() !== name.toLowerCase()));
}

export function findContact(name: string): Contact | undefined {
  return readAll().find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}

/** Resolves free text to an address: a saved contact name, or a raw address. */
export function resolveRecipient(text: string): { address: string; label: string } | null {
  const trimmed = text.trim();
  const contact = findContact(trimmed);
  if (contact) return { address: contact.address, label: contact.name };
  if (isValidAddress(trimmed)) return { address: trimmed, label: `${trimmed.slice(0, 4)}\u2026${trimmed.slice(-4)}` };
  return null;
}
