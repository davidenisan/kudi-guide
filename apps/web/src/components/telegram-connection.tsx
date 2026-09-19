"use client";
import * as React from "react";
import { ArrowUpRight, Send, Check, Link2 } from "lucide-react";
export type Connection = { linked: boolean; configured: boolean; online: boolean; username: string | null; lastReceivedAt: string | null; assistant?: { available: boolean; model: string; enabled: boolean }; receiptSupport?: boolean };
export function useConnection() {
 const [connection, setConnection] = React.useState<Connection | null>(null);
 const [error, setError] = React.useState("");
 const refresh = React.useCallback(async () => {
  try { const r = await fetch("/api/telegram/status", { cache: "no-store" }); if (!r.ok) throw new Error("Connection status unavailable"); setConnection(await r.json()); setError(""); }
  catch { setError("Connection status unavailable"); setConnection(null); }
 }, []);
 React.useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 5000); return () => clearInterval(id); }, [refresh]);
 return { connection, error, refresh };
}
export function TelegramConnection() {
 const { connection: c, error: statusError, refresh } = useConnection();
 const [link, setLink] = React.useState<{ url: string; expiresAt: string } | null>(null);
 const [error, setError] = React.useState(""); const [busy, setBusy] = React.useState(false);
 async function connect() {
  setBusy(true); setError("");
  try { const r = await fetch("/api/telegram/link-code", { method: "POST" }); const body = await r.json(); if (!r.ok) throw new Error(body.error); setLink(body); }
  catch (e) { setError(e instanceof Error ? e.message : "Could not connect"); } finally { setBusy(false); }
 }
 async function disconnect() {
  setBusy(true); setError("");
  try { const r = await fetch("/api/telegram/connection", { method: "DELETE" }); if (!r.ok) throw new Error("Could not disconnect"); setLink(null); await refresh(); }
  catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect"); } finally { setBusy(false); }
 }
 const active = c?.linked && c.online;
 return <section className="telegram-card"><div className="section-top"><div className="telegram-icon"><Send size={22}/></div><span className={`status-pill ${active ? "active" : ""}`}><i/>{statusError ? "Unavailable" : !c ? "Checking" : active ? "Active connection" : c.linked ? "Reconnecting" : "Not connected"}</span></div><h3>Meet your money companion.</h3><p>{active ? "Your bot is listening. Send an expense, receipt photo or PDF and we’ll take it from there." : "Connect Telegram once. Send expenses in your own words, or share a receipt photo or PDF."}</p>{c?.lastReceivedAt && <small>Last transaction · {new Date(c.lastReceivedAt).toLocaleString()}</small>}{c?.linked ? <div className="connection-actions">{c.username && <a className="button black" href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer">Open Telegram <ArrowUpRight size={16}/></a>}<button className="button outline" disabled={busy} onClick={disconnect}>Disconnect</button></div> : link ? <div className="link-ready"><Check size={18}/><p>Ready to link. Open Telegram and tap Start.<small>Expires at {new Date(link.expiresAt).toLocaleTimeString()}</small></p><a className="button black" href={link.url} target="_blank" rel="noreferrer">Open Telegram <ArrowUpRight size={16}/></a></div> : <button className="button black" disabled={busy || !c?.configured} onClick={connect}><Link2 size={17}/>{busy ? "Preparing…" : "Connect Telegram"}</button>}{<div className="assistant-details"><strong>More than a transaction bot.</strong><p>Try “Spenk 4k on Suya,” “actually 5k,” or “how much did I spend today?”</p><p>JPEG, PNG, WebP & PDF · Up to 10 MB and 5 pages. Receipts save directly to your app. Tell the bot if anything needs correcting.</p>{c?.assistant && <small>{c.assistant.available ? `Local AI ready · ${c.assistant.model}` : "Local AI unavailable · basic text commands still work"}</small>}</div>}{c && !c.configured && <p className="form-note">Your bot is not configured yet. Add its token to the server to connect.</p>}{(error || statusError) && <p role="alert" className="error-text">{error || statusError}</p>}</section>;
}
