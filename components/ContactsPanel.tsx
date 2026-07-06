"use client";

import { useEffect, useState } from "react";
import { addContact, listContacts, removeContact, type Contact } from "@/lib/contacts";

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContacts(listContacts());
  }, []);

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const result = addContact(name, address);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that contact.");
      return;
    }
    setError(null);
    setName("");
    setAddress("");
    setContacts(listContacts());
  };

  const onRemove = (n: string) => {
    removeContact(n);
    setContacts(listContacts());
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Contacts</h2>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Saved here in your browser only. Use a name in a transfer command, e.g.{" "}
        <code>send 0.5 SOL to alice</code>.
      </p>

      <form className="contact-form" onSubmit={onAdd}>
        <input placeholder="Name (e.g. alice)" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder="Solana address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="submit">Save</button>
      </form>
      {error && <p className="error-text">{error}</p>}

      <ul className="contact-list">
        {contacts.map((c) => (
          <li key={c.name}>
            <span className="contact-name">{c.name}</span>
            <span className="contact-address">
              {c.address.slice(0, 4)}
              {"\u2026"}
              {c.address.slice(-4)}
            </span>
            <button className="ghost-btn" onClick={() => onRemove(c.name)}>
              Remove
            </button>
          </li>
        ))}
        {contacts.length === 0 && <p className="empty-text">No saved contacts yet.</p>}
      </ul>
    </div>
  );
}
