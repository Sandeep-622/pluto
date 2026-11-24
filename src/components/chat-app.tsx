"use client";

import { useEffect, useRef, useState } from "react";
import { type ChatEvent, type AnswerSection } from "@/lib/contract";
import { historyKey, requestHistory, restoreHistory, type Conversation, type Message } from "@/lib/history";
import { readChatStream } from "@/lib/stream";
import { apiUrl } from "@/lib/api";
import { Answer } from "./answer";
import { Icon, PlutoMark } from "./icon";

const suggestions = [
  { label: "Understand a symptom", question: "What do the indexed books explain about the causes of headache?", icon: "chat" as const },
  { label: "Explore a mechanism", question: "Explain the mechanism of insulin action using the indexed books.", icon: "book" as const },
  { label: "Connect the concepts", question: "How do the indexed books distinguish migraine from tension-type headache?", icon: "globe" as const }
];

function applyEvent(message: Message, event: ChatEvent): Message {
  if (event.type === "done") return { ...message, status: message.sections.some((section) => section.status === "error") ? "error" : "complete" };
  const sections = [...message.sections];
  let index = sections.findIndex((section) => section.kind === event.section);
  if (index === -1) {
    sections.push({ kind: event.section, text: "", sources: [], status: "loading" });
    index = sections.length - 1;
  }
  let section: AnswerSection = { ...sections[index] };
  if (event.type === "delta") section.text += event.text;
  if (event.type === "sources") section.sources = event.sources;
  if (event.type === "notice") section.notice = event.message;
  if (event.type === "error") section = { ...section, status: "error", notice: event.message };
  if (event.type === "section-done") section.status = "complete";
  sections[index] = section;
  sections.sort((a, b) => a.kind === b.kind ? 0 : a.kind === "web" ? -1 : 1);
  return { ...message, sections };
}

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [includeWeb, setIncludeWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [webAvailable, setWebAvailable] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const historyWritable = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Restore browser-only state after hydration and report storage failures. */
  useEffect(() => {
    // Browser persistence is restored after hydration, never during server rendering.
    try {
      const saved = localStorage.getItem(historyKey);
      if (saved) {
        const restored = restoreHistory(saved);
        setConversations(restored);
        setActiveId(restored[0]?.id ?? null);
      }
    } catch { historyWritable.current = false; setStorageError("Saved chats could not be loaded. You can continue, or clear this browser's saved chats."); }
    setReady(true);
    const controller = new AbortController();
    Promise.resolve().then(() => fetch(apiUrl("health"), { signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error("The demo server is not ready.");
      const health: unknown = await response.json();
      if (typeof health === "object" && health && "webAvailable" in health) setWebAvailable(health.webAvailable === true);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to check demo availability.");
    });
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!ready || busy || !historyWritable.current) return;
    try { localStorage.setItem(historyKey, JSON.stringify({ version: 1, conversations })); }
    catch { setStorageError("This browser couldn't save your chats. Your current answer still works, but history may not survive a refresh."); }
  }, [conversations, ready, busy]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const conversation = conversations.find((item) => item.id === activeId);
  const messages = conversation?.messages ?? [];
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conversations, busy]);

  function newChat() {
    if (sending.current) return;
    setActiveId(null); setQuestion(""); setIncludeWeb(false); setError(""); setSidebarOpen(false);
    textarea.current?.focus();
  }

  function updateAnswer(id: string, messageId: string, update: (message: Message) => Message) {
    setConversations((items) => items.map((item) => item.id === id ? {
      ...item, messages: item.messages.map((message) => message.id === messageId ? update(message) : message)
    } : item));
  }

  async function send(text = question) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000 || sending.current || !ready) return;
    if ((conversation?.messages.length ?? 0) >= 98) { setError("This chat has reached the demo limit. Start a new chat to continue."); return; }
    sending.current = true;
    const id = activeId ?? crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const user: Message = { id: crypto.randomUUID(), role: "user", text: trimmed, includeWeb, sections: [], status: "complete" };
    const assistant: Message = { id: messageId, role: "assistant", text: "", includeWeb, sections: [], status: "loading" };
    const history = requestHistory(messages);
    setConversations((items) => {
      const existing = items.find((item) => item.id === id);
      const updated: Conversation = { id, title: existing?.title ?? trimmed.slice(0, 60), updatedAt: Date.now(), messages: [...(existing?.messages ?? []), user, assistant] };
      return [updated, ...items.filter((item) => item.id !== id)].slice(0, 30);
    });
    setActiveId(id); setQuestion(""); setBusy(true); setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch(apiUrl("chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: trimmed, includeWeb, history }), signal: controller.signal });
      await readChatStream(response, (event) => updateAnswer(id, messageId, (message) => applyEvent(message, event)));
    } catch (failure) {
      const stopped = controller.signal.aborted;
      const message = stopped ? "Response stopped in this browser. The server may continue processing until its deadline." : failure instanceof Error ? failure.message : "The answer could not be completed. Please retry.";
      if (!stopped) setError(message);
      updateAnswer(id, messageId, (answer) => ({
        ...answer, status: stopped ? "stopped" : "error",
        sections: answer.sections.length ? answer.sections.map((section) => section.status === "loading" ? { ...section, status: stopped ? "stopped" : "error", notice: message } : section)
          : [{ kind: "books", text: "", sources: [], status: stopped ? "stopped" : "error", notice: message }]
      }));
    } finally { sending.current = false; abort.current = null; setBusy(false); textarea.current?.focus(); }
  }

  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); newChat(); }}><PlutoMark /><span>pluto<span className="brand-dot">.</span></span></a>
      <div className="brand-caption">A LITTLE CURIOSITY. A LOT OF KNOWLEDGE.</div>
      <button className="new-chat" onClick={newChat} disabled={busy}><Icon name="plus" size={18} />New conversation<span className="key-hint">+</span></button>
      <div className="history-heading">YOUR CONVERSATIONS<span>{conversations.length.toString().padStart(2, "0")}</span></div>
      <nav className="history-list" aria-label="Saved conversations">
        {conversations.length === 0 && <p className="no-history">A fresh page.<br/>Your conversations will live here.</p>}
        {conversations.map((item) => <div className={`history-item ${item.id === activeId ? "active" : ""}`} key={item.id}>
          <button disabled={busy} onClick={() => { setActiveId(item.id); setIncludeWeb(false); setSidebarOpen(false); setError(""); }} title={item.title}><Icon name="chat" size={16}/><span>{item.title}</span></button>
          <button className="delete-chat" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => { setConversations((items) => items.filter((entry) => entry.id !== item.id)); if (activeId === item.id) setActiveId(null); }}><Icon name="trash" size={14}/></button>
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-note"><Icon name="shield" size={16}/><span>Just this browser.<br/><small>Your chat history stays on this device.</small></span></div>
        <button className="clear-history" disabled={busy || (!conversations.length && !storageError)} onClick={() => { if (!window.confirm("Delete all saved chats from this browser?")) return; try { localStorage.removeItem(historyKey); historyWritable.current = true; setConversations([]); setActiveId(null); setStorageError(""); } catch { setStorageError("This browser blocked clearing saved chats. Please clear site data in your browser settings."); } }}><Icon name="trash" size={14}/>Clear history</button>
        <div className="demo-label"><span/>EXPLORATION MODE <b>POC</b></div>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Icon name="menu"/></button><span className="workspace-icon"><Icon name="book" size={16}/></span><span>Medical reading room</span><span className="topbar-divider">/</span><span className="muted">{messages.length ? "Conversation" : "New conversation"}</span></div><div className="model-pill"><span/>GPT-6 Luna</div></header>

      {storageError && <div className="global-warning" role="alert">{storageError}</div>}
      <div className={`chat-scroll ${messages.length ? "has-messages" : ""}`}>
        {!messages.length ? <div className="welcome">
          <div className="eyebrow"><span/>GROUNDED IN YOUR BOOKS</div>
          <h1>A question is a<br/>good place to <em>start.</em></h1>
          <p className="welcome-description">Make sense of the medicine you read.<br/>Explore concepts, connect ideas, and trace every answer<br className="desktop-break"/> back to its source.</p>
          <div className="welcome-rule"/>
          <div className="suggestion-heading">FOLLOW YOUR CURIOSITY</div>
          <div className="suggestions">{suggestions.map((item) => <button key={item.label} disabled={!ready || busy} onClick={() => { setQuestion(item.question); textarea.current?.focus(); }}><span className="suggestion-icon"><Icon name={item.icon} size={20}/></span><strong>{item.label}</strong><span>{item.question}</span><Icon name="chevron" size={15}/></button>)}</div>
          <p className="grounding-note"><Icon name="check" size={14}/>Book-level citations. No guesswork disguised as a source.</p>
        </div> : <div className="message-list">{messages.map((message) => message.role === "user"
          ? <div className="user-message" key={message.id}><div className="user-label">YOU<span>{message.includeWeb ? "Books + web" : "Book only"}</span></div><p>{message.text}</p></div>
          : <Answer key={message.id} sections={message.sections} includeWeb={message.includeWeb} loading={message.status === "loading"}/>)}<div ref={bottom}/></div>}
      </div>

      <div className="composer-area">
        {error && <div className="request-error" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError("")}><Icon name="close" size={14}/></button></div>}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className="sr-only" htmlFor="question">Your medical book question</label>
          <textarea ref={textarea} id="question" placeholder="What would you like to understand?" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} rows={2} disabled={busy} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
          <div className="composer-toolbar"><div className="composer-tools"><span className="book-tool"><Icon name="book" size={15}/>Your books</span><span className="tool-separator"/><label className={`web-toggle ${includeWeb ? "enabled" : ""}`}><input type="checkbox" checked={includeWeb} disabled={busy || !webAvailable} onChange={(event) => setIncludeWeb(event.target.checked)}/><span className="toggle-track"/><Icon name="globe" size={15}/><span>Include web</span></label></div><div className="send-controls"><span className="character-count">{question.length > 1600 ? `${question.length}/2000` : ""}</span>{busy ? <button className="send-button stop-button" type="button" aria-label="Stop response" onClick={() => abort.current?.abort()}><Icon name="stop" size={17}/></button> : <button className="send-button" type="submit" disabled={!question.trim() || !ready} aria-label="Send question"><Icon name="arrow" size={20}/></button>}</div></div>
        </form>
        <p className="mode-help">{includeWeb ? "Web findings first, then your books. Web search costs extra and sends your question to a public-web service outside the Azure compliance boundary. Do not include patient details." : webAvailable ? "Book-only answers. Switch on web to add website findings before your book sources." : "Book-only answers. Web search is currently disabled by the administrator."}</p>
        <p className="disclaimer">For learning, not medical decisions. Sources may be incomplete or outdated. Don&apos;t enter identifiable patient information.</p>
      </div>
    </main>
  </div>;
}
